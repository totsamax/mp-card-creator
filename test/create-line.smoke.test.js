'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');

const { handler } = require('../functions/api/index.js');

test('C: POST /lines with multipart event.files creates a product line', async () => {
  const photoBuffer = fs.readFileSync(path.join(__dirname, 'fixtures/test-mold.png'));
  const questionnaire = {
    article: 'SMOKE01',
    moldType: 'hands',
    moldName: 'ТестМолд',
    brand: 'ТопМолд',
    theme: 'Тест',
    color: 'Белый',
    priceBaseM: 1000,
    title: 'Тестовый молд',
    category: 'Молды',
    sizes: [
      { size: 'XS', moldSize: 50,  moldLength: 5.0, moldWidth: 4.0, moldHeight: 1.5, moldWeight: 80  },
      { size: 'S',  moldSize: 65,  moldLength: 6.5, moldWidth: 5.2, moldHeight: 1.8, moldWeight: 110 },
      { size: 'M',  moldSize: 80,  moldLength: 8.0, moldWidth: 6.3, moldHeight: 2.0, moldWeight: 145 },
      { size: 'L',  moldSize: 95,  moldLength: 9.5, moldWidth: 7.4, moldHeight: 2.2, moldWeight: 185 },
      { size: 'XL', moldSize: 110, moldLength: 11,  moldWidth: 8.5, moldHeight: 2.5, moldWeight: 230 },
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
      questionnaire: JSON.stringify(questionnaire)
    }
  };

  const result = await handler(event);
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;

  assert.strictEqual(result.statusCode, 200, `Expected 200, got ${result.statusCode}: ${JSON.stringify(body)}`);
  assert.strictEqual(body.stepId, '01-normalize', `Expected stepId=01-normalize, got: ${body.stepId}`);

  // Check that photos were saved
  assert.ok(body.questionnaire && Array.isArray(body.questionnaire.photos) && body.questionnaire.photos.length > 0,
    'questionnaire.photos should be non-empty array after multipart upload');

  // Verify master-data is well-formed (no undefined tokens)
  if (body.masterData && body.masterData[2]) {
    assert.ok(!String(body.masterData[2].titleFull || '').includes('undefined'),
      'titleFull should not contain "undefined"');
  }
});
