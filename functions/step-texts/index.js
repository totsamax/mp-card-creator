'use strict';

const crypto = require('crypto');
const path   = require('path');

const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store        = require(path.join(SHARED, 'versionStore'));
const promptsTmpl  = require(path.join(SHARED, 'config/prompts.texts.json'));
const criticRules  = require(path.join(SHARED, 'config/prompts.critic-texts.json'));

const STEP_ID      = '02-texts';
const MAX_ATTEMPTS = 3;

/**
 * YMQ message shape:
 *   { article, size, attempt, feedback?, force? }
 *
 * On first call: attempt=1, no feedback.
 * On retry:      attempt=N, feedback=[...issues from critic].
 */
exports.handler = async (event) => {
  const msg = parseMessage(event);
  if (!msg) return respond(400, { error: 'Invalid message' });

  const { article, size, attempt = 1, feedback = [], force = false } = msg;

  // Load master data for this size
  const manifest  = await store.getManifest(article);
  const normMeta  = manifest?.steps?.['01-normalize'];
  if (!normMeta) return respond(400, { error: `step 01-normalize has no data for article "${article}"` });

  const masterDataBuf = await store.getArtifact(article, '01-normalize', normMeta.currentVersion, 'master-data.json');
  const masterData    = JSON.parse(masterDataBuf.toString());
  const sizeRecord    = masterData.find(r => r.size === size);
  if (!sizeRecord) return respond(400, { error: `Size "${size}" not found in master data` });

  // Cache check (only on first attempt without force)
  const stepMeta   = manifest?.steps?.[STEP_ID];
  const inputHash  = sha256(JSON.stringify({ sizeRecord, promptsTmpl }));

  if (attempt === 1 && !force && stepMeta) {
    const last = stepMeta.history?.[stepMeta.history.length - 1];
    if (last?.inputHash === inputHash && last?.needsReview === false) {
      return respond(200, { skipped: true, article, size, stepId: STEP_ID });
    }
  }

  // --- Generate ---
  let generated;
  try {
    generated = await generateTexts(sizeRecord, feedback);
  } catch (err) {
    return respond(500, { error: `LLM call failed: ${err.message}` });
  }

  // --- Critic (rule-based) ---
  const criticVerdict = runCritic(generated);

  if (criticVerdict.ok || attempt >= MAX_ATTEMPTS) {
    // Save result
    const nextVersion  = (stepMeta?.currentVersion ?? 0) + 1;
    const needsReview  = !criticVerdict.ok; // exhausted attempts

    const payload = { size, texts: generated, needsReview, criticVerdict };
    await store.putArtifact(
      article, STEP_ID, nextVersion,
      `${size}_texts.json`,
      Buffer.from(JSON.stringify(payload, null, 2))
    );

    const historyEntry = {
      version: nextVersion,
      size,
      createdAt: new Date().toISOString(),
      inputHash,
      needsReview,
      attempts: buildAttemptsLog(stepMeta, attempt, criticVerdict),
    };

    await store.updateManifest(article, STEP_ID, {
      currentVersion: nextVersion,
      history: [...(stepMeta?.history ?? []), historyEntry],
    });

    return respond(200, { article, size, stepId: STEP_ID, version: nextVersion, needsReview, texts: generated });
  }

  // Critic rejected — re-enqueue with feedback
  await enqueueRetry({ article, size, attempt: attempt + 1, feedback: criticVerdict.issues, force });
  return respond(202, { queued: true, article, size, attempt: attempt + 1, issues: criticVerdict.issues });
};

// ---------------------------------------------------------------------------
// Text generation (calls OpenAI API)
// ---------------------------------------------------------------------------

async function generateTexts(sizeRecord, feedback) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;

  const feedbackBlock = feedback.length > 0
    ? promptsTmpl.feedbackBlock.replace('{{issues}}', feedback.map(i => `• ${i}`).join('\n'))
    : '';

  const userPrompt = promptsTmpl.generate.user
    .replace('{{moldName}}',      sizeRecord.moldName)
    .replace('{{theme}}',         sizeRecord.theme)
    .replace('{{faceSize}}',      sizeRecord.faceSize)
    .replace('{{moldLength}}',    sizeRecord.moldLength)
    .replace('{{moldWidth}}',     sizeRecord.moldWidth)
    .replace('{{moldHeight}}',    sizeRecord.moldHeight)
    .replace('{{color}}',         sizeRecord.color)
    .replace('{{brand}}',         sizeRecord.brand)
    .replace('{{feedbackBlock}}', feedbackBlock);

  // USE_STUB=true → skip API call, use template-computed texts from master data
  if (process.env.USE_STUB === 'true' || (!anthropicKey && !openaiKey)) {
    return templateTexts(sizeRecord);
  }

  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system:     promptsTmpl.generate.system,
          messages:   [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
      const data    = await res.json();
      const text    = data.content[0].text;
      const jsonStr = (text.match(/\{[\s\S]*\}/) || [text])[0];
      return JSON.parse(jsonStr);
    } catch (err) {
      if (openaiKey) {
        console.warn('[step-texts] Anthropic unavailable, trying OpenAI:', err.message);
      } else {
        console.warn('[step-texts] Anthropic unavailable, using stub:', err.message);
        return templateTexts(sizeRecord);
      }
    }
  }

  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: promptsTmpl.generate.system },
            { role: 'user',   content: userPrompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (err) {
      console.warn('[step-texts] OpenAI unavailable, using stub:', err.message);
      return templateTexts(sizeRecord);
    }
  }

  return templateTexts(sizeRecord);
}

function templateTexts(sizeRecord) {
  return {
    titleShort: sizeRecord.titleShort,
    titleFull:  sizeRecord.titleFull,
    annotation: sizeRecord.annotation,
  };
}

// ---------------------------------------------------------------------------
// Critic — rule-based (no LLM)
// ---------------------------------------------------------------------------

function runCritic(texts) {
  const issues = [];

  for (const rule of criticRules.rules) {
    const val = texts[rule.field] ?? '';
    if (val.length > rule.maxLength) issues.push(rule.message);
  }

  for (const [field, required] of Object.entries(criticRules.requiredSubstrings)) {
    const val = (texts[field] ?? '').toLowerCase();
    for (const sub of required) {
      if (!val.includes(sub.toLowerCase())) issues.push(`${field}: отсутствует обязательное слово "${sub}"`);
    }
  }

  for (const phrase of criticRules.bannedPhrases) {
    for (const [field, val] of Object.entries(texts)) {
      if ((val ?? '').toLowerCase().includes(phrase.toLowerCase())) {
        issues.push(`${field}: содержит запрещённую фразу "${phrase}"`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Re-enqueue via YMQ (or direct call for local dev)
// ---------------------------------------------------------------------------

async function enqueueRetry(message) {
  const queueUrl = process.env.YMQ_TEXTS_QUEUE_URL;
  if (!queueUrl) {
    // Local dev: log only (manual retry needed)
    console.log('[step-texts] would enqueue retry:', message);
    return;
  }

  // AWS SDK v3-compatible call to Yandex Message Queue
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
    // YMQ trigger wraps messages in event.messages[]
    if (event.messages) {
      return JSON.parse(event.messages[0].details.message.body);
    }
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
