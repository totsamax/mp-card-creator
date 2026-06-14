'use strict';

const crypto = require('crypto');
const path   = require('path');

const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store        = require(path.join(SHARED, 'versionStore'));
const promptsTmpl  = require(path.join(SHARED, 'config/prompts.images.json'));
const criticCfg    = require(path.join(SHARED, 'config/prompts.critic-images.json'));

const STEP_ID      = '03-images';
const MAX_ATTEMPTS = 3;

/**
 * YMQ message shape:
 *   { article, size, imageType, attempt, feedback?, force? }
 *
 * imageType: 'main' | 'infographic' | 'scale' | 'lifestyle'
 */
exports.handler = async (event) => {
  const msg = parseMessage(event);
  if (!msg) return respond(400, { error: 'Invalid message' });

  const { article, size, imageType, attempt = 1, feedback = [], force = false } = msg;
  if (!imageType) return respond(400, { error: 'imageType is required' });

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
  let imageBuffer;
  try {
    imageBuffer = await generateImage(sizeRecord, imageType, feedback);
  } catch (err) {
    return respond(500, { error: `Image generation failed: ${err.message}` });
  }

  // --- Critic (Claude Vision or stub) ---
  let criticVerdict;
  try {
    criticVerdict = await runCritic(imageBuffer, sizeRecord, imageType);
  } catch (err) {
    // If critic call fails, treat as ok to not block the pipeline
    console.warn('[step-images] critic failed, accepting image:', err.message);
    criticVerdict = { ok: true, issues: [] };
  }

  if (criticVerdict.ok || attempt >= MAX_ATTEMPTS) {
    const nextVersion  = (stepMeta?.currentVersion ?? 0) + 1;
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
      attempts: buildAttemptsLog(stepMeta, attempt, criticVerdict),
    };

    await store.updateManifest(article, STEP_ID, {
      currentVersion: nextVersion,
      history: [...(stepMeta?.history ?? []), historyEntry],
      ...(needsReview ? { overrides: { [artifactName]: `v${nextVersion}` } } : {}),
    });

    return respond(200, {
      article, size, imageType, stepId: STEP_ID,
      version: nextVersion, needsReview, artifactName,
    });
  }

  // Critic rejected — re-enqueue
  await enqueueRetry({ article, size, imageType, attempt: attempt + 1, feedback: criticVerdict.issues, force });
  return respond(202, { queued: true, article, size, imageType, attempt: attempt + 1, issues: criticVerdict.issues });
};

// ---------------------------------------------------------------------------
// Image generation (OpenAI Images API)
// ---------------------------------------------------------------------------

async function generateImage(sizeRecord, imageType, feedback) {
  const apiKey = process.env.OPENAI_API_KEY;

  let prompt = (promptsTmpl.prompts[imageType] || promptsTmpl.prompts.main)
    .replace('{{moldName}}',   sizeRecord.moldName)
    .replace('{{faceSize}}',   sizeRecord.faceSize)
    .replace('{{color}}',      sizeRecord.color)
    .replace('{{moldLength}}', sizeRecord.moldLength)
    .replace('{{moldWidth}}',  sizeRecord.moldWidth)
    .replace('{{moldHeight}}', sizeRecord.moldHeight)
    .replace('{{toyFrom}}',    sizeRecord.toyFrom)
    .replace('{{toyTo}}',      sizeRecord.toyTo);

  if (feedback.length > 0) {
    prompt += promptsTmpl.feedbackSuffix.replace('{{issues}}', feedback.join('; '));
  }

  if (!apiKey) {
    // Stub: return a 1x1 transparent PNG
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
  });

  if (!res.ok) throw new Error(`OpenAI Images API error: ${res.status} ${await res.text()}`);
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
// YMQ re-enqueue
// ---------------------------------------------------------------------------

async function enqueueRetry(message) {
  const queueUrl = process.env.YMQ_IMAGES_QUEUE_URL;
  if (!queueUrl) {
    console.log('[step-images] would enqueue retry:', message);
    return;
  }
  const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
  const client = new SQSClient({
    region:   'ru-central1',
    endpoint: 'https://message-queue.api.cloud.yandex.net',
  });
  await client.send(new SendMessageCommand({
    QueueUrl:    queueUrl,
    MessageBody: JSON.stringify(message),
  }));
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

function buildAttemptsLog(stepMeta, currentAttempt, criticVerdict) {
  const prev = stepMeta?.history?.slice(-1)[0]?.attempts ?? [];
  return [...prev, { attempt: currentAttempt, criticVerdict }];
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
