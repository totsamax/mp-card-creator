'use strict';

const crypto = require('crypto');
const path   = require('path');
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store    = require(path.join(SHARED, 'versionStore'));
const template = require(path.join(SHARED, 'config/template.master.json'));
const { computeMasterData } = require(path.join(SHARED, 'templateEngine'));

const SIZES       = ['XS', 'S', 'M', 'L', 'XL'];
const IMAGE_TYPES = ['main', 'infographic', 'scale', 'lifestyle'];
const VIDEO_TYPES = ['turntable', 'detail', 'lifestyle'];

const STEP_QUEUES = {
  '02-texts':  () => process.env.YMQ_TEXTS_QUEUE_URL,
  '03-images': () => process.env.YMQ_IMAGES_QUEUE_URL,
  '04-video':  () => process.env.YMQ_VIDEO_QUEUE_URL,
};

// In cloud-bundle: step files land at ./step-{name}.js (junk-path zip).
// Locally: they live at ../step-{name}/index.js relative to this file.
function requireStep(name) {
  try {
    return require(`./${name}`);
  } catch {
    return require(path.resolve(__dirname, `../${name}/index.js`));
  }
}

function getSQS() {
  const { SQSClient } = require('@aws-sdk/client-sqs');
  return new SQSClient({
    region:   'ru-central1',
    endpoint: 'https://message-queue.api.cloud.yandex.net',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

async function sendBatch(queueUrl, messages) {
  const { SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
  const sqs = getSQS();
  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10).map((body, j) => ({
      Id: String(i + j),
      MessageBody: JSON.stringify(body),
    }));
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: chunk }));
  }
}

// Local-mode fallback: run step handlers directly (fire-and-forget)
async function runLocally(stepId, messages) {
  const stepName = {
    '02-texts':  'step-texts',
    '03-images': 'step-images',
    '04-video':  'step-video',
  }[stepId];
  const { handler } = requireStep(stepName);
  (async () => {
    for (const msg of messages) {
      try {
        const r = await handler({ body: JSON.stringify(msg) });
        console.log(`[local] ${stepId} ok:`, JSON.stringify(msg), '→', r.statusCode);
      } catch (err) {
        console.error(`[local] ${stepId} error:`, err.message);
      }
    }
  })().catch(console.error);
}

/**
 * Routes (matches api-gateway.yaml):
 *
 *   GET  /lines                                            → list all articles from manifests
 *   POST /lines                                            → create line (run step-normalize)
 *   GET  /lines/:id/manifest                              → raw manifest
 *   GET  /lines/:id/steps/:step?version=N                 → step data + artifact list
 *   POST /lines/:id/steps/:step/regenerate                → enqueue step for regeneration
 *   POST /lines/:id/steps/:step/items/:item/regenerate    → enqueue single artifact regeneration
 */
exports.handler = async (event) => {
  const method  = event.httpMethod || event.method || 'GET';
  const rawPath = event.url || event.path || '/';
  // strip query string from path
  const pathOnly = rawPath.split('?')[0].replace(/\/$/, '') || '/';
  const query   = event.queryStringParameters || {};

  try {
    // POST /lines — create line (delegate to step-normalize handler)
    if (method === 'POST' && pathOnly === '/lines') {
      return await handleCreateLine(event);
    }

    // GET /lines
    if (method === 'GET' && pathOnly === '/lines') {
      return await handleListLines();
    }

    // Extract /lines/:id prefix
    const lineMatch = pathOnly.match(/^\/lines\/([^/]+)(\/.*)?$/);
    if (!lineMatch) return respond(404, { error: 'Not found' });

    const article = decodeURIComponent(lineMatch[1]);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(article)) {
      return respond(400, { error: 'Invalid article identifier' });
    }
    const rest    = lineMatch[2] || '';

    // GET /lines/:id/manifest
    if (method === 'GET' && rest === '/manifest') {
      const manifest = await store.getManifest(article);
      if (!manifest) return respond(404, { error: `Article "${article}" not found` });
      return respond(200, manifest);
    }

    // GET /lines/:id/steps/:step[?version=N]
    const stepMatch = rest.match(/^\/steps\/([^/]+)$/);
    if (method === 'GET' && stepMatch) {
      return await handleGetStep(article, stepMatch[1], query);
    }

    // GET /lines/:id/steps/:step/artifacts/:name[?version=N]
    const artifactMatch = rest.match(/^\/steps\/([^/]+)\/artifacts\/([^/]+)$/);
    if (method === 'GET' && artifactMatch) {
      return await handleGetArtifact(article, artifactMatch[1], artifactMatch[2], query);
    }

    // POST /lines/:id/steps/:step/regenerate
    const regenMatch = rest.match(/^\/steps\/([^/]+)\/regenerate$/);
    if (method === 'POST' && regenMatch) {
      return await handleRegenerate(article, regenMatch[1], event, null);
    }

    // POST /lines/:id/steps/:step/items/:item/regenerate
    const itemRegenMatch = rest.match(/^\/steps\/([^/]+)\/items\/([^/]+)\/regenerate$/);
    if (method === 'POST' && itemRegenMatch) {
      return await handleRegenerate(article, itemRegenMatch[1], event, decodeURIComponent(itemRegenMatch[2]));
    }

    return respond(404, { error: 'Route not found' });
  } catch (err) {
    console.error('[api] unhandled error:', err);
    return respond(500, { error: err.message });
  }
};

// ---------------------------------------------------------------------------

async function handleListLines() {
  let articles = [];
  try {
    articles = await store.listArticles();
  } catch {
    return respond(200, { lines: [] });
  }

  const lines = await Promise.all(articles.map(async (article) => {
    const manifest = await store.getManifest(article);
    if (!manifest) return null;

    const normMeta = manifest.steps?.['01-normalize'];
    let lineInfo = { id: article, article, steps: Object.keys(manifest.steps || {}) };

    if (normMeta?.currentVersion) {
      try {
        const buf  = await store.getArtifact(article, '01-normalize', normMeta.currentVersion, 'master-data.json');
        const data = JSON.parse(buf.toString());
        const mRow = data[0] || {};
        lineInfo.moldName = mRow.moldName;
        lineInfo.brand    = mRow.brand;
        lineInfo.sizes    = data.map(r => r.size);
      } catch { /* ok */ }
    }
    return lineInfo;
  }));

  return respond(200, { lines: lines.filter(Boolean) });
}

async function handleCreateLine(event) {
  let questionnaire;
  let force = false;

  if (event.files && event.files.length > 0) {
    // Multipart path: files uploaded via busboy (local-server.js or equivalent adapter)
    try {
      questionnaire = JSON.parse(event.formFields && event.formFields.questionnaire ? event.formFields.questionnaire : '{}');
    } catch {
      return respond(400, { error: 'Invalid questionnaire JSON in form field' });
    }
    force = event.formFields && event.formFields.force === 'true';

    // Save each uploaded photo via versionStore (T-01-03-01 path traversal mitigation)
    const { article } = questionnaire;
    if (!article) return respond(400, { error: 'questionnaire.article is required' });

    const photoRefs = [];
    for (const f of event.files) {
      // Reject non-image uploads (T-01-03-03)
      if (!f.mimeType || !f.mimeType.startsWith('image/')) {
        return respond(400, { error: 'Only image uploads allowed' });
      }
      // Sanitize filename to prevent path traversal (T-01-03-01)
      const safeName = path.basename(f.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!safeName || /^\.+$/.test(safeName) || !/[a-zA-Z0-9]/.test(safeName)) {
        return respond(400, { error: 'Invalid filename in upload' });
      }
      await store.putArtifact(article, 'photos', 1, safeName, f.buffer);
      photoRefs.push('/lines/' + article + '/steps/photos/artifacts/' + safeName);
    }

    // Assign photos BEFORE inputHash computation (Pitfall 4: photos must be part of hash)
    questionnaire.photos = photoRefs;
  } else {
    // JSON path — existing logic unchanged
    let body;
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
      body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }
    ({ force = false, ...questionnaire } = body);
  }

  const { article } = questionnaire;
  if (!article || !/^[a-zA-Z0-9_-]{1,64}$/.test(article)) {
    return respond(400, { error: 'Invalid or missing questionnaire.article' });
  }

  const inputHash = crypto.createHash('sha256')
    .update(JSON.stringify({ questionnaire, templateVersion: template }))
    .digest('hex');

  const manifest = await store.getManifest(article);
  const stepMeta = manifest?.steps?.['01-normalize'];

  if (!force && stepMeta) {
    const last = stepMeta.history?.[stepMeta.history.length - 1];
    if (last?.inputHash === inputHash) {
      return respond(200, { skipped: true, reason: 'same input hash', article, stepId: '01-normalize', version: stepMeta.currentVersion, questionnaire: last.questionnaire });
    }
  }

  let masterData;
  try {
    masterData = computeMasterData(questionnaire, template);
  } catch (err) {
    return respond(400, { error: `Computation failed: ${err.message}` });
  }

  const nextVersion  = (stepMeta?.currentVersion ?? 0) + 1;
  const historyEntry = { version: nextVersion, createdAt: new Date().toISOString(), inputHash, questionnaire };

  await store.putArtifact(
    article, '01-normalize', nextVersion,
    'master-data.json',
    Buffer.from(JSON.stringify(masterData, null, 2))
  );
  await store.updateManifest(article, '01-normalize', {
    currentVersion: nextVersion,
    history: [...(stepMeta?.history ?? []), historyEntry],
  });

  return respond(200, { article, stepId: '01-normalize', version: nextVersion, masterData, questionnaire });
}

async function handleGetStep(article, stepId, query) {
  const manifest = await store.getManifest(article);
  if (!manifest) return respond(404, { error: `Article "${article}" not found` });

  const stepMeta = manifest.steps?.[stepId];
  if (!stepMeta) return respond(404, { error: `Step "${stepId}" has no data yet` });

  const version   = query.version ? parseInt(query.version, 10) : stepMeta.currentVersion;
  const artifacts = await store.listArtifacts(article, stepId, version);

  // Inline content for small JSON artifacts so the frontend doesn't need a second request
  const inlinedData = {};
  for (const name of artifacts) {
    if (!name.endsWith('.json')) continue;
    try {
      const buf = await store.getArtifact(article, stepId, version, name);
      inlinedData[name] = JSON.parse(buf.toString());
    } catch { /* skip if unreadable */ }
  }

  return respond(200, { article, stepId, version, meta: stepMeta, artifacts, data: inlinedData });
}

async function handleGetArtifact(article, stepId, name, query) {
  const manifest = await store.getManifest(article);
  if (!manifest) return respond(404, { error: `Article "${article}" not found` });

  const stepMeta = manifest.steps?.[stepId];
  if (!stepMeta) return respond(404, { error: `Step "${stepId}" has no data yet` });

  // Explicit version query takes priority
  let effectiveVersion = query.version ? parseInt(query.version, 10) : null;

  if (!effectiveVersion) {
    // Check overrides first (used for needsReview cases)
    const overrideVersion = stepMeta.overrides?.[name];
    if (overrideVersion) {
      effectiveVersion = parseInt(overrideVersion.replace('v', ''), 10);
    } else {
      // Find version from history where this artifact was written.
      // Artifact name format: {size}_texts.json or {size}_{imageType}.png
      // History entries have { size, imageType?, version }
      const history = stepMeta.history || [];
      const match = [...history].reverse().find(h => {
        const expected = h.imageType
          ? `${h.size}_${h.imageType}.png`
          : `${h.size}_texts.json`;
        return expected === name;
      });
      effectiveVersion = match?.version ?? stepMeta.currentVersion;
    }
  }

  let buffer;
  try {
    buffer = await store.getArtifact(article, stepId, effectiveVersion, name);
  } catch {
    return respond(404, { error: `Artifact "${name}" not found at v${effectiveVersion}` });
  }

  const ext = name.split('.').pop().toLowerCase();
  const contentTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', json: 'application/json' };
  return {
    statusCode: 200,
    headers: { 'Content-Type': contentTypes[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=60' },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
}

async function handleRegenerate(article, stepId, event, item) {
  let body = {};
  if (event.body) {
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
      body = JSON.parse(raw);
    } catch { /* ignore */ }
  }
  const force = body.force ?? true;

  // Async steps: publish to YMQ (cloud) or run directly (local)
  const queueUrlFn = STEP_QUEUES[stepId];
  if (queueUrlFn) {
    let messages;
    if (stepId === '02-texts') {
      const sizes = item ? [item] : SIZES;
      messages = sizes.map(size => ({ article, size, attempt: 1, force }));
    } else if (stepId === '03-images') {
      if (item) {
        const [size, imageType] = item.split('_');
        messages = [{ article, size, imageType, attempt: 1, force }];
      } else {
        messages = SIZES.flatMap(size =>
          IMAGE_TYPES.map(imageType => ({ article, size, imageType, attempt: 1, force }))
        );
      }
    } else if (stepId === '04-video') {
      const sizes = item ? [item] : SIZES;
      messages = sizes.flatMap(size =>
        VIDEO_TYPES.map(videoType => ({ article, size, videoType, attempt: 1, force }))
      );
    }

    const queueUrl = queueUrlFn();
    if (queueUrl) {
      await sendBatch(queueUrl, messages);
    } else {
      // Local mode: call handlers directly (fire-and-forget)
      await runLocally(stepId, messages);
    }
    return respond(202, { queued: true, article, stepId, count: messages.length });
  }

  // Sync steps: invoke handler directly
  if (stepId === '01-normalize') {
    const manifest = await store.getManifest(article);
    const history  = manifest?.steps?.['01-normalize']?.history ?? [];
    const last     = [...history].reverse().find(h => h.questionnaire);
    if (!last?.questionnaire) return respond(400, { error: 'No stored questionnaire for 01-normalize; submit the form to create the line first' });
    return handleCreateLine({ body: JSON.stringify({ ...last.questionnaire, force }) });
  }
  if (stepId === '05-excel') {
    const { handler } = requireStep('step-excel');
    return handler({ body: JSON.stringify({ article, force }) });
  }
  if (stepId === '06-assemble') {
    const { handler } = requireStep('step-assemble');
    return handler({ body: JSON.stringify({ article, force }) });
  }

  return respond(400, { error: `Cannot regenerate step "${stepId}" via this endpoint. For 01-normalize use POST /lines with force:true` });
}

// ---------------------------------------------------------------------------

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
