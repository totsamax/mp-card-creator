'use strict';

const crypto = require('crypto');
const path   = require('path');
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store    = require(path.join(SHARED, 'versionStore'));
const template = require(path.join(SHARED, 'config/template.master.json'));
const promptsImages = require(path.join(SHARED, 'config/prompts.images.json'));
const { computeMasterData } = require(path.join(SHARED, 'templateEngine'));

const SIZES       = ['XS', 'S', 'M', 'L', 'XL'];
const IMAGE_TYPES = ['main', 'infographic', 'scale', 'lifestyle'];
const VIDEO_TYPES = ['turntable', 'detail', 'lifestyle'];

// Slide-config (999.1) — LLM/text config sourced from step-texts pattern.
const OPENAI_BASE  = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SLIDE_ID_RE  = /^[a-zA-Z0-9_-]{1,64}$/;
const DEFAULT_SLIDE_LABELS = {
  main:        'Главное фото',
  infographic: 'Инфографика с размерами',
  scale:       'Масштаб с игрушкой',
  lifestyle:   'Лайфстайл',
};

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
    const results = await Promise.allSettled(
      messages.map(msg => handler({ body: JSON.stringify(msg) })
        .then(r => { console.log(`[local] ${stepId} ok:`, JSON.stringify(msg), '→', r.statusCode); return r; })
      )
    );
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const msg = messages[i];
      if (res.status === 'rejected') {
        const err = res.reason;
        console.error(`[local] ${stepId} error:`, err.message);
        // REL-01 / D-06: record the failure to the manifest so the frontend
        // can render an 'error' state instead of a stuck 'running'.
        try {
          await store.updateManifest(msg.article, stepId, { error: err.message, failedAt: new Date().toISOString() });
        } catch (e) {
          console.error('[local] failed to record error to manifest:', e.message);
        }
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

    // --- Slide-config routes (999.1) ---
    // GET  /lines/:id/slides                          → seeded defaults or stored config
    // POST /lines/:id/slides                          → persist whole slidesConfig
    // POST /lines/:id/slides/:slideId/generate-prompt → inline LLM prompt (stub offline)
    // POST /lines/:id/slides/:slideId/regenerate      → enqueue single-slide 03-images
    // POST /lines/:id/slides/:slideId/files           → multipart reference-file upload
    if (method === 'GET' && rest === '/slides') {
      return await handleGetSlides(article);
    }
    if (method === 'POST' && rest === '/slides') {
      return await handleSaveSlides(article, event);
    }
    const genPromptMatch = rest.match(/^\/slides\/([^/]+)\/generate-prompt$/);
    if (method === 'POST' && genPromptMatch) {
      return await handleGeneratePrompt(article, decodeURIComponent(genPromptMatch[1]), event);
    }
    const slideRegenMatch = rest.match(/^\/slides\/([^/]+)\/regenerate$/);
    if (method === 'POST' && slideRegenMatch) {
      return await handleSlideRegenerate(article, decodeURIComponent(slideRegenMatch[1]), event);
    }
    const slideFilesMatch = rest.match(/^\/slides\/([^/]+)\/files$/);
    if (method === 'POST' && slideFilesMatch) {
      return await handleSlideFileUpload(article, decodeURIComponent(slideFilesMatch[1]), event);
    }

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
    // Name group is (.+) so nested slide-files keys ({slideId}/{filename}) resolve.
    const artifactMatch = rest.match(/^\/steps\/([^/]+)\/artifacts\/(.+)$/);
    if (method === 'GET' && artifactMatch) {
      return await handleGetArtifact(article, artifactMatch[1], decodeURIComponent(artifactMatch[2]), query);
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

// Parse multipart/form-data from a raw event body (for cloud YC Functions runtime).
// In local-server.js the parsing is done before the handler, so event.files is already set.
// In cloud, the API Gateway passes the raw body and we parse it here.
async function parseMultipartEvent(event) {
  const ct = Object.entries(event.headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
  if (!ct.startsWith('multipart/form-data')) return;

  const Busboy = require('busboy');
  const { Readable } = require('stream');

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '');

  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': ct }, limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
    const formFields = {};
    const files = [];

    bb.on('field', (name, val) => { formFields[name] = val; });
    bb.on('file', (fieldname, stream, { filename, mimeType }) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => files.push({ filename: filename || fieldname, mimeType, buffer: Buffer.concat(chunks) }));
    });
    bb.on('finish', () => resolve({ formFields, files }));
    bb.on('error', reject);

    Readable.from([rawBody]).pipe(bb);
  });
}

async function handleCreateLine(event) {
  let questionnaire;
  let force = false;

  // Cloud path: parse multipart from raw body when local-server.js hasn't done it
  if (!event.files) {
    const parsed = await parseMultipartEvent(event).catch(() => null);
    if (parsed) {
      event.files = parsed.files;
      event.formFields = parsed.formFields;
    }
  }

  if (event.files && event.files.length > 0) {
    // Multipart path: files uploaded via busboy (local-server.js or cloud parseMultipartEvent)
    try {
      questionnaire = JSON.parse(event.formFields && event.formFields.questionnaire ? event.formFields.questionnaire : '{}');
    } catch {
      return respond(400, { error: 'Invalid questionnaire JSON in form field' });
    }
    force = event.formFields && event.formFields.force === 'true';

    // Validate article before any store call (T-01-03-01 path traversal mitigation)
    const { article } = questionnaire;
    if (!article || !/^[a-zA-Z0-9_-]{1,64}$/.test(article)) {
      return respond(400, { error: 'Invalid or missing questionnaire.article' });
    }

    const photoRefs = [];
    for (const f of event.files) {
      // Reject non-image uploads (T-01-03-03)
      if (!f.mimeType || !f.mimeType.startsWith('image/')) {
        return respond(400, { error: 'Only image uploads allowed' });
      }
      // Validate magic bytes — prevents MIME-type spoofing (WR-02)
      if (!isImageBuffer(f.buffer)) {
        return respond(400, { error: 'Uploaded file is not a recognized image format' });
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
        let expected;
        if (h.imageType)  expected = `${h.size}_${h.imageType}.png`;
        else if (h.videoType) expected = `${h.size}_${h.videoType}.mp4`;
        else               expected = `${h.size}_texts.json`;
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
  const contentTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', json: 'application/json' };
  // Detect WebP magic bytes (RIFF....WEBP) even when file is saved as .png
  const isWebP = buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  const contentType = isWebP ? 'image/webp' : (contentTypes[ext] || 'application/octet-stream');
  return {
    statusCode: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'max-age=60' },
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
      // Pin ONE version for the whole run so every size writes its artifact into
      // the same v{N} folder. Without this, each size increments the version
      // independently (read-merge-write per message) and ends up in its own
      // version dir — handleGetStep then lists only currentVersion (the last
      // size, XL) and the other sizes appear to "disappear".
      const manifest  = await store.getManifest(article);
      const stepMeta  = manifest?.steps?.[stepId];
      const runVersion = (stepMeta?.currentVersion ?? 0) + 1;
      messages = sizes.map(size => ({ article, size, attempt: 1, force, runVersion }));
    } else if (stepId === '03-images') {
      const manifest3  = await store.getManifest(article);
      const stepMeta3  = manifest3?.steps?.[stepId];
      if (item) {
        const [size, imageType] = item.split('_');
        // Use current version so the artifact lands in the existing version directory
        const runVersion = stepMeta3?.currentVersion ?? 1;
        messages = [{ article, size, imageType, attempt: 1, force, runVersion }];
      } else {
        // Pin ONE version for the whole run (same fix as 02-texts) so every size+type
        // writes its artifact into the same v{N} folder.
        const runVersion = (stepMeta3?.currentVersion ?? 0) + 1;
        messages = SIZES.flatMap(size =>
          IMAGE_TYPES.map(imageType => ({ article, size, imageType, attempt: 1, force, runVersion }))
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
// Slide-config handlers (999.1)
// ---------------------------------------------------------------------------

/**
 * buildDefaultSlides() — seed the 4 default slides from prompts.images.json.
 * prompts.images.json stays the read-only defaults source (D-02); this never
 * writes back to it. feedbackSuffix is carried at config level (D-06).
 */
function buildDefaultSlides() {
  return {
    feedbackSuffix: promptsImages.feedbackSuffix,
    slides: promptsImages.imageTypes.map(id => ({
      id,
      label:           DEFAULT_SLIDE_LABELS[id] || id,
      description:     promptsImages.descriptions[id],
      generatedPrompt: promptsImages.prompts[id],
      files:           [],
      default:         true,
    })),
  };
}

/** Read the stored slidesConfig for an article, or the seeded defaults. */
async function readSlidesConfig(article) {
  const manifest = await store.getManifest(article);
  return manifest?.steps?.['03-images']?.slidesConfig || buildDefaultSlides();
}

/**
 * patchSlide(article, slideId, patch) — read-modify-write a single slide.
 * Reads the current slidesConfig (or defaults), replaces the slide whose
 * id === slideId with { ...slide, ...patch }, writes the whole array back,
 * and returns the updated slide.
 */
async function patchSlide(article, slideId, patch) {
  const config = await readSlidesConfig(article);
  let updated = null;
  const slides = config.slides.map(s => {
    if (s.id !== slideId) return s;
    updated = { ...s, ...patch };
    return updated;
  });
  await store.updateManifest(article, '03-images', {
    slidesConfig: { feedbackSuffix: config.feedbackSuffix, slides },
  });
  return updated;
}

/** GET /lines/:id/slides — seeded defaults when no slidesConfig is stored (D-03/D-10). */
async function handleGetSlides(article) {
  return respond(200, await readSlidesConfig(article));
}

/** POST /lines/:id/slides — persist the whole slidesConfig in one write (D-10). */
async function handleSaveSlides(article, event) {
  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { feedbackSuffix, slides } = body || {};
  if (!Array.isArray(slides)) {
    return respond(400, { error: 'slides must be an array' });
  }
  for (const s of slides) {
    if (!s || typeof s.id !== 'string' || !SLIDE_ID_RE.test(s.id)) {
      return respond(400, { error: `Invalid slide id: ${JSON.stringify(s && s.id)}` });
    }
  }

  // deepMerge replaces the array wholesale — correct for a full save.
  await store.updateManifest(article, '03-images', {
    slidesConfig: {
      feedbackSuffix: typeof feedbackSuffix === 'string' ? feedbackSuffix : promptsImages.feedbackSuffix,
      slides,
    },
  });
  return respond(200, { saved: true, slides });
}

// ---------------------------------------------------------------------------
// Slide generate-prompt / regenerate / file-upload handlers (999.1, Task 3)
// ---------------------------------------------------------------------------

/**
 * Load the M-size record (or the first row) from the current 01-normalize
 * master-data.json — used as generation context for generatePrompt.
 * Returns {} when unavailable (never throws).
 */
async function loadSizeRecord(article) {
  try {
    const manifest = await store.getManifest(article);
    const normMeta = manifest?.steps?.['01-normalize'];
    if (!normMeta?.currentVersion) return {};
    const buf  = await store.getArtifact(article, '01-normalize', normMeta.currentVersion, 'master-data.json');
    const data = JSON.parse(buf.toString());
    return data.find(r => r.size === 'M') || data[0] || {};
  } catch {
    return {};
  }
}

/**
 * generatePrompt(description, sizeRecord) — turn a Russian description into an
 * English gpt-image-2 prompt. With no OPENAI_API_KEY it returns a deterministic
 * stub and NEVER throws (mirrors step-images runCritic's no-key posture, not
 * generateImage's throw). The description is untrusted user content placed in the
 * user role; the system prompt is fixed (T-999.1-03 prompt-injection mitigation).
 */
async function generatePrompt(description, sizeRecord) {
  const apiKey = process.env.OPENAI_API_KEY;
  const ctx = sizeRecord || {};
  if (!apiKey) {
    const bits = [ctx.moldName, ctx.color].filter(Boolean).join(', ');
    return `Product marketplace slide. ${description}${bits ? ` (${bits})` : ''}. White background, studio lighting, sharp focus, high-contrast, professional.`;
  }

  const contextLine = `Context — moldName: ${ctx.moldName || ''}, color: ${ctx.color || ''}, moldSize: ${ctx.moldSize || ''} cm, dimensions ${ctx.moldLength || ''}×${ctx.moldWidth || ''}×${ctx.moldHeight || ''} cm.`;
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:      OPENAI_MODEL,
      max_tokens: 400,
      messages: [
        { role: 'system', content: 'You write concise image-generation prompts for the gpt-image-2 API for product marketplace slides. Output only the prompt, no explanation. Language: English.' },
        { role: 'user',   content: `${description}\n\n${contextLine}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`chat/completions ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/** POST /lines/:id/slides/:slideId/generate-prompt (D-07/D-11). */
async function handleGeneratePrompt(article, slideId, event) {
  if (!SLIDE_ID_RE.test(slideId)) return respond(400, { error: 'Invalid slideId' });

  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const description = body && typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) return respond(400, { error: 'description required' });

  const sizeRecord      = await loadSizeRecord(article);
  const generatedPrompt = await generatePrompt(description, sizeRecord);
  await patchSlide(article, slideId, { description, generatedPrompt });
  return respond(200, { slideId, generatedPrompt });
}

/**
 * POST /lines/:id/slides/:slideId/regenerate (D-08/D-12) — enqueue single-slide
 * 03-images generation for all five sizes, carrying slideId. Fire-and-forget;
 * Plan 02 makes step-images slide-aware. Leaves all other steps untouched.
 */
async function handleSlideRegenerate(article, slideId, event) {
  if (!SLIDE_ID_RE.test(slideId)) return respond(400, { error: 'Invalid slideId' });

  const manifest   = await store.getManifest(article);
  const runVersion = manifest?.steps?.['03-images']?.currentVersion ?? 1;
  const messages   = SIZES.map(size => ({ article, size, slideId, attempt: 1, force: true, runVersion }));
  await runLocally('03-images', messages);
  return respond(202, { queued: true, article, stepId: '03-images', slideId, count: messages.length });
}

/**
 * POST /lines/:id/slides/:slideId/files (D-09) — multipart reference-file upload.
 * Accepts arbitrary reference files (photos, templates); the busboy 15 MB/10-file
 * limit, filename sanitisation, and octet-stream fallback in handleGetArtifact are
 * the mitigations (T-999.1-01/02) — no image-only magic-byte gate here.
 */
async function handleSlideFileUpload(article, slideId, event) {
  if (!SLIDE_ID_RE.test(slideId)) return respond(400, { error: 'Invalid slideId' });

  if (!event.files) {
    const parsed = await parseMultipartEvent(event).catch(() => null);
    if (parsed) {
      event.files      = parsed.files;
      event.formFields = parsed.formFields;
    }
  }
  if (!event.files || event.files.length === 0) {
    return respond(400, { error: 'No files uploaded' });
  }

  const refs = [];
  for (const f of event.files) {
    const safeName = path.basename(f.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || /^\.+$/.test(safeName) || !/[a-zA-Z0-9]/.test(safeName)) {
      return respond(400, { error: 'Invalid filename in upload' });
    }
    await store.putArtifact(article, 'slide-files', 1, `${slideId}/${safeName}`, f.buffer);
    refs.push(`/lines/${article}/steps/slide-files/artifacts/${slideId}/${safeName}`);
  }

  // Register the slide-files pseudo-step so handleGetArtifact can resolve the blob
  // (putArtifact does not touch the manifest; getArtifact 404s without a step entry).
  await store.updateManifest(article, 'slide-files', { currentVersion: 1 });

  const config   = await readSlidesConfig(article);
  const slide    = config.slides.find(s => s.id === slideId);
  const existing = slide && Array.isArray(slide.files) ? slide.files : [];
  await patchSlide(article, slideId, { files: [...existing, ...refs] });
  return respond(200, { slideId, refs, ref: refs[0] });
}

// ---------------------------------------------------------------------------

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Validate image magic bytes — prevents MIME-type spoofing.
 * Accepts PNG, JPEG, and WEBP buffers only.
 */
function isImageBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true; // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8) return true; // JPEG
  if (buf.length >= 12 && buf.slice(8, 12).toString('ascii') === 'WEBP') return true; // WEBP
  return false;
}
