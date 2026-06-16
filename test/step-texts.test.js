'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
process.env.USE_STUB = 'true';

const { handler: apiHandler } = require('../functions/api/index.js');
const stepTexts = require('../functions/step-texts/index.js');
const { handler } = stepTexts;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * createLine(article, moldType) — seeds master-data.json via api handler.
 * Uses a multipart-style event identical in shape to create-line.smoke.test.js.
 * Unique article per test to avoid cache-skip (Pitfall 5).
 */
async function createLine(article, moldType) {
  const photoBuffer = fs.readFileSync(path.join(__dirname, 'fixtures/test-mold.png'));
  const questionnaire = {
    article,
    moldType,
    moldName: 'ТестМолд',
    brand: 'ТопМолд',
    theme: 'Тест',
    color: 'Белый',
    priceBaseM: 1000,
    title: 'Тестовый молд',
    category: 'Молды',
    sizes: [
      { size: 'XS', moldSize: 50,  moldLength: 5.0,  moldWidth: 4.0,  moldHeight: 1.5, moldWeight: 80  },
      { size: 'S',  moldSize: 65,  moldLength: 6.5,  moldWidth: 5.2,  moldHeight: 1.8, moldWeight: 110 },
      { size: 'M',  moldSize: 80,  moldLength: 8.0,  moldWidth: 6.3,  moldHeight: 2.0, moldWeight: 145 },
      { size: 'L',  moldSize: 95,  moldLength: 9.5,  moldWidth: 7.4,  moldHeight: 2.2, moldWeight: 185 },
      { size: 'XL', moldSize: 110, moldLength: 11.0, moldWidth: 8.5,  moldHeight: 2.5, moldWeight: 230 },
    ],
    photos: [],
    material: 'Платиновый силикон',
    hardness: 'Shore 20A',
  };

  const event = {
    httpMethod: 'POST',
    path: '/lines',
    queryStringParameters: {},
    headers: { 'content-type': 'multipart/form-data' },
    body: '',
    isBase64Encoded: false,
    files: [
      { filename: 'test-mold.png', mimeType: 'image/png', buffer: photoBuffer }
    ],
    formFields: {
      questionnaire: JSON.stringify(questionnaire),
    },
  };

  const result = await apiHandler(event);
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  assert.strictEqual(result.statusCode, 200,
    `createLine(${article}) failed: ${JSON.stringify(body)}`);
  return body;
}

/**
 * runTexts(article, size, extra) — calls step-texts handler directly (NOT via runLocally).
 * Always passes force:true to prevent cache-skip.
 */
async function runTexts(article, size, extra = {}) {
  const result = await handler({
    body: JSON.stringify({ article, size, attempt: 1, force: true, ...extra }),
  });
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  return { statusCode: result.statusCode, body };
}

/**
 * readManifest(article) — reads manifest.json from local FS for deep inspection.
 */
function readManifest(article) {
  const manifestPath = path.join(process.env.OUTPUT_DIR, article, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// TXT-02: No unresolved {{...}} placeholders
// ---------------------------------------------------------------------------

test('TXT-02: generated texts contain no unresolved {{...}} placeholders', async () => {
  await createLine('TXT02A', 'hands');
  const { statusCode, body } = await runTexts('TXT02A', 'M');

  assert.strictEqual(statusCode, 200, `Expected 200, got ${statusCode}: ${JSON.stringify(body)}`);
  assert.ok(body.texts, 'body.texts should be present');
  assert.ok(typeof body.texts.titleFull === 'string' && body.texts.titleFull.length > 0,
    'titleFull should be a non-empty string');

  // Must not contain any unresolved {{token}} pattern
  const jsonStr = JSON.stringify(body.texts);
  assert.ok(!/\{\{[^}]+\}\}/.test(jsonStr),
    `texts contain unresolved placeholder(s): ${jsonStr}`);

  // titleFull must not be the raw faceSize-referencing string (BUG-01 regression guard)
  assert.ok(!body.texts.titleFull.includes('faceSize'),
    'titleFull must not contain the literal word "faceSize"');
});

// ---------------------------------------------------------------------------
// TXT-02: moldType=hands texts do not mention "лицо"/"личик"
// ---------------------------------------------------------------------------

test('TXT-02: moldType=hands texts do not mention "лицо" or "личик"', async () => {
  await createLine('TXT02B', 'hands');
  const { statusCode, body } = await runTexts('TXT02B', 'M');

  assert.strictEqual(statusCode, 200, `Expected 200, got ${statusCode}: ${JSON.stringify(body)}`);
  assert.ok(body.texts, 'body.texts should be present');

  const jsonLower = JSON.stringify(body.texts).toLowerCase();
  assert.ok(!jsonLower.includes('лицо'),
    'hands moldType texts must not contain "лицо"');
  assert.ok(!jsonLower.includes('личик'),
    'hands moldType texts must not contain "личик"');
});

// ---------------------------------------------------------------------------
// TXT-01: All 5 sizes (XS–XL) produce a texts artifact
// ---------------------------------------------------------------------------

test('TXT-01: all 5 sizes (XS-XL) produce a texts artifact', async () => {
  await createLine('TXT01A', 'hands');

  const sizes = ['XS', 'S', 'M', 'L', 'XL'];
  for (const size of sizes) {
    // Each size gets its own version folder — do NOT assert they share one folder (Pitfall 1)
    const { statusCode, body } = await runTexts('TXT01A', size);
    assert.strictEqual(statusCode, 200,
      `Size ${size} failed: statusCode=${statusCode}, body=${JSON.stringify(body)}`);
    assert.ok(body.texts,
      `Size ${size}: body.texts should be present`);
    assert.ok(typeof body.texts.titleFull === 'string' && body.texts.titleFull.length > 0,
      `Size ${size}: titleFull should be a non-empty string`);
  }
});

// ---------------------------------------------------------------------------
// TXT-03: Critic rejection recurses up to MAX_ATTEMPTS then stops with needsReview
//
// To force critic rejection deterministically with USE_STUB=true, we create a line
// with moldType='other' where sizeRecord.topic='Молд для рукоделия'. The stub
// templateTexts returns sizeRecord.titleFull. After Plan 03 implements topicKeywordCheck,
// if topic words don't appear in titleFull the critic will reject.
//
// For the RED contract, we assert the exported runCritic function exists (it doesn't yet)
// and test the full recursion path via the handler. The needsReview===true assertion
// proves recursion terminates at MAX_ATTEMPTS — this FAILS today because:
//   (a) current critic rules don't include topicKeywordCheck, so the stub texts pass
//       critic and needsReview is false after 1 attempt.
//   The test is intentionally RED against current code.
// ---------------------------------------------------------------------------

test('TXT-03: critic rejection recurses up to MAX_ATTEMPTS then stops with needsReview', async () => {
  // We use moldType='face' with a stub that generates titleFull for faces.
  // After Plan 03, topicKeywordCheck will be active. Today it isn't — this test is RED
  // because the current handler never sets needsReview:true from critic (no topicKeyword rule).
  //
  // However, we can force a rejection via the requiredSubstrings rule today:
  // titleFull must contain 'молд' AND 'силиконовый'. The stub returns sizeRecord.titleFull
  // from templateEngine, which DOES contain both for standard moldTypes.
  //
  // The reliable RED path: assert body.needsReview === true AND attempts.length === 3.
  // With current code, no rejection happens (critic passes the stub), so body.needsReview
  // will be false — making this assertion FAIL (RED). Plans 02/03 make it GREEN by
  // implementing topicKeywordCheck which will reject stub texts when topic words absent.
  //
  // For test isolation, we verify the recursion TERMINATION CONTRACT:
  // When critic rejects all 3 attempts, handler MUST return 200 (not 202) with needsReview:true.

  await createLine('TXT03A', 'face');
  const { statusCode, body } = await runTexts('TXT03A', 'M');

  // After Plans 02+03: topicKeywordCheck fires, recursion runs 3x, then needsReview:true
  // Today: critic passes stub texts → needsReview:false → this assertion FAILS (RED)
  assert.strictEqual(statusCode, 200,
    `Expected 200 (terminal save branch), got ${statusCode}: ${JSON.stringify(body)}`);
  assert.strictEqual(body.needsReview, true,
    `Expected needsReview===true after critic exhaustion, got: ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------------
// TXT-03: manifest history attempts[] records every attempt verdict
// ---------------------------------------------------------------------------

test('TXT-03: manifest history attempts[] records every attempt verdict', async () => {
  // Reuse TXT03A article seeded above (same article ID is fine — force:true bypasses cache)
  // For this test to work, TXT03A must already exist from the previous test.
  // We call runTexts again to get a fresh history entry.
  await createLine('TXT03B', 'face');
  const { statusCode, body } = await runTexts('TXT03B', 'M');

  assert.strictEqual(statusCode, 200,
    `Expected 200, got ${statusCode}: ${JSON.stringify(body)}`);

  // Read manifest from disk to inspect history (not via API — avoid dotted-path trap)
  const manifest = readManifest('TXT03B');
  const history = manifest?.steps?.['02-texts']?.history;
  assert.ok(Array.isArray(history) && history.length > 0,
    'manifest steps["02-texts"].history should be a non-empty array');

  const lastEntry = history[history.length - 1];
  assert.ok(Array.isArray(lastEntry.attempts),
    'last history entry must have attempts array');

  // After Plans 02+03: 3 attempts recorded (topicKeywordCheck fires on each)
  // Today: only 1 attempt (critic passes immediately) → this FAILS (RED)
  assert.strictEqual(lastEntry.attempts.length, 3,
    `Expected 3 attempts in history, got ${lastEntry.attempts.length}: ${JSON.stringify(lastEntry.attempts)}`);

  // Each element must have attempt number and criticVerdict
  for (const entry of lastEntry.attempts) {
    assert.ok(typeof entry.attempt === 'number',
      `attempts entry missing 'attempt' number: ${JSON.stringify(entry)}`);
    assert.ok(entry.criticVerdict && typeof entry.criticVerdict === 'object',
      `attempts entry missing 'criticVerdict' object: ${JSON.stringify(entry)}`);
  }
});

// ---------------------------------------------------------------------------
// DEC-03 runCritic: exported function exists and noUnresolvedPlaceholders rule works
//
// runCritic is NOT exported today → typeof stepTexts.runCritic === 'undefined' → RED.
// Plan 03 exports it. This test asserts the export AND the rule behavior.
// ---------------------------------------------------------------------------

test('DEC-03 runCritic: noUnresolvedPlaceholders flags annotation containing {{x}}', () => {
  // Assert export exists — FAILS today (runCritic is not exported)
  assert.strictEqual(typeof stepTexts.runCritic, 'function',
    'runCritic must be exported from functions/step-texts/index.js (Plan 03 adds this)');

  const runCritic = stepTexts.runCritic;

  // After Plan 03 implements noUnresolvedPlaceholders rule:
  const texts = {
    titleShort: 'Молд ТестМолд 80см',
    titleFull:  'Молд силиконовый «ТестМолд», форма для рук куклы, 8.0x6.3x2.0 см, ТопМолд',
    annotation: 'Авторский силиконовый молд с {{unresolvedToken}} плейсхолдером.',
  };

  const verdict = runCritic(texts, 'Руки куклы, кисти рук');
  assert.strictEqual(verdict.ok, false,
    'runCritic should return ok:false when annotation contains {{token}}');
  assert.ok(
    verdict.issues.some(i => /плейсхолдер|placeholder/i.test(i)),
    `Expected issues to mention placeholder, got: ${JSON.stringify(verdict.issues)}`
  );
});

// ---------------------------------------------------------------------------
// DEC-03 runCritic: topicKeywordCheck flags titleFull missing topic words
// ---------------------------------------------------------------------------

test('DEC-03 runCritic: topicKeywordCheck flags titleFull missing topic words', () => {
  // Assert export exists — FAILS today (runCritic is not exported)
  assert.strictEqual(typeof stepTexts.runCritic, 'function',
    'runCritic must be exported from functions/step-texts/index.js (Plan 03 adds this)');

  const runCritic = stepTexts.runCritic;

  // titleFull has no words from topic 'Руки куклы, кисти рук' (≥4 chars: руки, куклы, кисти)
  const texts = {
    titleShort: 'Молд ТестМолд 80см',
    titleFull:  'Молд силиконовый «ТестМолд», форма для изделий, 8.0x6.3x2.0 см, ТопМолд',
    annotation: 'Авторский силиконовый молд для рукоделия.',
  };

  const verdict = runCritic(texts, 'Руки куклы, кисти рук');
  assert.strictEqual(verdict.ok, false,
    'runCritic should return ok:false when titleFull contains none of the topic keywords');
  assert.ok(
    verdict.issues.some(i => /тем|topic|ключ/i.test(i)),
    `Expected issues to mention topic keywords, got: ${JSON.stringify(verdict.issues)}`
  );
});
