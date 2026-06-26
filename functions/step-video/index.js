'use strict';

const crypto = require('crypto');
const path   = require('path');

const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store      = require(path.join(SHARED, 'versionStore'));
const videoTmpl  = require(path.join(SHARED, 'config/prompts.video.json'));

const STEP_ID      = '04-video';
const MAX_ATTEMPTS = 3;

/**
 * YMQ / API message shape:
 *   { article, size, videoType, attempt?, force?, attemptsLog? }
 *
 * videoType: 'turntable' | 'detail' | 'lifestyle'
 * Inline polling: submit → poll loop (max 4 min) → save — no re-enqueue needed.
 */
exports.handler = async (event) => {
  const msg = parseMessage(event);
  if (!msg) return respond(400, { error: 'Invalid message' });

  const { article, size, videoType, attempt = 1, force = false, attemptsLog = [] } = msg;
  if (!videoType) return respond(400, { error: 'videoType is required (turntable|detail|lifestyle)' });

  try {
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    // Load reference image from step-03 (optional)
    let referenceImageB64 = null;
    try {
      const imgMeta = manifest?.steps?.['03-images'];
      if (imgMeta?.currentVersion) {
        const imgBuf = await store.getArtifact(article, '03-images', imgMeta.currentVersion, `${size}_main.png`);
        referenceImageB64 = imgBuf.toString('base64');
        console.log(`[step-video] using ${size}_main.png as reference image`);
      }
    } catch {
      // reference image optional — fall back to text-only
    }

    const prompt = buildPrompt(videoTmpl.prompts[videoType] || videoTmpl.prompts.turntable, sizeRecord);

    // Submit to Kling via apiframe v2
    const jobId = await submitKlingTask({ prompt, referenceImageB64, apiKey });
    console.log(`[step-video] submitted ${article} ${size}/${videoType} → jobId=${jobId}`);

    await store.updateManifest(article, STEP_ID, {
      pendingTask: { jobId, size, videoType, attempt, submittedAt: new Date().toISOString() },
    });

    // Inline poll (max 4 min, every 5 s; function timeout is 300 s)
    const deadline = Date.now() + 4 * 60 * 1000;
    let finalStatus = null;
    let videoUrl    = null;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await pollKlingTask(jobId, apiKey);
      console.log(`[step-video] poll ${jobId} status=${poll.status}`);

      if (poll.status === 'succeeded') { videoUrl = poll.videoUrl; finalStatus = 'succeeded'; break; }
      if (poll.status === 'failed')    { finalStatus = 'failed'; break; }
    }

    if (finalStatus !== 'succeeded') {
      const errMsg = finalStatus === 'failed' ? 'Kling job failed' : 'Kling job timed out after 4 min';
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[step-video] ${errMsg}, retrying attempt ${attempt + 1}`);
        return exports.handler({ body: JSON.stringify({
          article, size, videoType, attempt: attempt + 1, force,
          attemptsLog: [...attemptsLog, { attempt, error: errMsg }],
        }) });
      }
      await store.updateManifest(article, STEP_ID, { error: errMsg, failedAt: new Date().toISOString(), pendingTask: null });
      return respond(500, { error: errMsg, article, size, videoType });
    }

    const buffer = await downloadVideo(videoUrl);
    const criticVerdict = runCritic(buffer);

    if (!criticVerdict.ok && attempt < MAX_ATTEMPTS) {
      console.warn(`[step-video] critic rejected ${size}/${videoType}, retrying attempt ${attempt + 1}:`, criticVerdict.issues);
      return exports.handler({ body: JSON.stringify({
        article, size, videoType, attempt: attempt + 1, force,
        attemptsLog: [...attemptsLog, { attempt, criticVerdict }],
      }) });
    }

    const nextVersion  = (stepMeta?.currentVersion ?? 0) + 1;
    const needsReview  = !criticVerdict.ok;
    const artifactName = `${size}_${videoType}.mp4`;

    await store.putArtifact(article, STEP_ID, nextVersion, artifactName, buffer);

    const historyEntry = {
      version: nextVersion,
      size,
      videoType,
      createdAt: new Date().toISOString(),
      inputHash,
      needsReview,
      attempts: [...attemptsLog, { attempt, criticVerdict }],
    };

    await store.updateManifest(article, STEP_ID, {
      currentVersion: nextVersion,
      pushHistory: historyEntry,
      pendingTask: null,
      error: null,
      failedAt: null,
    });

    console.log(`[step-video] saved ${article} ${size}/${videoType} → v${nextVersion}${needsReview ? ' ⚠ needsReview' : ' ✓'}`);
    return respond(200, { article, size, videoType, stepId: STEP_ID, version: nextVersion, artifactName, needsReview });

  } catch (err) {
    console.error('[step-video] fatal:', err.message);
    await store.updateManifest(article, STEP_ID, { error: err.message, failedAt: new Date().toISOString(), pendingTask: null });
    return respond(500, { error: err.message });
  }
};

// ---------------------------------------------------------------------------
// Kling.ai via apiframe v2
// ---------------------------------------------------------------------------

async function submitKlingTask({ prompt, referenceImageB64, apiKey }) {
  // image-to-video (kling-2.1) when reference available, else text-to-video (kling-2.1-master)
  const body = referenceImageB64
    ? { model: 'kling-3.0', prompt, klingParams: { start_image: `data:image/png;base64,${referenceImageB64}` } }
    : { model: 'kling-3.0', prompt };

  const res = await fetch('https://api.apiframe.ai/v2/videos/generate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Kling submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const jobId = data.jobId || data.job_id || data.id;
  if (!jobId) throw new Error(`Kling: no jobId in response: ${JSON.stringify(data)}`);
  return jobId;
}

async function pollKlingTask(jobId, apiKey) {
  const res = await fetch(`https://api.apiframe.ai/v2/jobs/${jobId}`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) throw new Error(`Kling poll ${res.status}`);
  const data   = await res.json();
  const status = (data.status || data.task_status || '').toLowerCase();
  const r      = data.result || {};
  const videoUrl = r.videoUrl || r.video_url || r.url
    || (Array.isArray(r.videos) ? r.videos[0]?.url : null)
    || null;
  return {
    status:   status === 'completed' ? 'succeeded' : status,
    videoUrl,
  };
}

async function downloadVideo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Rule-based critic
// ---------------------------------------------------------------------------

function runCritic(buffer) {
  const issues = [];
  if (!buffer || buffer.length < 10_000) issues.push('Видеофайл слишком мал (< 10 КБ)');
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrompt(template, sizeRecord) {
  return template
    .replace(/\{\{moldName\}\}/g, sizeRecord.moldName)
    .replace(/\{\{color\}\}/g,    sizeRecord.color)
    .replace(/\{\{faceSize\}\}/g, sizeRecord.faceSize ?? '');
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
