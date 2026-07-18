'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output-crud');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
delete process.env.OPENAI_API_KEY;

// Clean slate each run — article ids are deterministic within a run but may
// collide across runs if OUTPUT_DIR is not wiped.
try { fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); } catch { /* ok */ }

const { handler } = require('../functions/api/index.js');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const PHOTO_PATH = path.join(__dirname, 'fixtures/test-mold.png');

function buildQuestionnaire(article, overrides = {}) {
  return {
    article,
    moldType: 'face',
    moldName: 'CRUD Тест молд',
    brand: 'ТопМолд',
    theme: 'тест',
    color: 'белый',
    priceBaseM: 1200,
    sizes: [
      { size: 'XS', moldSize: 50,  moldLength: 5.0,  moldWidth: 4.0,  moldHeight: 1.5, moldWeight: 80  },
      { size: 'S',  moldSize: 65,  moldLength: 6.5,  moldWidth: 5.2,  moldHeight: 1.8, moldWeight: 110 },
      { size: 'M',  moldSize: 80,  moldLength: 8.0,  moldWidth: 6.3,  moldHeight: 2.0, moldWeight: 145 },
      { size: 'L',  moldSize: 95,  moldLength: 9.5,  moldWidth: 7.4,  moldHeight: 2.2, moldWeight: 185 },
      { size: 'XL', moldSize: 110, moldLength: 11.0, moldWidth: 8.5,  moldHeight: 2.5, moldWeight: 230 },
    ],
    photos: [],
    artifacts: ['images', 'excel-ozon', 'excel-wb'],
    ...overrides,
  };
}

async function invoke(method, urlPath, { body = null, files = null, formFields = null } = {}) {
  const event = {
    httpMethod: method,
    path: urlPath,
    queryStringParameters: {},
    headers: files ? { 'content-type': 'multipart/form-data' } : { 'content-type': 'application/json' },
    body: body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : '',
    isBase64Encoded: false,
  };
  if (files)       event.files       = files;
  if (formFields)  event.formFields  = formFields;
  const result = await handler(event);
  const parsed = result.body
    ? (result.isBase64Encoded ? result.body : (() => { try { return JSON.parse(result.body); } catch { return result.body; } })())
    : null;
  return { statusCode: result.statusCode, body: parsed, headers: result.headers || {} };
}

async function createLine(article, overrides = {}) {
  const photo = fs.readFileSync(PHOTO_PATH);
  const q = buildQuestionnaire(article, overrides);
  const r = await invoke('POST', '/lines', {
    files:      [{ filename: 'test-mold.png', mimeType: 'image/png', buffer: photo }],
    formFields: { questionnaire: JSON.stringify(q) },
  });
  assert.strictEqual(r.statusCode, 200, `createLine(${article}) → ${r.statusCode}: ${JSON.stringify(r.body)}`);
  return r.body;
}

// ---------------------------------------------------------------------------
// CRUD-01: POST /lines JSON path — создание линейки без фото
// ---------------------------------------------------------------------------

test('CRUD-01: POST /lines JSON → 200, masterData[5], questionnaire stored', async () => {
  const q = buildQuestionnaire('CRUD01');
  const r = await invoke('POST', '/lines', { body: q });

  assert.strictEqual(r.statusCode, 200, `expected 200, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
  assert.strictEqual(r.body.article, 'CRUD01');
  assert.strictEqual(r.body.stepId, '01-normalize');
  assert.ok(Array.isArray(r.body.masterData) && r.body.masterData.length === 5,
    `masterData must be 5-element array, got ${r.body.masterData?.length}`);
  assert.strictEqual(r.body.masterData[2].size, 'M');
  assert.ok(r.body.questionnaire, 'response must include questionnaire');
});

// ---------------------------------------------------------------------------
// CRUD-02: POST /lines multipart — фото сохраняется, photoTypes маппятся
// ---------------------------------------------------------------------------

test('CRUD-02: POST /lines multipart → photo saved, questionnaire.photos populated', async () => {
  const photo = fs.readFileSync(PHOTO_PATH);
  const q = buildQuestionnaire('CRUD02');
  const r = await invoke('POST', '/lines', {
    files:      [{ filename: 'test-mold.png', mimeType: 'image/png', buffer: photo }],
    formFields: {
      questionnaire: JSON.stringify(q),
      photoTypes: JSON.stringify({ 'test-mold.png': 'mold' }),
    },
  });

  assert.strictEqual(r.statusCode, 200, `expected 200, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body.questionnaire?.photos) && r.body.questionnaire.photos.length > 0,
    'questionnaire.photos must be non-empty after multipart upload');
  assert.ok(r.body.questionnaire.photos[0].includes('CRUD02'),
    `photo ref must contain article, got: ${r.body.questionnaire.photos[0]}`);
  // photoTypes written into questionnaire
  assert.deepStrictEqual(r.body.questionnaire.photoTypes, { 'test-mold.png': 'mold' },
    'questionnaire.photoTypes must reflect the uploaded mapping');
});

// ---------------------------------------------------------------------------
// CRUD-03: POST /lines — невалидный article → 400
// ---------------------------------------------------------------------------

test('CRUD-03: POST /lines with invalid article → 400', async () => {
  const cases = [
    { article: '',          label: 'empty' },
    { article: '../escape', label: 'path traversal' },
    { article: 'a'.repeat(65), label: 'too long (65 chars)' },
  ];
  for (const { article, label } of cases) {
    const q = buildQuestionnaire(article);
    const r = await invoke('POST', '/lines', { body: q });
    assert.strictEqual(r.statusCode, 400,
      `${label}: expected 400, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
  }
});

// ---------------------------------------------------------------------------
// CRUD-04: GET /lines — только что созданная линейка появляется в списке
// ---------------------------------------------------------------------------

test('CRUD-04: GET /lines includes a just-created article', async () => {
  await createLine('CRUD04');

  const r = await invoke('GET', '/lines');
  assert.strictEqual(r.statusCode, 200);
  assert.ok(Array.isArray(r.body.lines), 'body.lines must be an array');
  const found = r.body.lines.find(l => l.article === 'CRUD04');
  assert.ok(found, `CRUD04 must appear in /lines, got: ${JSON.stringify(r.body.lines.map(l => l.article))}`);
  assert.ok(found.moldName, 'list entry must include moldName');
  assert.ok(Array.isArray(found.sizes) && found.sizes.length === 5, 'list entry must include sizes[5]');
});

// ---------------------------------------------------------------------------
// CRUD-05: GET /lines/:id/manifest — манифест содержит шаг 01-normalize
// ---------------------------------------------------------------------------

test('CRUD-05: GET /lines/:id/manifest returns manifest with 01-normalize step', async () => {
  await createLine('CRUD05');

  const r = await invoke('GET', '/lines/CRUD05/manifest');
  assert.strictEqual(r.statusCode, 200, `expected 200, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.steps?.['01-normalize'], 'manifest must have steps[01-normalize]');
  assert.ok(r.body.steps['01-normalize'].currentVersion >= 1, 'currentVersion must be >= 1');
  assert.ok(Array.isArray(r.body.steps['01-normalize'].history) &&
    r.body.steps['01-normalize'].history.length > 0,
    'history must be non-empty');
  // History entry stores the full questionnaire for CRUD-02 restore
  assert.ok(r.body.steps['01-normalize'].history[0].questionnaire,
    'history[0].questionnaire must be stored');
});

// ---------------------------------------------------------------------------
// CRUD-06: PUT /lines/:id/questionnaire — обновляет опросник, создаёт новую версию
// ---------------------------------------------------------------------------

test('CRUD-06: PUT /lines/:id/questionnaire re-normalizes and bumps version', async () => {
  await createLine('CRUD06');

  const updated = buildQuestionnaire('CRUD06', { moldName: 'Обновлённый молд', theme: 'новая тема' });
  const r = await invoke('PUT', '/lines/CRUD06/questionnaire', { body: updated });

  assert.strictEqual(r.statusCode, 200, `expected 200, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
  assert.strictEqual(r.body.article, 'CRUD06');

  // Version must have bumped
  const manifest = (await invoke('GET', '/lines/CRUD06/manifest')).body;
  assert.ok(manifest.steps['01-normalize'].currentVersion >= 2,
    `version must be ≥ 2 after update, got ${manifest.steps['01-normalize'].currentVersion}`);

  // Latest history entry must reflect the new moldName
  const history = manifest.steps['01-normalize'].history;
  const last = history[history.length - 1];
  assert.strictEqual(last.questionnaire.moldName, 'Обновлённый молд',
    `latest history must store updated moldName`);
});

// ---------------------------------------------------------------------------
// CRUD-07: DELETE /lines/:id — линейка пропадает из списка и manifest → 404
// ---------------------------------------------------------------------------

test('CRUD-07: DELETE /lines/:id removes the line', async () => {
  await createLine('CRUD07');

  const del = await invoke('DELETE', '/lines/CRUD07');
  assert.strictEqual(del.statusCode, 200, `delete failed: ${JSON.stringify(del.body)}`);
  assert.strictEqual(del.body.ok, true);
  assert.strictEqual(del.body.article, 'CRUD07');

  // Must be gone from GET /lines
  const list = (await invoke('GET', '/lines')).body;
  const found = (list.lines || []).find(l => l.article === 'CRUD07');
  assert.ok(!found, 'deleted article must not appear in /lines');

  // Manifest must now return 404
  const mf = await invoke('GET', '/lines/CRUD07/manifest');
  assert.strictEqual(mf.statusCode, 404, `manifest must be 404 after delete, got ${mf.statusCode}`);
});

// ---------------------------------------------------------------------------
// CRUD-08: DELETE несуществующей линейки → 404
// ---------------------------------------------------------------------------

test('CRUD-08: DELETE /lines/:id for non-existent article → 404', async () => {
  const r = await invoke('DELETE', '/lines/DOESNOTEXIST99');
  assert.strictEqual(r.statusCode, 404, `expected 404, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
});

// ---------------------------------------------------------------------------
// CRUD-09: POST /lines/:id/steps/05-excel/regenerate — синхронно, без AI
// ---------------------------------------------------------------------------

test('CRUD-09: POST /lines/:id/steps/05-excel/regenerate → ozon.xlsx + wb.xlsx', async () => {
  await createLine('CRUD09');

  const r = await invoke('POST', '/lines/CRUD09/steps/05-excel/regenerate', { body: { force: true } });
  assert.strictEqual(r.statusCode, 200, `excel regen failed: ${JSON.stringify(r.body)}`);
  assert.strictEqual(r.body.stepId, '05-excel');
  assert.ok(Array.isArray(r.body.artifacts) && r.body.artifacts.length >= 2,
    `must produce at least 2 artifacts, got: ${JSON.stringify(r.body.artifacts)}`);
  assert.ok(r.body.artifacts.some(a => a.includes('ozon')), 'must include ozon xlsx');
  assert.ok(r.body.artifacts.some(a => a.includes('wb')),   'must include wb xlsx');
});

// ---------------------------------------------------------------------------
// CRUD-10: GET /lines/:id/steps/01-normalize — возвращает master-data.json inline
// ---------------------------------------------------------------------------

test('CRUD-10: GET /lines/:id/steps/01-normalize returns inlined master-data.json', async () => {
  await createLine('CRUD10');

  const r = await invoke('GET', '/lines/CRUD10/steps/01-normalize');
  assert.strictEqual(r.statusCode, 200, `expected 200, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.version >= 1);
  assert.ok(Array.isArray(r.body.artifacts) && r.body.artifacts.includes('master-data.json'),
    `artifacts must include master-data.json, got: ${JSON.stringify(r.body.artifacts)}`);
  const md = r.body.data?.['master-data.json'];
  assert.ok(Array.isArray(md) && md.length === 5,
    'inlined master-data.json must be a 5-element array');
  // No unresolved template tokens
  for (const row of md) {
    assert.ok(!String(row.titleShort || '').includes('{{'),
      `titleShort must not contain unresolved tokens: ${row.titleShort}`);
  }
});

// ---------------------------------------------------------------------------
// CRUD-11: GET /lines/:id/download — возвращает zip с manifest.json внутри
// ---------------------------------------------------------------------------

test('CRUD-11: GET /lines/:id/download returns a zip (base64 body, application/zip)', async () => {
  await createLine('CRUD11');

  const r = await invoke('GET', '/lines/CRUD11/download');
  assert.strictEqual(r.statusCode, 200, `expected 200, got ${r.statusCode}`);
  assert.strictEqual(r.headers['Content-Type'], 'application/zip',
    `Content-Type must be application/zip, got: ${r.headers['Content-Type']}`);
  // body is returned as the raw base64 string (we skipped parsing for binary)
  const raw = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  const buf = Buffer.from(raw, 'base64');
  // ZIP magic: PK\x03\x04
  assert.ok(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04,
    'response body must be a valid ZIP (PK magic bytes)');
  assert.ok(buf.length > 200, `zip must be >200 bytes, got ${buf.length}`);
});

// ---------------------------------------------------------------------------
// CRUD-12: PUT /lines/:id/questionnaire для несуществующей линейки → 404
// ---------------------------------------------------------------------------

test('CRUD-12: PUT /lines/:id/questionnaire for non-existent article → 404', async () => {
  const q = buildQuestionnaire('DOESNOTEXIST88');
  const r = await invoke('PUT', '/lines/DOESNOTEXIST88/questionnaire', { body: q });
  assert.strictEqual(r.statusCode, 404, `expected 404, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
});

// ---------------------------------------------------------------------------
// CRUD-13: force=true пересоздаёт существующую линейку (новая версия)
// ---------------------------------------------------------------------------

test('CRUD-13: POST /lines with force:true on existing article bumps version', async () => {
  const q = buildQuestionnaire('CRUD13');
  await invoke('POST', '/lines', { body: q }); // v1

  const r = await invoke('POST', '/lines', { body: { ...q, force: true, moldName: 'Форсированный' } });
  assert.strictEqual(r.statusCode, 200, `force re-create failed: ${JSON.stringify(r.body)}`);

  const manifest = (await invoke('GET', '/lines/CRUD13/manifest')).body;
  assert.ok(manifest.steps['01-normalize'].currentVersion >= 2,
    `version must be ≥ 2 after force re-create, got ${manifest.steps['01-normalize'].currentVersion}`);
});

// ---------------------------------------------------------------------------
// CRUD-14: POST /lines без article → 400, без фото при multipart → 400 не выбрасывает
// ---------------------------------------------------------------------------

test('CRUD-14: POST /lines non-image MIME type → 400', async () => {
  const q = buildQuestionnaire('CRUD14');
  const r = await invoke('POST', '/lines', {
    files:      [{ filename: 'evil.txt', mimeType: 'text/plain', buffer: Buffer.from('hack') }],
    formFields: { questionnaire: JSON.stringify(q) },
  });
  assert.strictEqual(r.statusCode, 400, `non-image upload must be 400, got ${r.statusCode}`);
  assert.ok(r.body.error?.toLowerCase().includes('image'),
    `error must mention "image", got: ${r.body.error}`);
});
