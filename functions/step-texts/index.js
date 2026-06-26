'use strict';

const crypto = require('crypto');
const path   = require('path');

const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store        = require(path.join(SHARED, 'versionStore'));
const promptsTmpl  = require(path.join(SHARED, 'config/prompts.texts.json'));
const criticRules  = require(path.join(SHARED, 'config/prompts.critic-texts.json'));

const OPENAI_BASE  = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

  const { article, size, attempt = 1, feedback = [], force = false, attemptsLog = [], runVersion } = msg;

  // Top-level try/catch (REL-01 / D-06): any throw records { error, failedAt }
  // to the manifest step entry so the frontend can render an 'error' state.
  try {
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
    const generated = await generateTexts(sizeRecord, feedback);

    // --- Critic (rule-based) ---
    const criticVerdict = runCritic(generated, sizeRecord.topic);

    if (criticVerdict.ok || attempt >= MAX_ATTEMPTS) {
      // Save result.
      // runVersion (set by api/handleRegenerate) pins ONE version for the whole
      // 5-size run so every size writes into the same v{N} folder and all sizes
      // stay visible via handleGetStep. Fall back to per-call increment only when
      // a message arrives without a pinned version (e.g. a direct/legacy call).
      const nextVersion  = runVersion ?? (stepMeta?.currentVersion ?? 0) + 1;
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
        attempts: [...attemptsLog, { attempt, criticVerdict }],
      };

      // error/failedAt cleared on success so a retry resolves a prior failure.
      await store.updateManifest(article, STEP_ID, {
        currentVersion: nextVersion,
        pushHistory: historyEntry,
        error: null,
        failedAt: null,
      });

      return respond(200, { article, size, stepId: STEP_ID, version: nextVersion, needsReview, texts: generated });
    }

    // Critic rejected — recurse directly (local retry, no YMQ).
    // Carry runVersion forward so retries write into the same pinned run version.
    return exports.handler({ body: JSON.stringify({
      article, size, attempt: attempt + 1, feedback: criticVerdict.issues, force, runVersion,
      attemptsLog: [...attemptsLog, { attempt, criticVerdict }],
    }) });
  } catch (err) {
    await store.updateManifest(article, STEP_ID, { error: err.message, failedAt: new Date().toISOString() });
    return respond(500, { error: err.message });
  }
};

// ---------------------------------------------------------------------------
// Text generation (calls OpenAI API)
// ---------------------------------------------------------------------------

async function generateTexts(sizeRecord, feedback) {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openaiKey     = process.env.OPENAI_API_KEY;

  const feedbackBlock = feedback.length > 0
    ? promptsTmpl.feedbackBlock.replace('{{issues}}', feedback.map(i => `• ${i}`).join('\n'))
    : '';

  const userPrompt = promptsTmpl.generate.user
    .replace('{{moldName}}',      sizeRecord.moldName)
    .replace('{{theme}}',         sizeRecord.theme)
    .replace('{{moldSize}}',      sizeRecord.moldSize)
    .replace('{{moldLength}}',    sizeRecord.moldLength)
    .replace('{{moldWidth}}',     sizeRecord.moldWidth)
    .replace('{{moldHeight}}',    sizeRecord.moldHeight)
    .replace('{{color}}',         sizeRecord.color)
    .replace('{{brand}}',         sizeRecord.brand)
    .replace('{{topic}}',         sizeRecord.topic)
    .replace('{{purpose}}',       sizeRecord.purpose)
    .replace('{{feedbackBlock}}', feedbackBlock);

  if (!openrouterKey && !openaiKey) {
    throw new Error('No API key set: OPENROUTER_API_KEY or OPENAI_API_KEY required');
  }

  // OpenRouter — приоритет для текстов
  if (openrouterKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${openrouterKey}`,
          'HTTP-Referer':  'https://github.com/mp-card-creator',
          'X-Title':       'mp-card-creator',
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: promptsTmpl.generate.system },
            { role: 'user',   content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      const data    = await res.json();
      const content = data.choices[0].message.content;
      const jsonStr = (content.match(/\{[\s\S]*\}/) || [content])[0];
      return JSON.parse(jsonStr);
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback: OPENAI_API_KEY + OPENAI_BASE_URL
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: promptsTmpl.generate.system },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data    = await res.json();
  const content = data.choices[0].message.content;
  const jsonStr = (content.match(/\{[\s\S]*\}/) || [content])[0];
  return JSON.parse(jsonStr);
}

// ---------------------------------------------------------------------------
// Critic — rule-based (no LLM)
// ---------------------------------------------------------------------------

function runCritic(texts, topic) {
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

  const tk = criticRules.topicKeywordCheck;
  if (tk?.enabled && topic) {
    const topicWords = topic.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 4);
    const fieldVal = (texts[tk.field] ?? '').toLowerCase();
    if (!topicWords.some(w => fieldVal.includes(w))) {
      issues.push(tk.message);
    }
  }

  const np = criticRules.noUnresolvedPlaceholders;
  if (np?.enabled) {
    if (new RegExp(np.pattern).test(texts[np.field] ?? '')) {
      issues.push(np.message);
    }
  }

  return { ok: issues.length === 0, issues };
}

exports.runCritic = runCritic;

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
