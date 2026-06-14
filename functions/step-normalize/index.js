'use strict';

const crypto = require('crypto');
const path   = require('path');

// On Yandex Cloud the shared layer mounts at /opt; locally use relative path.
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const { computeMasterData } = require(path.join(SHARED, 'templateEngine'));
const store                 = require(path.join(SHARED, 'versionStore'));
const template              = require(path.join(SHARED, 'config/template.master.json'));

const STEP_ID = '01-normalize';

exports.handler = async (event) => {
  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { force = false, ...questionnaire } = body;
  const { article } = questionnaire;
  if (!article) return respond(400, { error: 'questionnaire.article is required' });

  const inputHash = sha256(JSON.stringify({ questionnaire, templateVersion: template }));

  // Cache check: skip if inputs haven't changed (unless force=true)
  const manifest  = await store.getManifest(article);
  const stepMeta  = manifest?.steps?.[STEP_ID];
  if (!force && stepMeta) {
    const last = stepMeta.history?.[stepMeta.history.length - 1];
    if (last?.inputHash === inputHash) {
      return respond(200, {
        skipped: true,
        reason:  'same input hash',
        article,
        stepId:  STEP_ID,
        version: stepMeta.currentVersion,
      });
    }
  }

  let masterData;
  try {
    masterData = computeMasterData(questionnaire, template);
  } catch (err) {
    return respond(400, { error: `Computation failed: ${err.message}` });
  }

  const nextVersion   = (stepMeta?.currentVersion ?? 0) + 1;
  const historyEntry  = { version: nextVersion, createdAt: new Date().toISOString(), inputHash };

  await store.putArtifact(
    article, STEP_ID, nextVersion,
    'master-data.json',
    Buffer.from(JSON.stringify(masterData, null, 2))
  );

  await store.updateManifest(article, STEP_ID, {
    currentVersion: nextVersion,
    history: [...(stepMeta?.history ?? []), historyEntry],
  });

  return respond(200, { article, stepId: STEP_ID, version: nextVersion, masterData });
};

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
