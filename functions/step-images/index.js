'use strict';

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

const SHARED       = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');
const OPENAI_BASE         = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_IMAGE_MODEL  = process.env.OPENAI_IMAGE_MODEL  || 'gpt-image-1';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

const store        = require(path.join(SHARED, 'versionStore'));
const promptsTmpl  = require(path.join(SHARED, 'config/prompts.images.json'));
const criticCfg    = require(path.join(SHARED, 'config/prompts.critic-images.json'));

const STEP_ID      = '03-images';
const MAX_ATTEMPTS = 3;

/**
 * Message shape:
 *   { article, size, imageType, attempt, feedback?, force?, attemptsLog? }
 *
 * imageType: 'infographic' (single-type MVP — see api IMAGE_TYPES)
 */
exports.handler = async (event) => {
  const msg = parseMessage(event);
  if (!msg) return respond(400, { error: 'Invalid message' });

  const { article, size, imageType, attempt = 1, feedback = [], force = false, attemptsLog = [], runVersion } = msg;
  if (!imageType) return respond(400, { error: 'imageType is required' });

  // Top-level try/catch (REL-01 / D-06): any throw records { error, failedAt }
  // to the manifest step entry so the frontend can render an 'error' state.
  try {
    // Load master data
    const manifest   = await store.getManifest(article);
    const normMeta   = manifest?.steps?.['01-normalize'];
    if (!normMeta) return respond(400, { error: `step 01-normalize has no data for article "${article}"` });

    const masterDataBuf = await store.getArtifact(article, '01-normalize', normMeta.currentVersion, 'master-data.json');
    const masterData    = JSON.parse(masterDataBuf.toString());
    const sizeRecord    = masterData.find(r => r.size === size);
    if (!sizeRecord) return respond(400, { error: `Size "${size}" not found in master data` });

    const stepMeta  = manifest?.steps?.[STEP_ID];
    const inputHash = sha256(JSON.stringify({ sizeRecord, imageType, promptsTmpl }));

    // Cache check
    if (attempt === 1 && !force && stepMeta) {
      const last = stepMeta.history?.slice(-1)[0];
      if (last?.inputHash === inputHash && !last?.needsReview) {
        return respond(200, { skipped: true, article, size, imageType, stepId: STEP_ID });
      }
    }

    // --- Generate image ---
    console.log(`[step-images] generating ${article} ${size}/${imageType} attempt=${attempt}`);
    let imageBuffer;
    try {
      imageBuffer = await generateImage(article, sizeRecord, imageType, feedback);
    } catch (err) {
      console.error(`[step-images] generation failed ${size}/${imageType}:`, err.message);
      await store.updateManifest(article, STEP_ID, { error: err.message, failedAt: new Date().toISOString() });
      return respond(500, { error: `Image generation failed: ${err.message}` });
    }

    // --- Critic (Claude Vision or stub) ---
    let criticVerdict;
    try {
      criticVerdict = await runCritic(imageBuffer, sizeRecord, imageType);
    } catch (err) {
      // If critic call fails, treat as ok to not block the pipeline.
      // This is NOT a step error — do NOT write { error, failedAt } here.
      console.warn('[step-images] critic failed, accepting image:', err.message);
      criticVerdict = { ok: true, issues: [] };
    }

    if (criticVerdict.ok || attempt >= MAX_ATTEMPTS) {
      const nextVersion  = runVersion ?? (stepMeta?.currentVersion ?? 0) + 1;
      const needsReview  = !criticVerdict.ok;
      const artifactName = `${size}_${imageType}.png`;

      await store.putArtifact(article, STEP_ID, nextVersion, artifactName, imageBuffer);

      const historyEntry = {
        version: nextVersion,
        size,
        imageType,
        createdAt: new Date().toISOString(),
        inputHash,
        needsReview,
        attempts: [...attemptsLog, { attempt, criticVerdict }],
      };

      // error/failedAt cleared on success so a retry resolves a prior failure.
      await store.updateManifest(article, STEP_ID, {
        currentVersion: nextVersion,
        pushHistory: historyEntry,
        error: null,
        failedAt: null,
        ...(needsReview ? { overrides: { [artifactName]: `v${nextVersion}` } } : {}),
      });

      console.log(`[step-images] saved ${article} ${size}/${imageType} → v${nextVersion}${needsReview ? ' ⚠ needsReview' : ' ✓'}`);
      return respond(200, {
        article, size, imageType, stepId: STEP_ID,
        version: nextVersion, needsReview, artifactName,
      });
    }

    // Critic rejected — recurse directly (local retry, no YMQ)
    return exports.handler({ body: JSON.stringify({
      article, size, imageType, attempt: attempt + 1, feedback: criticVerdict.issues, force, runVersion,
      attemptsLog: [...attemptsLog, { attempt, criticVerdict }],
    }) });
  } catch (err) {
    await store.updateManifest(article, STEP_ID, { error: err.message, failedAt: new Date().toISOString() });
    return respond(500, { error: err.message });
  }
};

// ---------------------------------------------------------------------------
// Prompt building (image-in-image composition)
// ---------------------------------------------------------------------------

function substitutePrompt(sizeRecord, imageType) {
  const tmpl = promptsTmpl.prompts[imageType] || promptsTmpl.prompts.infographic;
  return tmpl
    .replace(/\{\{moldName\}\}/g,   sizeRecord.moldName)
    .replace(/\{\{moldSize\}\}/g,   sizeRecord.moldSize)
    .replace(/\{\{color\}\}/g,      sizeRecord.color)
    .replace(/\{\{moldLength\}\}/g, sizeRecord.moldLength)
    .replace(/\{\{moldWidth\}\}/g,  sizeRecord.moldWidth)
    .replace(/\{\{moldHeight\}\}/g, sizeRecord.moldHeight)
    .replace(/\{\{toyFrom\}\}/g,    sizeRecord.toyFrom)
    .replace(/\{\{toyTo\}\}/g,      sizeRecord.toyTo)
    .replace(/\{\{topic\}\}/g,      sizeRecord.topic)
    .replace(/\{\{purpose\}\}/g,    sizeRecord.purpose);
}

/**
 * buildEditRequest(article, sizeRecord, imageType, feedback)
 *   → Promise<{ prompt, imageCount }>
 *
 * prompt: composition instruction with all tokens resolved.
 * imageCount: 1 (background template) + number of mold photos.
 */
async function buildEditRequest(article, sizeRecord, imageType, feedback = []) {
  let prompt = substitutePrompt(sizeRecord, imageType);

  if (feedback.length > 0) {
    prompt += promptsTmpl.feedbackSuffix.replace('{{issues}}', feedback.join('; '));
  }

  const photoNames = await store.listArtifacts(article, 'photos', 1);
  return { prompt, imageCount: 1 + (photoNames ? photoNames.length : 0) };
}

exports.buildEditRequest = buildEditRequest;

// ---------------------------------------------------------------------------
// Image generation — router: apiframe v2 async OR standard OpenAI
// ---------------------------------------------------------------------------

function isApiframe() {
  const base = process.env.OPENAI_BASE_URL || '';
  const key  = process.env.OPENAI_API_KEY  || '';
  return base.includes('apiframe') || key.startsWith('afk_');
}

async function generateImage(article, sizeRecord, imageType, feedback) {
  const apiKey = process.env.OPENAI_API_KEY;

  let prompt = substitutePrompt(sizeRecord, imageType);
  if (feedback.length > 0) {
    prompt += promptsTmpl.feedbackSuffix.replace('{{issues}}', feedback.join('; '));
  }

  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  if (isApiframe()) {
    return await generateImageApiframe(article, prompt);
  }

  // Standard OpenAI: try images/generations, then images/edits
  return generateImageOpenAI(article, prompt, imageType);
}

// ---------------------------------------------------------------------------
// Apiframe v2: async job submission + polling
// ---------------------------------------------------------------------------

async function generateImageApiframe(article, prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model  = OPENAI_IMAGE_MODEL;

  // Try to pass the mold photo as base64 data URL for image-in-image generation
  let inputImages;
  try {
    const photoNames = await store.listArtifacts(article, 'photos', 1);
    if (photoNames && photoNames.length > 0) {
      const photoBuf = await store.getArtifact(article, 'photos', 1, photoNames[0]);
      const ext = photoNames[0].split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      inputImages = `data:${mime};base64,${photoBuf.toString('base64')}`;
      console.log(`[step-images] passing mold photo (${photoBuf.length}b) to apiframe`);
    }
  } catch (err) {
    console.warn('[step-images] could not load mold photo, generating text-only:', err.message);
  }

  const gptImage2Params = { quality: 'auto', background: 'opaque', number_of_images: 1 };
  if (inputImages) gptImage2Params.input_images = inputImages;

  const submitRes = await fetch('https://api.apiframe.ai/v2/images/generate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ prompt, model, gptImage2Params }),
  });
  if (!submitRes.ok) throw new Error(`apiframe submit ${submitRes.status}: ${(await submitRes.text()).slice(0, 200)}`);
  const submitted = await submitRes.json();
  const jobId = submitted.jobId || submitted.job_id || submitted.id;
  if (!jobId) throw new Error(`apiframe: no jobId in response: ${JSON.stringify(submitted)}`);
  console.log(`[step-images] apiframe job submitted: ${jobId}`);

  // Poll until COMPLETED (max 4 min, every 5s; function timeout is 300s)
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`https://api.apiframe.ai/v2/jobs/${jobId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!pollRes.ok) throw new Error(`apiframe poll ${pollRes.status}`);
    const job = await pollRes.json();
    console.log(`[step-images] apiframe job ${jobId} status=${job.status}`);

    if (job.status === 'COMPLETED' || job.status === 'completed' || job.status === 'success') {
      const r = job.result || {};
      const imageUrl = r.imageUrl || r.image_url || r.url
        || (Array.isArray(r.images)  ? r.images[0]  : null)
        || (Array.isArray(r.urls)    ? r.urls[0]    : null)
        || (Array.isArray(r)         ? r[0]         : null);
      if (!imageUrl) throw new Error(`apiframe: no image URL in result: ${JSON.stringify(job)}`);
      const dlRes = await fetch(imageUrl);
      if (!dlRes.ok) throw new Error(`apiframe CDN download ${dlRes.status}`);
      return Buffer.from(await dlRes.arrayBuffer());
    }
    if (job.status === 'FAILED' || job.status === 'failed' || job.status === 'error') {
      throw new Error(`apiframe job failed: ${JSON.stringify(job)}`);
    }
  }
  throw new Error('apiframe job timed out after 3 min');
}

// ---------------------------------------------------------------------------
// Standard OpenAI: images/generations → images/edits
// ---------------------------------------------------------------------------

async function generateImageOpenAI(article, prompt, imageType) {
  const apiKey = process.env.OPENAI_API_KEY;

  // Try images/generations (text-to-image, simplest path)
  try {
    const res = await fetch(`${OPENAI_BASE}/images/generations`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:           OPENAI_IMAGE_MODEL,
        prompt,
        n:               1,
        size:            '1024x1024',
        response_format: 'b64_json',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return Buffer.from(data.data[0].b64_json, 'base64');
    }
    console.warn(`[step-images] images/generations ${res.status}, trying images/edits`);
  } catch (err) {
    console.warn('[step-images] images/generations error, trying images/edits:', err.message);
  }

  // Fallback: images/edits (image-in-image with background template + mold photos)
  const templatePath = path.join(SHARED, 'templates', `${imageType}.png`);
  let bgBuffer;
  try {
    bgBuffer = fs.readFileSync(templatePath);
  } catch {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const photoNames = await store.listArtifacts(article, 'photos', 1);
  const photoBuffers = [];
  for (const name of (photoNames || [])) {
    photoBuffers.push(await store.getArtifact(article, 'photos', 1, name));
  }

  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('image[]', new Blob([bgBuffer], { type: 'image/png' }), `${imageType}.png`);
  photoBuffers.forEach((buf, i) => form.append('image[]', new Blob([buf], { type: 'image/png' }), `mold-${i}.png`));

  const res = await fetch(`${OPENAI_BASE}/images/edits`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    form,
  });

  if (!res.ok) throw new Error(`images/edits ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

// ---------------------------------------------------------------------------
// Critic — Claude Vision
// ---------------------------------------------------------------------------

async function runCritic(imageBuffer, sizeRecord, imageType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: true, issues: [] };
  }

  const userPrompt = criticCfg.user
    .replace('{{imageType}}',  `${imageType} — ${criticCfg.imageTypes[imageType] || imageType}`)
    .replace('{{moldName}}',   sizeRecord.moldName)
    .replace('{{color}}',      sizeRecord.color)
    .replace('{{moldLength}}', sizeRecord.moldLength)
    .replace('{{moldWidth}}',  sizeRecord.moldWidth)
    .replace('{{moldHeight}}', sizeRecord.moldHeight);

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:      OPENAI_VISION_MODEL,
      max_tokens: 256,
      messages: [
        { role: 'system', content: criticCfg.system },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBuffer.toString('base64')}` } },
            { type: 'text',      text: userPrompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Vision API error: ${res.status} ${await res.text()}`);
  const data   = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return { ok: Boolean(parsed.ok), issues: parsed.issues ?? [] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMessage(event) {
  try {
    if (event.messages) return JSON.parse(event.messages[0].details.message.body);
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}
