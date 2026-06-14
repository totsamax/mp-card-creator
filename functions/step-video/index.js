'use strict';

const crypto = require('crypto');
const path   = require('path');

const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store      = require(path.join(SHARED, 'versionStore'));
const videoTmpl  = require(path.join(SHARED, 'config/prompts.video.json'));

const STEP_ID      = '04-video';
const MAX_ATTEMPTS = 3;

/**
 * YMQ message shapes:
 *
 * Phase 'generate' (default):
 *   { article, size, videoType, attempt, feedback?, force? }
 *
 * Phase 'poll' (re-enqueued after task submitted):
 *   { article, size, videoType, taskId, attempt, phase: 'poll', force? }
 */
exports.handler = async (event) => {
  const msg = parseMessage(event);
  if (!msg) return respond(400, { error: 'Invalid message' });

  const { article, size, videoType, attempt = 1, force = false } = msg;
  if (!videoType) return respond(400, { error: 'videoType is required (turntable|detail|lifestyle)' });

  // Load master data to get sizeRecord
  const manifest  = await store.getManifest(article);
  const normMeta  = manifest?.steps?.['01-normalize'];
  if (!normMeta) return respond(400, { error: `step 01-normalize has no data for article "${article}"` });

  const masterDataBuf = await store.getArtifact(article, '01-normalize', normMeta.currentVersion, 'master-data.json');
  const masterData    = JSON.parse(masterDataBuf.toString());
  const sizeRecord    = masterData.find(r => r.size === size);
  if (!sizeRecord) return respond(400, { error: `Size "${size}" not found in master data` });

  const stepMeta  = manifest?.steps?.[STEP_ID];
  const inputHash = sha256(JSON.stringify({ sizeRecord, videoType, videoTmpl }));

  // Cache check (only on first attempt without force)
  if (attempt === 1 && !force && stepMeta) {
    const hit = stepMeta.history?.find(e => e.inputHash === inputHash && !e.needsReview);
    if (hit) {
      return respond(200, { skipped: true, article, size, videoType, stepId: STEP_ID, version: hit.version });
    }
  }

  // --- Polling phase (task already submitted) ---
  if (msg.phase === 'poll' && msg.taskId) {
    return handlePoll(msg, sizeRecord, stepMeta, inputHash);
  }

  // --- Generate phase ---
  return handleGenerate({ article, size, videoType, attempt, force, sizeRecord, stepMeta, inputHash });
};

// ---------------------------------------------------------------------------
// Phase 1: submit task to Kling.ai
// ---------------------------------------------------------------------------

async function handleGenerate({ article, size, videoType, attempt, force, sizeRecord, stepMeta, inputHash }) {
  const apiKey = process.env.KLING_API_KEY;

  if (!apiKey) {
    // Stub: skip async polling, save placeholder immediately
    const buffer = Buffer.from('VIDEO_STUB');
    return saveArtifact({ article, size, videoType, stepMeta, inputHash, attempt, buffer, needsReview: false });
  }

  // Load reference image (main photo for this size from step-images)
  let referenceImageB64 = null;
  try {
    const imgMeta = (await store.getManifest(article))?.steps?.['03-images'];
    if (imgMeta?.currentVersion) {
      const imgBuf = await store.getArtifact(article, '03-images', imgMeta.currentVersion, `${size}_main.png`);
      referenceImageB64 = imgBuf.toString('base64');
    }
  } catch {
    // reference image optional — fall back to text-only prompt
  }

  const prompt = buildPrompt(videoTmpl.prompts[videoType] || videoTmpl.prompts.turntable, sizeRecord);

  const taskId = await submitKlingTask({ prompt, referenceImageB64, apiKey });

  // Save task_id to manifest so the poll phase can reference it
  await store.updateManifest(article, STEP_ID, {
    pendingTask: { taskId, size, videoType, attempt, inputHash, submittedAt: new Date().toISOString() },
  });

  // Re-enqueue for polling
  await enqueueMessage(
    process.env.YMQ_VIDEO_QUEUE_URL,
    { article, size, videoType, taskId, attempt, phase: 'poll', force }
  );

  return respond(202, { queued: true, phase: 'poll', article, size, videoType, taskId });
}

// ---------------------------------------------------------------------------
// Phase 2: poll task status, download and save
// ---------------------------------------------------------------------------

async function handlePoll({ article, size, videoType, taskId, attempt, force }, sizeRecord, stepMeta, inputHash) {
  const apiKey = process.env.KLING_API_KEY;

  const { status, videoUrl } = await pollKlingTask(taskId, apiKey);

  if (status === 'pending' || status === 'processing') {
    // Not ready yet — re-enqueue
    await enqueueMessage(
      process.env.YMQ_VIDEO_QUEUE_URL,
      { article, size, videoType, taskId, attempt, phase: 'poll', force }
    );
    return respond(202, { queued: true, phase: 'poll', article, size, videoType, taskId, status });
  }

  if (status === 'failed') {
    if (attempt >= MAX_ATTEMPTS) {
      return respond(500, { error: 'Kling.ai task failed after max attempts', article, size, videoType });
    }
    // Retry from generate phase
    await enqueueMessage(
      process.env.YMQ_VIDEO_QUEUE_URL,
      { article, size, videoType, attempt: attempt + 1, feedback: ['Kling.ai task failed'], force }
    );
    return respond(202, { queued: true, phase: 'generate', article, size, videoType, attempt: attempt + 1 });
  }

  // status === 'succeeded'
  const buffer = await downloadVideo(videoUrl);
  const criticVerdict = runCritic(buffer);

  if (!criticVerdict.ok && attempt < MAX_ATTEMPTS) {
    await enqueueMessage(
      process.env.YMQ_VIDEO_QUEUE_URL,
      { article, size, videoType, attempt: attempt + 1, feedback: criticVerdict.issues, force }
    );
    return respond(202, { queued: true, article, size, videoType, attempt: attempt + 1, issues: criticVerdict.issues });
  }

  return saveArtifact({
    article, size, videoType, stepMeta, inputHash, attempt, buffer,
    needsReview: !criticVerdict.ok,
  });
}

// ---------------------------------------------------------------------------
// Save artifact + update manifest
// ---------------------------------------------------------------------------

async function saveArtifact({ article, size, videoType, stepMeta, inputHash, attempt, buffer, needsReview }) {
  const nextVersion  = (stepMeta?.currentVersion ?? 0) + 1;
  const artifactName = `${size}_${videoType}.mp4`;

  await store.putArtifact(article, STEP_ID, nextVersion, artifactName, buffer);

  const historyEntry = {
    version: nextVersion,
    size,
    videoType,
    createdAt: new Date().toISOString(),
    inputHash,
    needsReview,
    attempts: attempt,
  };

  await store.updateManifest(article, STEP_ID, {
    currentVersion: nextVersion,
    history: [...(stepMeta?.history ?? []), historyEntry],
    pendingTask: null,
  });

  return respond(200, { article, size, videoType, stepId: STEP_ID, version: nextVersion, artifactName, needsReview });
}

// ---------------------------------------------------------------------------
// Kling.ai API calls
// ---------------------------------------------------------------------------

async function submitKlingTask({ prompt, referenceImageB64, apiKey }) {
  const body = {
    model:     videoTmpl.klingApi.imageToVideo.model,
    prompt,
    duration:  videoTmpl.klingApi.imageToVideo.duration,
    cfg_scale: videoTmpl.klingApi.imageToVideo.cfg_scale,
  };
  if (referenceImageB64) {
    body.image = referenceImageB64;
  }

  const res = await fetch('https://api.klingai.com/v1/videos/image2video', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Kling.ai submit error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.task_id;
}

async function pollKlingTask(taskId, apiKey) {
  const res = await fetch(`https://api.klingai.com/v1/videos/image2video/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`Kling.ai poll error: ${res.status}`);
  const data = await res.json();
  return {
    status:   data.task_status,           // 'pending' | 'processing' | 'succeeded' | 'failed'
    videoUrl: data.task_result?.videos?.[0]?.url ?? null,
  };
}

async function downloadVideo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Rule-based critic (no LLM for video)
// ---------------------------------------------------------------------------

function runCritic(buffer) {
  const issues = [];
  if (!buffer || buffer.length < 10_000) issues.push('Видеофайл слишком мал (< 10 КБ) — возможно ошибка загрузки');
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// YMQ enqueue
// ---------------------------------------------------------------------------

async function enqueueMessage(queueUrl, message) {
  if (!queueUrl) {
    console.log('[step-video] would enqueue:', message);
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

function buildPrompt(template, sizeRecord) {
  return template
    .replace('{{moldName}}', sizeRecord.moldName)
    .replace('{{color}}',    sizeRecord.color)
    .replace('{{faceSize}}', sizeRecord.faceSize);
}

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
