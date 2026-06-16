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
    moldName: 'TestMold',
    brand: 'ТопМолд',
    theme: 'Тест',
    color: 'Белый',
    priceBaseM: 1000,
    title: 'Молд для рук',
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
  const result = computeMasterData(questionnaire, template);
  assert.strictEqual(result.length, 5, 'should return 5 size records');
  assert.ok(result[2].priceBase > 0, 'priceBase for M should be > 0');
  // M size: round(priceBaseM * (moldSizeM / moldSizeM), 10) = round(1000 * 1, 10) = 1000; allow ±50 for rounding
  assert.ok(Math.abs(result[2].priceBase - 1000) <= 50,
    `priceBase for M should be ~1000 (formula result), got ${result[2].priceBase}`);
  assert.ok(!result[2].titleFull || !result[2].titleFull.includes('личико'),
    'titleFull should not contain "личико" for moldType=hands');
});

test('B: unknown moldType falls back to static values without throwing', () => {
  const questionnaire = {
    article: 'TEST02',
    moldType: 'unknown-type-xyz',
    moldName: 'TestMold',
    brand: 'ТопМолд',
    theme: 'Тест',
    color: 'Белый',
    priceBaseM: 1000,
    title: 'Молд',
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
  let result;
  assert.doesNotThrow(() => {
    result = computeMasterData(questionnaire, template);
  }, 'should not throw for unknown moldType');
  assert.strictEqual(result.length, 5, 'should still return 5 records');
});
