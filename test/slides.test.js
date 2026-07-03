'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
// IMPORTANT: do NOT set OPENAI_API_KEY — the generate-prompt stub branch (D-11) is
// gated on `!process.env.OPENAI_API_KEY`; deleting it keeps every test offline.
delete process.env.OPENAI_API_KEY;

// Hermetic runs: clear any leftover local store from prior runs. The fixed
// article ids below are reused across runs, and the round-trip test (D-10)
// reads the current config and appends — it needs a clean baseline each run.
try { fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); } catch { /* ok */ }

const { handler: apiHandler } = require('../functions/api/index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * createLine(article, moldType) — seeds master-data.json via the api handler AND
 * uploads test-mold.png through the multipart files[] path so a photo artifact and
 * an 01-normalize version exist for the article. Copied from step-images.test.js.
 * Unique article per test avoids cache-skip.
 */
async function createLine(article, moldType) {
  const photoBuffer = fs.readFileSync(path.join(__dirname, 'fixtures/test-mold.png'));
  const questionnaire = buildQuestionnaire(article, moldType);

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

function buildQuestionnaire(article, moldType) {
  return {
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
}

/** getSlides(article) — GET /lines/:id/slides. Returns { statusCode, body }. */
async function getSlides(article) {
  const result = await apiHandler({
    httpMethod: 'GET',
    path: `/lines/${article}/slides`,
    queryStringParameters: {},
    headers: {},
    body: '',
    isBase64Encoded: false,
  });
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  return { statusCode: result.statusCode, body };
}

/** saveSlides(article, config) — POST /lines/:id/slides with a JSON body. */
async function saveSlides(article, config) {
  const result = await apiHandler({
    httpMethod: 'POST',
    path: `/lines/${article}/slides`,
    queryStringParameters: {},
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
    isBase64Encoded: false,
  });
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  return { statusCode: result.statusCode, body };
}

/** postJson(article, restPath, payload) — generic POST helper for slide sub-routes. */
async function postJson(article, restPath, payload) {
  const result = await apiHandler({
    httpMethod: 'POST',
    path: `/lines/${article}${restPath}`,
    queryStringParameters: {},
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
    isBase64Encoded: false,
  });
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  return { statusCode: result.statusCode, body };
}

// ---------------------------------------------------------------------------
// D-03 / D-10: GET /slides seeds 4 defaults when no slidesConfig is stored
// ---------------------------------------------------------------------------

test('D-03: GET /slides returns 4 default slides (main/infographic/scale/lifestyle)', async () => {
  const article = 'SLDDEF';
  await createLine(article, 'hands');

  const { statusCode, body } = await getSlides(article);
  assert.strictEqual(statusCode, 200, `expected 200, got ${statusCode}: ${JSON.stringify(body)}`);
  assert.ok(typeof body.feedbackSuffix === 'string' && body.feedbackSuffix.length > 0,
    `expected a non-empty feedbackSuffix string, got: ${JSON.stringify(body.feedbackSuffix)}`);
  assert.ok(Array.isArray(body.slides), 'body.slides must be an array');
  assert.strictEqual(body.slides.length, 4, `expected 4 default slides, got ${body.slides.length}`);

  const ids = body.slides.map(s => s.id);
  assert.deepStrictEqual(ids, ['main', 'infographic', 'scale', 'lifestyle'],
    `default slide ids must be main/infographic/scale/lifestyle in order, got ${JSON.stringify(ids)}`);

  for (const s of body.slides) {
    assert.ok(typeof s.description === 'string' && s.description.length > 0,
      `slide ${s.id} must have a non-empty description`);
    assert.ok(typeof s.generatedPrompt === 'string' && s.generatedPrompt.length > 0,
      `slide ${s.id} must have a generatedPrompt`);
    assert.strictEqual(s.default, true, `slide ${s.id} must have default:true`);
    assert.deepStrictEqual(s.files, [], `slide ${s.id} must start with files:[]`);
  }
});

// ---------------------------------------------------------------------------
// D-10: POST /slides persists the whole config; a follow-up GET round-trips it
// ---------------------------------------------------------------------------

test('D-10: POST /slides persists and GET round-trips the same slides (incl. a custom slide)', async () => {
  const article = 'SLDRTP';
  await createLine(article, 'hands');

  const initial = (await getSlides(article)).body;
  const customSlide = {
    id: 'custom-test1', label: 'Новый слайд', description: 'x',
    generatedPrompt: '', files: [], default: false,
  };
  const config = {
    feedbackSuffix: initial.feedbackSuffix,
    slides: [...initial.slides, customSlide],
  };

  const save = await saveSlides(article, config);
  assert.strictEqual(save.statusCode, 200, `POST /slides failed: ${JSON.stringify(save.body)}`);

  const after = (await getSlides(article)).body;
  assert.strictEqual(after.slides.length, 5, `expected 5 slides after save, got ${after.slides.length}`);
  assert.deepStrictEqual(after.slides, config.slides,
    'round-tripped slides array must deep-equal what was posted (order + fields preserved)');
  assert.strictEqual(after.feedbackSuffix, config.feedbackSuffix,
    'feedbackSuffix must round-trip');
});

// ---------------------------------------------------------------------------
// D-11: generate-prompt returns a non-empty string via the offline stub path
// ---------------------------------------------------------------------------

test('D-11: POST /slides/:id/generate-prompt returns a non-empty prompt (no-key stub)', async () => {
  const article = 'SLDGEN';
  await createLine(article, 'hands');

  const { statusCode, body } = await postJson(
    article, '/slides/main/generate-prompt', { description: 'инфографика с размерами' }
  );
  assert.strictEqual(statusCode, 200, `expected 200, got ${statusCode}: ${JSON.stringify(body)}`);
  assert.strictEqual(body.slideId, 'main', `expected slideId "main", got ${body.slideId}`);
  assert.ok(typeof body.generatedPrompt === 'string' && body.generatedPrompt.length > 0,
    `generatedPrompt must be a non-empty string, got: ${JSON.stringify(body.generatedPrompt)}`);
});

test('D-11: generate-prompt with empty/missing description returns 400', async () => {
  const article = 'SLDGENE';
  await createLine(article, 'hands');

  const empty = await postJson(article, '/slides/main/generate-prompt', { description: '' });
  assert.strictEqual(empty.statusCode, 400,
    `empty description must be 400, got ${empty.statusCode}: ${JSON.stringify(empty.body)}`);

  const missing = await postJson(article, '/slides/main/generate-prompt', {});
  assert.strictEqual(missing.statusCode, 400,
    `missing description must be 400, got ${missing.statusCode}: ${JSON.stringify(missing.body)}`);
});

// ---------------------------------------------------------------------------
// D-12: single-slide regenerate returns 202 (route contract only)
// ---------------------------------------------------------------------------

test('D-12: POST /slides/:id/regenerate returns 202 { queued:true }', async () => {
  const article = 'SLDRGN';
  await createLine(article, 'hands');

  const { statusCode, body } = await postJson(article, '/slides/main/regenerate', {});
  assert.strictEqual(statusCode, 202, `expected 202, got ${statusCode}: ${JSON.stringify(body)}`);
  assert.strictEqual(body.queued, true, `expected queued:true, got ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------------
// D-09: multipart slide-file upload stores a blob and records a retrievable ref
// ---------------------------------------------------------------------------

test('D-09: POST /slides/:id/files stores a blob, returns a ref, and the ref is retrievable', async () => {
  const article = 'SLDUPL';
  await createLine(article, 'hands');

  const fileBuffer = fs.readFileSync(path.join(__dirname, 'fixtures/test-mold.png'));
  const uploadResult = await apiHandler({
    httpMethod: 'POST',
    path: `/lines/${article}/slides/main/files`,
    queryStringParameters: {},
    headers: { 'content-type': 'multipart/form-data' },
    body: '',
    isBase64Encoded: false,
    files: [
      { filename: 'test-mold.png', mimeType: 'image/png', buffer: fileBuffer }
    ],
    formFields: {},
  });
  const upBody = typeof uploadResult.body === 'string' ? JSON.parse(uploadResult.body) : uploadResult.body;
  assert.strictEqual(uploadResult.statusCode, 200,
    `upload failed: ${JSON.stringify(upBody)}`);
  assert.ok(typeof upBody.ref === 'string' &&
    upBody.ref.startsWith(`/lines/${article}/steps/slide-files/artifacts/`),
    `ref must point under slide-files/artifacts, got: ${JSON.stringify(upBody.ref)}`);

  // The ref appears inside slide "main"'s files[] on a subsequent GET /slides.
  const after = (await getSlides(article)).body;
  const main = after.slides.find(s => s.id === 'main');
  assert.ok(main && Array.isArray(main.files) && main.files.includes(upBody.ref),
    `slide main.files must include the uploaded ref, got: ${JSON.stringify(main && main.files)}`);

  // GET on the returned ref path returns 200.
  const getRef = await apiHandler({
    httpMethod: 'GET',
    path: upBody.ref,
    queryStringParameters: {},
    headers: {},
    body: '',
    isBase64Encoded: false,
  });
  assert.strictEqual(getRef.statusCode, 200,
    `GET on the ref path must return 200, got ${getRef.statusCode}: ${getRef.body}`);
});

// ---------------------------------------------------------------------------
// Security (T-999.1-01): an out-of-charset slideId is rejected with 400
// before any store call.
// ---------------------------------------------------------------------------

test('Security: generate-prompt with an out-of-charset slideId returns 400', async () => {
  const article = 'SLDSEC';
  await createLine(article, 'hands');

  // %2e%2e%2fetc decodes to "../etc" — a slideId that must fail /^[a-zA-Z0-9_-]{1,64}$/.
  const result = await apiHandler({
    httpMethod: 'POST',
    path: `/lines/${article}/slides/..%2Fetc/generate-prompt`,
    queryStringParameters: {},
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'x' }),
    isBase64Encoded: false,
  });
  assert.strictEqual(result.statusCode, 400,
    `out-of-charset slideId must be 400, got ${result.statusCode}: ${result.body}`);
});
