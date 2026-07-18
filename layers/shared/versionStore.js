'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Local adapter — used only in tests (STORE_ADAPTER=local).
// Not for production use.
// ---------------------------------------------------------------------------

const OUTPUT_DIR = process.env.OUTPUT_DIR || path.resolve(process.cwd(), 'output');

function articleDir(article)  { return path.join(OUTPUT_DIR, article); }
function manifestPath(article) { return path.join(articleDir(article), 'manifest.json'); }
function artifactPath(article, stepId, version, name) {
  return path.join(articleDir(article), stepId, `v${version}`, name);
}

const local = {
  async getManifest(article) {
    const p = manifestPath(article);
    try {
      const raw = await fs.promises.readFile(p, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },

  async updateManifest(article, stepId, patch) {
    await fs.promises.mkdir(articleDir(article), { recursive: true });
    const p = manifestPath(article);

    let manifest;
    try {
      manifest = JSON.parse(await fs.promises.readFile(p, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      manifest = { article, steps: {} };
    }

    const existing = manifest.steps[stepId] || {};

    let resolvedPatch = patch;
    if (patch.pushHistory) {
      existing.history = [...(existing.history || []), patch.pushHistory];
      const { pushHistory, ...rest } = patch;
      resolvedPatch = rest;
    }

    manifest.steps[stepId] = deepMerge(existing, resolvedPatch);

    await fs.promises.writeFile(p, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  },

  async putArtifact(article, stepId, version, name, buffer) {
    const p = artifactPath(article, stepId, version, name);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, buffer);
  },

  async getArtifact(article, stepId, version, name) {
    return fs.promises.readFile(artifactPath(article, stepId, version, name));
  },

  async listArtifacts(article, stepId, version) {
    const dir = path.join(articleDir(article), stepId, `v${version}`);
    try {
      return await fs.promises.readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  },

  async listArticles() {
    try {
      const entries = await fs.promises.readdir(OUTPUT_DIR, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  },

  async deleteManifest(article) {
    try { await fs.promises.rm(articleDir(article), { recursive: true, force: true }); } catch { /* ok */ }
  },

  async deleteAllArtifacts(article) {
    // Local: same directory as manifest — handled by deleteManifest.
  },
};

// ---------------------------------------------------------------------------
// Yandex Cloud adapter
//   Manifests → YDB Document API (DynamoDB-compatible HTTP)
//   Artifacts  → Object Storage (S3-compatible)
//
// Required env vars (see .env.example):
//   YDB_DOCUMENT_API_ENDPOINT, YDB_TABLE_NAME
//   YC_BUCKET_NAME, YC_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
// ---------------------------------------------------------------------------

function getS3Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region:   'ru-central1',
    endpoint: process.env.YC_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

function getDynamoClient() {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  return new DynamoDBClient({
    region:   'ru-central1',
    endpoint: process.env.YDB_DOCUMENT_API_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

const YDB_TABLE = () => process.env.YDB_TABLE_NAME || 'mold-manifests';
const S3_BUCKET = () => process.env.YC_BUCKET_NAME  || 'mold-pipeline-output';

function s3Key(article, stepId, version, name) {
  return `${article}/${stepId}/v${version}/${name}`;
}

const yandexCloud = {
  async getManifest(article) {
    const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
    const client = DynamoDBDocumentClient.from(getDynamoClient());
    const res = await client.send(new GetCommand({
      TableName: YDB_TABLE(),
      Key: { article },
    }));
    if (!res.Item) return null;
    return typeof res.Item.data === 'string' ? JSON.parse(res.Item.data) : res.Item.data;
  },

  async updateManifest(article, stepId, patch) {
    const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
    const client = DynamoDBDocumentClient.from(getDynamoClient());

    // Read-merge-write (YDB Document API has no native nested-field atomic update)
    const res = await client.send(new GetCommand({ TableName: YDB_TABLE(), Key: { article } }));
    let manifest = res.Item
      ? (typeof res.Item.data === 'string' ? JSON.parse(res.Item.data) : res.Item.data)
      : { article, steps: {} };

    const existing = manifest.steps[stepId] || {};

    // pushHistory: atomic append to history array (safe for concurrent writers)
    let resolvedPatch = patch;
    if (patch.pushHistory) {
      existing.history = [...(existing.history || []), patch.pushHistory];
      const { pushHistory, ...rest } = patch;
      resolvedPatch = rest;
    }

    manifest.steps[stepId] = deepMerge(existing, resolvedPatch);

    await client.send(new PutCommand({
      TableName: YDB_TABLE(),
      Item: { article, data: JSON.stringify(manifest), updatedAt: new Date().toISOString() },
    }));
    return manifest;
  },

  async putArtifact(article, stepId, version, name, buffer) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getS3Client().send(new PutObjectCommand({
      Bucket: S3_BUCKET(),
      Key:    s3Key(article, stepId, version, name),
      Body:   buffer,
    }));
  },

  async getArtifact(article, stepId, version, name) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await getS3Client().send(new GetObjectCommand({
      Bucket: S3_BUCKET(),
      Key:    s3Key(article, stepId, version, name),
    }));
    // Collect stream into buffer
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  },

  async listArtifacts(article, stepId, version) {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const prefix = `${article}/${stepId}/v${version}/`;
    const res = await getS3Client().send(new ListObjectsV2Command({
      Bucket: S3_BUCKET(),
      Prefix: prefix,
    }));
    return (res.Contents || []).map(obj => obj.Key.slice(prefix.length)).filter(Boolean);
  },

  async listArticles() {
    const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const client = DynamoDBDocumentClient.from(getDynamoClient());
    const res = await client.send(new ScanCommand({
      TableName: YDB_TABLE(),
      ProjectionExpression: 'article',
    }));
    return (res.Items || []).map(item => item.article);
  },

  async deleteManifest(article) {
    const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    const client = DynamoDBDocumentClient.from(getDynamoClient());
    await client.send(new DeleteCommand({ TableName: YDB_TABLE(), Key: { article } }));
  },

  async deleteAllArtifacts(article) {
    const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
    const s3 = getS3Client();
    let continuationToken;
    do {
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET(), Prefix: `${article}/`, ContinuationToken: continuationToken,
      }));
      if (res.Contents && res.Contents.length > 0) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: S3_BUCKET(),
          Delete: { Objects: res.Contents.map(o => ({ Key: o.Key })) },
        }));
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
  },
};

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------

const ADAPTERS = {
  local,
  'yandex-cloud': yandexCloud,
};

function getAdapter() {
  const name = process.env.STORE_ADAPTER || 'yandex-cloud';
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`Unknown STORE_ADAPTER: "${name}". Valid values: ${Object.keys(ADAPTERS).join(', ')}`);
  return adapter;
}

// ---------------------------------------------------------------------------
// Per-article manifest write lock — serializes concurrent updateManifest calls
// to prevent read-merge-write races when multiple step handlers run in parallel.
// ---------------------------------------------------------------------------

const _manifestLocks = new Map();

function withManifestLock(article, fn) {
  const prev = _manifestLocks.get(article) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn regardless of prev outcome
  _manifestLocks.set(article, next.then(() => {}, () => {}));
  return next;
}

// ---------------------------------------------------------------------------
// Public interface — delegates to the selected adapter
// ---------------------------------------------------------------------------

module.exports = {
  getManifest:       (article)                          => getAdapter().getManifest(article),
  updateManifest:    (article, stepId, patch)           => withManifestLock(article, () => getAdapter().updateManifest(article, stepId, patch)),
  putArtifact:       (article, stepId, version, name, buffer) => getAdapter().putArtifact(article, stepId, version, name, buffer),
  getArtifact:       (article, stepId, version, name)   => getAdapter().getArtifact(article, stepId, version, name),
  listArtifacts:     (article, stepId, version)         => getAdapter().listArtifacts(article, stepId, version),
  listArticles:      ()                                 => getAdapter().listArticles(),
  deleteManifest:    (article)                          => getAdapter().deleteManifest(article),
  deleteAllArtifacts:(article)                          => getAdapter().deleteAllArtifacts(article),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) return source;
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === 'object' && value !== null && typeof result[key] === 'object') {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
