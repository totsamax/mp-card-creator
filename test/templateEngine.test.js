'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');

const { computeMasterData } = require('../layers/shared/templateEngine');
const template = require('../layers/shared/config/template.master.json');

test('A: moldType=hands returns 5 records, priceBase>0, titleFull has no "личико"', () => {
  const questionnaire = {
    article: 'TEST01',
    moldType: 'hands',
    title: 'Молд для рук',
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
  const result = computeMasterData(questionnaire, template);
  assert.strictEqual(result.length, 5, 'should return 5 size records');
  assert.ok(result[2].priceBase > 0, 'priceBase for M should be > 0');
  assert.ok(!result[2].titleFull || !result[2].titleFull.includes('личико'),
    'titleFull should not contain "личико" for moldType=hands');
});

test('B: unknown moldType falls back to static values without throwing', () => {
  const questionnaire = {
    article: 'TEST02',
    moldType: 'unknown-type-xyz',
    title: 'Молд',
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
  let result;
  assert.doesNotThrow(() => {
    result = computeMasterData(questionnaire, template);
  }, 'should not throw for unknown moldType');
  assert.strictEqual(result.length, 5, 'should still return 5 records');
});
