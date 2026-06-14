'use strict';

const crypto = require('crypto');
const path   = require('path');

const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store      = require(path.join(SHARED, 'versionStore'));
const { buildXlsx } = require(path.join(SHARED, 'excelWriter'));
const ozonMap    = require(path.join(SHARED, 'config/ozon.column-map.json'));
const wbMap      = require(path.join(SHARED, 'config/wb.column-map.json'));

const STEP_ID = '05-excel';

const COLUMN_MAPS = { 'excel-ozon': ozonMap, 'excel-wb': wbMap };
const FILE_NAMES  = { 'excel-ozon': (article) => `${article}_ozon.xlsx`, 'excel-wb': (article) => `${article}_wb.xlsx` };

/**
 * YMQ / HTTP message:
 *   { article, artifacts?: ['excel-ozon', 'excel-wb'], force? }
 *
 * Generates one xlsx per requested artifact type.
 */
exports.handler = async (event) => {
  const msg = parseMessage(event);
  if (!msg) return respond(400, { error: 'Invalid message' });

  const { article, artifacts = ['excel-ozon', 'excel-wb'], force = false } = msg;
  if (!article) return respond(400, { error: 'article is required' });

  // Load master data
  const manifest  = await store.getManifest(article);
  const normMeta  = manifest?.steps?.['01-normalize'];
  if (!normMeta) return respond(400, { error: `step 01-normalize has no data for article "${article}"` });

  const masterDataBuf = await store.getArtifact(article, '01-normalize', normMeta.currentVersion, 'master-data.json');
  const masterData    = JSON.parse(masterDataBuf.toString());

  const stepMeta   = manifest?.steps?.[STEP_ID];
  const inputHash  = sha256(JSON.stringify({ masterData, artifacts }));

  // Cache check
  if (!force && stepMeta) {
    const last = stepMeta.history?.slice(-1)[0];
    if (last?.inputHash === inputHash) {
      return respond(200, { skipped: true, article, stepId: STEP_ID, version: stepMeta.currentVersion });
    }
  }

  const nextVersion = (stepMeta?.currentVersion ?? 0) + 1;
  const produced    = [];

  for (const artifactType of artifacts) {
    const columnMap = COLUMN_MAPS[artifactType];
    if (!columnMap) { console.warn(`Unknown artifact type: ${artifactType}`); continue; }

    const buffer   = await buildXlsx(masterData, columnMap);
    const fileName = FILE_NAMES[artifactType](article);

    await store.putArtifact(article, STEP_ID, nextVersion, fileName, buffer);
    produced.push(fileName);
  }

  const historyEntry = {
    version: nextVersion,
    createdAt: new Date().toISOString(),
    inputHash,
    artifacts: produced,
  };

  await store.updateManifest(article, STEP_ID, {
    currentVersion: nextVersion,
    history: [...(stepMeta?.history ?? []), historyEntry],
  });

  return respond(200, { article, stepId: STEP_ID, version: nextVersion, artifacts: produced });
};

// ---------------------------------------------------------------------------

function parseMessage(event) {
  try {
    if (event.messages) return JSON.parse(event.messages[0].details.message.body);
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
