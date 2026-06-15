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
    title: 'Тестовый молд',
    category: 'Молды',
    sizes: [
      { size: 'XS', moldSize: 50,  width: 40, height: 15, weight: 80,  priceBase: 490 },
      { size: 'S',  moldSize: 65,  width: 52, height: 18, weight: 110, priceBase: 590 },
      { size: 'M',  moldSize: 80,  width: 63, height: 20, weight: 145, priceBase: 690 },
      { size: 'L',  moldSize: 95,  width: 74, height: 22, weight: 185, priceBase: 790 },
      { size: 'XL', moldSize: 110, width: 85, height: 25, weight: 230, priceBase: 890 },
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
});
