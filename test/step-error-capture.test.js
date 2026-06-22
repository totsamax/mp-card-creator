'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
process.env.USE_STUB = 'true';
// step-images stub branch is gated on `!OPENAI_API_KEY` — keep it unset so
// image generation never hits the network in tests.
delete process.env.OPENAI_API_KEY;

const SHARED = process.env.SHARED_LAYER_PATH;
const store = require(path.join(SHARED, 'versionStore'));

const { handler: apiHandler } = require('../functions/api/index.js');
const stepTexts = require('../functions/step-texts/index.js');
const stepImages = require('../functions/step-images/index.js');

// ---------------------------------------------------------------------------
// Helpers — mirror the stubbing style used in step-texts.test.js / step-images.test.js
// ---------------------------------------------------------------------------

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
 * createLine(article, moldType) — seeds master-data.json AND uploads a photo
 * (so the step-images no-photo 400 guard is passed). Unique article per test.
 */
async function createLine(article, moldType) {
  const photoBuffer = fs.readFileSync(path.join(__dirname, 'fixtures/test-mold.png'));
  const event = {
    httpMethod: 'POST',
    path: '/lines',
    queryStringParameters: {},
    headers: { 'content-type': 'multipart/form-data' },
    body: '',
    isBase64Encoded: false,
    files: [{ filename: 'test-mold.png', mimeType: 'image/png', buffer: photoBuffer }],
    formFields: { questionnaire: JSON.stringify(buildQuestionnaire(article, moldType)) },
  };
  const result = await apiHandler(event);
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  assert.strictEqual(result.statusCode, 200, `createLine(${article}) failed: ${JSON.stringify(body)}`);
  return body;
}

function readManifest(article) {
  const manifestPath = path.join(process.env.OUTPUT_DIR, article, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

/**
 * withThrowingPutArtifact(fn) — temporarily monkeypatches store.putArtifact so
 * any step that reaches its save phase throws deterministically (no network).
 * This forces the handler's error path without relying on AI API behavior.
 */
async function withThrowingPutArtifact(fn) {
  const original = store.putArtifact;
  store.putArtifact = async () => { throw new Error('forced generation failure'); };
  try {
    return await fn();
  } finally {
    store.putArtifact = original;
  }
}

// ---------------------------------------------------------------------------
// Test 1: step-texts records error + failedAt on generation failure
// ---------------------------------------------------------------------------

test('step-texts records error + failedAt on generation failure', async () => {
  await createLine('ERRTXT1', 'hands');

  const result = await withThrowingPutArtifact(() =>
    stepTexts.handler({ body: JSON.stringify({ article: 'ERRTXT1', size: 'M', attempt: 1, force: true }) })
  );

  assert.strictEqual(result.statusCode, 500,
    `expected 500 on generation failure, got ${result.statusCode}`);

  const manifest = readManifest('ERRTXT1');
  const stepMeta = manifest?.steps?.['02-texts'];
  assert.ok(stepMeta, 'manifest steps["02-texts"] must exist after a failure');
  assert.ok(typeof stepMeta.error === 'string' && stepMeta.error.length > 0,
    `expected non-empty error string, got: ${JSON.stringify(stepMeta.error)}`);
  assert.ok(ISO_RE.test(stepMeta.failedAt || ''),
    `expected ISO failedAt timestamp, got: ${JSON.stringify(stepMeta.failedAt)}`);
});

// ---------------------------------------------------------------------------
// Test 2: step-images records error + failedAt on generation failure
// ---------------------------------------------------------------------------

test('step-images records error + failedAt on generation failure', async () => {
  await createLine('ERRIMG1', 'hands'); // uploads photo → passes no-photo 400 guard

  const result = await withThrowingPutArtifact(() =>
    stepImages.handler({ body: JSON.stringify({ article: 'ERRIMG1', size: 'M', imageType: 'infographic', attempt: 1, force: true }) })
  );

  assert.strictEqual(result.statusCode, 500,
    `expected 500 on generation failure, got ${result.statusCode}`);

  const manifest = readManifest('ERRIMG1');
  const stepMeta = manifest?.steps?.['03-images'];
  assert.ok(stepMeta, 'manifest steps["03-images"] must exist after a failure');
  assert.ok(typeof stepMeta.error === 'string' && stepMeta.error.length > 0,
    `expected non-empty error string, got: ${JSON.stringify(stepMeta.error)}`);
  assert.ok(ISO_RE.test(stepMeta.failedAt || ''),
    `expected ISO failedAt timestamp, got: ${JSON.stringify(stepMeta.failedAt)}`);
});

// ---------------------------------------------------------------------------
// Test 3: a successful step clears a previously-recorded error
// ---------------------------------------------------------------------------

test('successful step clears prior error', async () => {
  await createLine('ERRTXT2', 'hands');

  // Pre-seed a prior failure on 02-texts.
  await store.updateManifest('ERRTXT2', '02-texts', {
    error: 'old failure',
    failedAt: '2026-01-01T00:00:00.000Z',
  });

  const before = readManifest('ERRTXT2');
  assert.strictEqual(before.steps['02-texts'].error, 'old failure',
    'precondition: prior error must be seeded');

  // Run a SUCCESSFUL step-texts (USE_STUB=true → templateTexts, no network).
  const result = await stepTexts.handler({
    body: JSON.stringify({ article: 'ERRTXT2', size: 'M', attempt: 1, force: true }),
  });
  assert.strictEqual(result.statusCode, 200,
    `expected 200 on success, got ${result.statusCode}: ${result.body}`);

  const after = readManifest('ERRTXT2');
  const stepMeta = after.steps['02-texts'];
  assert.strictEqual(stepMeta.error, null,
    `expected error cleared to null on success, got: ${JSON.stringify(stepMeta.error)}`);
  assert.strictEqual(stepMeta.failedAt, null,
    `expected failedAt cleared to null on success, got: ${JSON.stringify(stepMeta.failedAt)}`);
});
