'use strict';

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

const SHARED       = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');
const OPENAI_BASE        = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '').replace(/\/v\d+$/, '');
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

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

    // No mold photo → 400 (D-03). Checked at the handler level so a missing photo
    // always yields 400 regardless of API key / stub path.
    const photoNames = await store.listArtifacts(article, 'photos', 1);
    if (!photoNames || photoNames.length === 0) return respond(400, { error: 'no mold photo found' });

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
    let generationStub = false;
    try {
      const result = await generateImage(article, sizeRecord, imageType, feedback);
      if (result && result.stub) {
        imageBuffer = result.buffer;
        generationStub = true;
      } else {
        imageBuffer = result;
      }
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
      const needsReview  = !criticVerdict.ok || generationStub;
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
        history: [...(stepMeta?.history ?? []), historyEntry],
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
// Image generation (OpenAI Images Edits API — image-in-image compositor)
// ---------------------------------------------------------------------------

async function generateImage(article, sizeRecord, imageType, feedback) {
  const apiKey = process.env.OPENAI_API_KEY;

  let prompt = substitutePrompt(sizeRecord, imageType);
  if (feedback.length > 0) {
    prompt += promptsTmpl.feedbackSuffix.replace('{{issues}}', feedback.join('; '));
  }

  if (!apiKey) {
    // Stub: return a 1x1 transparent PNG (returns BEFORE any template/photo read)
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
  }

  // Read background template
  const templatePath = path.join(SHARED, 'templates', `${imageType}.png`);
  let bgBuffer;
  try {
    bgBuffer = fs.readFileSync(templatePath);
  } catch (err) {
    throw new Error(`Background template not found: ${templatePath}. Add ${imageType}.png to layers/shared/templates/`);
  }

  // Read all mold photos
  const photoNames = await store.listArtifacts(article, 'photos', 1);
  const photoBuffers = [];
  for (const name of (photoNames || [])) {
    photoBuffers.push(await store.getArtifact(article, 'photos', 1, name));
  }

  // Build multipart form: image[] = [background, ...photos]
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('image[]', new Blob([bgBuffer], { type: 'image/png' }), `${imageType}.png`);
  photoBuffers.forEach((buf, i) => form.append('image[]', new Blob([buf], { type: 'image/png' }), `mold-${i}.png`));

  // NO manual Content-Type — undici derives the multipart boundary.
  const res = await fetch(`${OPENAI_BASE}/v1/images/edits`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    form,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[step-images] Images Edits API error (${res.status}), falling back to stub:`, errText.slice(0, 200));
    return { stub: true, buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )};
  }
  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

// ---------------------------------------------------------------------------
// Critic — Claude Vision
// ---------------------------------------------------------------------------

async function runCritic(imageBuffer, sizeRecord, imageType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Stub: always ok in local dev
    return { ok: true, issues: [] };
  }

  const userPrompt = criticCfg.user
    .replace('{{imageType}}',  `${imageType} — ${criticCfg.imageTypes[imageType] || imageType}`)
    .replace('{{moldName}}',   sizeRecord.moldName)
    .replace('{{color}}',      sizeRecord.color)
    .replace('{{moldLength}}', sizeRecord.moldLength)
    .replace('{{moldWidth}}',  sizeRecord.moldWidth)
    .replace('{{moldHeight}}', sizeRecord.moldHeight);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 256,
      system:     criticCfg.system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBuffer.toString('base64') } },
          { type: 'text',  text: userPrompt },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  const data   = await res.json();
  const parsed = JSON.parse(data.content[0].text);
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
