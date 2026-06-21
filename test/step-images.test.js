'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
// IMPORTANT: do NOT set OPENAI_API_KEY — the step-images stub branch is gated on
// `!apiKey` and must run so generation never hits the network nor reads a template (D-04).
delete process.env.OPENAI_API_KEY;

const { handler: apiHandler } = require('../functions/api/index.js');
const stepImages = require('../functions/step-images/index.js');
const { handler } = stepImages;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * createLine(article, moldType) — seeds master-data.json via api handler AND
 * uploads test-mold.png via the multipart files[] path so a photo artifact
 * exists at photos/v1 (REQUIRED for IMG-03 / D-03). Copied from step-texts.test.js.
 * Unique article per test to avoid cache-skip (Pitfall 5).
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

/**
 * createLineNoPhoto(article, moldType) — variant that seeds master-data WITHOUT
 * uploading any photo (files:[]). Goes through the api JSON path so no photo
 * artifact is written. Used to assert the D-03 "no mold photo found" → 400 branch.
 */
async function createLineNoPhoto(article, moldType) {
  const questionnaire = buildQuestionnaire(article, moldType);
  const result = await apiHandler({
    httpMethod: 'POST',
    path: '/lines',
    queryStringParameters: {},
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...questionnaire, force: true }),
    isBase64Encoded: false,
    files: [],
  });
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  assert.strictEqual(result.statusCode, 200,
    `createLineNoPhoto(${article}) failed: ${JSON.stringify(body)}`);
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

/**
 * runImages(article, size, imageType, extra) — calls step-images handler directly.
 * Always passes force:true to prevent cache-skip (Pitfall 5).
 */
async function runImages(article, size, imageType = 'infographic', extra = {}) {
  const result = await handler({
    body: JSON.stringify({ article, size, imageType, attempt: 1, force: true, ...extra }),
  });
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  return { statusCode: result.statusCode, body };
}

/**
 * readManifest(article) — reads manifest.json from local FS for deep inspection.
 * Copied verbatim from step-texts.test.js.
 */
function readManifest(article) {
  const manifestPath = path.join(process.env.OUTPUT_DIR, article, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/**
 * readSizeRecord(article, size) — loads the seeded master-data.json from the
 * version store and returns the SizeRecord for `size`. Used to feed buildEditRequest.
 */
function readSizeRecord(article, size) {
  const manifest = readManifest(article);
  const version = manifest.steps['01-normalize'].currentVersion;
  const mdPath = path.join(
    process.env.OUTPUT_DIR, article, '01-normalize', `v${version}`, 'master-data.json'
  );
  const masterData = JSON.parse(fs.readFileSync(mdPath, 'utf8'));
  return masterData.find(r => r.size === size);
}

// ---------------------------------------------------------------------------
// IMG-02/03/04: all 5 sizes (XS–XL) produce {size}_infographic.png
// ---------------------------------------------------------------------------

test('IMG-02/03/04: all 5 sizes produce {size}_infographic.png', async () => {
  const article = 'IMG5SZ';
  await createLine(article, 'hands');

  const sizes = ['XS', 'S', 'M', 'L', 'XL'];
  for (const size of sizes) {
    const { statusCode, body } = await runImages(article, size);
    assert.strictEqual(statusCode, 200,
      `Size ${size} failed: statusCode=${statusCode}, body=${JSON.stringify(body)}`);
    assert.strictEqual(body.artifactName, `${size}_infographic.png`,
      `Size ${size}: expected artifactName ${size}_infographic.png, got ${body.artifactName}`);
  }

  // Manifest must record one 03-images history entry per size.
  const manifest = readManifest(article);
  const history = manifest?.steps?.['03-images']?.history;
  assert.ok(Array.isArray(history) && history.length >= 5,
    `expected >=5 history entries for 03-images, got ${history ? history.length : 'none'}`);
  for (const size of sizes) {
    assert.ok(history.some(h => h.size === size && h.imageType === 'infographic'),
      `history missing entry for size ${size}`);
  }
});

// ---------------------------------------------------------------------------
// D-09: prompt has no unresolved {{...}} and never references faceSize
//
// Asserts buildEditRequest is exported (NOT today → RED) and that the prompt it
// builds from a real sizeRecord contains no unresolved tokens, no literal
// "faceSize" (which is undefined on every sizeRecord), and no "undefined".
// ---------------------------------------------------------------------------

test('D-09: buildEditRequest prompt has no unresolved {{...}}, no faceSize, no undefined', async () => {
  const article = 'IMGD09';
  await createLine(article, 'hands');

  assert.strictEqual(typeof stepImages.buildEditRequest, 'function',
    'buildEditRequest must be exported from functions/step-images/index.js (Plan 03-02 adds this)');

  const sizeRecord = readSizeRecord(article, 'M');
  const req = await stepImages.buildEditRequest(article, sizeRecord, 'infographic', []);

  assert.ok(req && typeof req.prompt === 'string' && req.prompt.length > 0,
    `buildEditRequest must return { prompt: string }, got: ${JSON.stringify(req)}`);
  assert.ok(!/\{\{[^}]+\}\}/.test(req.prompt),
    `prompt contains unresolved placeholder(s): ${req.prompt}`);
  assert.ok(!req.prompt.includes('faceSize'),
    `prompt must not contain the literal word "faceSize": ${req.prompt}`);
  assert.ok(!req.prompt.includes('undefined'),
    `prompt must not contain "undefined": ${req.prompt}`);
});

// ---------------------------------------------------------------------------
// IMG-03: mold photo used as reference (background + >=1 photo in image[])
// ---------------------------------------------------------------------------

test('IMG-03: buildEditRequest includes the mold photo as a reference (imageCount >= 2)', async () => {
  const article = 'IMGREF';
  await createLine(article, 'hands');

  assert.strictEqual(typeof stepImages.buildEditRequest, 'function',
    'buildEditRequest must be exported from functions/step-images/index.js (Plan 03-02 adds this)');

  const sizeRecord = readSizeRecord(article, 'M');
  const req = await stepImages.buildEditRequest(article, sizeRecord, 'infographic', []);

  assert.ok(typeof req.imageCount === 'number',
    `buildEditRequest must return numeric imageCount, got: ${JSON.stringify(req)}`);
  assert.ok(req.imageCount >= 2,
    `expected imageCount >= 2 (1 background + >=1 mold photo), got ${req.imageCount}`);
});

// ---------------------------------------------------------------------------
// D-10/D-11: manifest attempts[] accumulates with correctly-shaped entries
// ---------------------------------------------------------------------------

test('D-10/D-11: history attempts[] is a non-empty array of {attempt, criticVerdict}', async () => {
  const article = 'IMGATT';
  await createLine(article, 'hands');

  const { statusCode } = await runImages(article, 'M');
  assert.strictEqual(statusCode, 200, `expected 200, got ${statusCode}`);

  const manifest = readManifest(article);
  const history = manifest?.steps?.['03-images']?.history;
  assert.ok(Array.isArray(history) && history.length > 0,
    'manifest steps["03-images"].history should be a non-empty array');

  const lastEntry = history[history.length - 1];
  assert.ok(Array.isArray(lastEntry.attempts) && lastEntry.attempts.length > 0,
    `last history entry must have a non-empty attempts array: ${JSON.stringify(lastEntry)}`);
  assert.strictEqual(lastEntry.attempts[0].attempt, 1,
    `attempts[0].attempt must be 1, got ${JSON.stringify(lastEntry.attempts[0])}`);
  for (const entry of lastEntry.attempts) {
    assert.ok(typeof entry.attempt === 'number',
      `attempts entry missing numeric 'attempt': ${JSON.stringify(entry)}`);
    assert.ok(entry.criticVerdict && typeof entry.criticVerdict === 'object',
      `attempts entry missing 'criticVerdict' object: ${JSON.stringify(entry)}`);
  }
});

// ---------------------------------------------------------------------------
// D-03: 400 when no mold photo exists for the article
// ---------------------------------------------------------------------------

test('D-03: returns 400 "no mold photo found" when the line has no photo', async () => {
  const article = 'IMGNOP';
  await createLineNoPhoto(article, 'hands');

  const { statusCode, body } = await runImages(article, 'M');
  assert.strictEqual(statusCode, 400,
    `expected 400 when no photo, got ${statusCode}: ${JSON.stringify(body)}`);
  assert.ok(typeof body.error === 'string' && body.error.includes('no mold photo found'),
    `expected error to include "no mold photo found", got: ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------------
// IMG-01: regenerate route returns 202 (route-contract guard)
// ---------------------------------------------------------------------------

test('IMG-01: POST /lines/:id/steps/03-images/regenerate returns 202', async () => {
  const article = 'IMGRGN';
  await createLine(article, 'hands');

  const result = await apiHandler({
    httpMethod: 'POST',
    path: `/lines/${article}/steps/03-images/regenerate`,
    queryStringParameters: {},
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: true }),
    isBase64Encoded: false,
  });
  assert.strictEqual(result.statusCode, 202,
    `expected 202 from regenerate route, got ${result.statusCode}: ${result.body}`);
});

// ---------------------------------------------------------------------------
// IMG-04: generated slide is retrievable via GET artifacts
// ---------------------------------------------------------------------------

test('IMG-04: GET /lines/:id/steps/03-images/artifacts/M_infographic.png returns image/png', async () => {
  const article = 'IMG04A';
  await createLine(article, 'hands');

  const { statusCode, body: genBody } = await runImages(article, 'M');
  assert.strictEqual(statusCode, 200, `generation failed: ${JSON.stringify(genBody)}`);

  const result = await apiHandler({
    httpMethod: 'GET',
    path: `/lines/${article}/steps/03-images/artifacts/M_infographic.png`,
    queryStringParameters: {},
    headers: {},
    body: '',
    isBase64Encoded: false,
  });
  assert.strictEqual(result.statusCode, 200,
    `expected 200 from artifact GET, got ${result.statusCode}: ${result.body}`);
  assert.strictEqual(result.headers['Content-Type'], 'image/png',
    `expected Content-Type image/png, got: ${result.headers['Content-Type']}`);
  assert.ok(result.isBase64Encoded, 'response should be base64 encoded');
});
