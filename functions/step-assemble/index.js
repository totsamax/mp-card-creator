'use strict';

const path = require('path');
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store = require(path.join(SHARED, 'versionStore'));

const STEP_ID = '06-assemble';

/**
 * Assembles a summary of the current output package for an article.
 * Does NOT copy files — just collects the manifest and artifact list into
 * a structured assembly report (assemble-report.json) so the frontend
 * can render the "folder tree" and offer downloads.
 *
 * Message: { article, force? }
 */
exports.handler = async (event) => {
  const msg = parseMessage(event);
  if (!msg) return respond(400, { error: 'Invalid message' });

  const { article, force = false } = msg;
  if (!article) return respond(400, { error: 'article is required' });

  const manifest = await store.getManifest(article);
  if (!manifest) return respond(404, { error: `Article "${article}" not found` });

  const stepMeta = manifest?.steps?.[STEP_ID];

  // Build assembly tree from all completed steps
  const tree = {};
  const completedSteps = [];

  for (const [stepId, meta] of Object.entries(manifest.steps || {})) {
    if (stepId === STEP_ID) continue;
    const currentVersion = meta.currentVersion;
    if (!currentVersion) continue;

    // Collect all unique versions from history to cover marketplace-split artifacts
    const allVersions = new Set([currentVersion]);
    for (const h of (meta.history || [])) {
      if (h.version) allVersions.add(h.version);
    }

    const artifactVersionMap = new Map();
    for (const v of [...allVersions].sort((a, b) => a - b)) {
      try {
        const names = await store.listArtifacts(article, stepId, v);
        for (const name of names) artifactVersionMap.set(name, v);
      } catch { /* skip */ }
    }

    const artifacts = [...artifactVersionMap.keys()];
    const stepNeedReview = meta.history?.slice(-1)[0]?.needsReview ?? false;

    tree[stepId] = {
      version: currentVersion,
      artifacts,
      needsReview: stepNeedReview,
    };
    completedSteps.push(stepId);
  }

  const report = {
    article,
    assembledAt: new Date().toISOString(),
    steps: tree,
    completedSteps,
    pendingSteps: ['01-normalize','02-texts','03-images','04-video','05-excel']
      .filter(s => !completedSteps.includes(s)),
  };

  const nextVersion = (stepMeta?.currentVersion ?? 0) + 1;

  await store.putArtifact(
    article, STEP_ID, nextVersion,
    'assemble-report.json',
    Buffer.from(JSON.stringify(report, null, 2))
  );

  await store.updateManifest(article, STEP_ID, {
    currentVersion: nextVersion,
    history: [...(stepMeta?.history ?? []), {
      version: nextVersion,
      createdAt: report.assembledAt,
      completedSteps,
    }],
  });

  return respond(200, { article, stepId: STEP_ID, version: nextVersion, report });
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
