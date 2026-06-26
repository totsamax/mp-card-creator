'use strict';

/**
 * mp-card-creator — деплой в Yandex Cloud
 *
 * Читает ключи из .env.local, пакует функции через archiver,
 * загружает в Object Storage и разворачивает через yc CLI.
 *
 * Запуск:   node infra/deploy.js [function-name|all] [--no-gateway] [--no-frontend]
 * Примеры:
 *   node infra/deploy.js                     # полный деплой
 *   node infra/deploy.js mp-step-images      # только одна функция
 *   node infra/deploy.js all --no-frontend   # все функции + gateway, без frontend
 */

const fs           = require('fs');
const path         = require('path');
const { spawnSync } = require('child_process');
const archiver     = require('archiver');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

// Read .env.local
const envVars = {};
try {
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) envVars[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  });
} catch { /* .env.local not present */ }

const REQUIRED_KEYS = ['OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
for (const k of REQUIRED_KEYS) {
  if (!envVars[k]) { console.error(`ERROR: ${k} not found in .env.local`); process.exit(1); }
}

// Cloud resource IDs (already provisioned)
const S3_BUCKET          = 'mold-pipeline-output';
const FRONTEND_BUCKET    = 'mp-card-frontend';
const S3_PREFIX          = 'functions-deploy';
const SERVICE_ACCOUNT_ID = 'aje3ktl9geek2hllo0sd';
const GW_NAME            = 'mp-gateway';
const GW_DOMAIN          = 'd5dmdfg21up7bavln5tv.avjje9e3.apigw.yandexcloud.net';

const YDB_ENDPOINT = 'https://docapi.serverless.yandexcloud.net/ru-central1/b1gvbk2acd72aee7o27k/etntrchfobpgpg0heh6t';
const YMQ = {
  TEXTS:  'https://message-queue.api.cloud.yandex.net/b1gvbk2acd72aee7o27k/dj60000000qb29du04uj/mold-texts',
  IMAGES: 'https://message-queue.api.cloud.yandex.net/b1gvbk2acd72aee7o27k/dj60000000qb29il04uj/mold-images',
  VIDEO:  'https://message-queue.api.cloud.yandex.net/b1gvbk2acd72aee7o27k/dj60000000qb29jv04uj/mold-video',
};

// Shared env (all functions)
const COMMON_ENV = {
  STORE_ADAPTER:             'yandex-cloud',
  SHARED_LAYER_PATH:         '/function/code/layers/shared',
  YDB_DOCUMENT_API_ENDPOINT: YDB_ENDPOINT,
  YDB_TABLE_NAME:            'mold-manifests',
  YC_BUCKET_NAME:            S3_BUCKET,
  YC_ENDPOINT:               'https://storage.yandexcloud.net',
  AWS_ACCESS_KEY_ID:         envVars.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY:     envVars.AWS_SECRET_ACCESS_KEY,
};

// AI env (text/image/video functions)
const AI_ENV = {
  OPENAI_API_KEY:     envVars.OPENAI_API_KEY,
  OPENAI_BASE_URL:    envVars.OPENAI_BASE_URL    || 'https://api.apiframe.ai/v1',
  OPENAI_MODEL:       envVars.OPENAI_MODEL       || 'gpt-4o-mini',
  OPENAI_IMAGE_MODEL: envVars.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  OPENAI_VISION_MODEL:envVars.OPENAI_VISION_MODEL|| 'gpt-4o',
  OPENROUTER_API_KEY: envVars.OPENROUTER_API_KEY || '',
  OPENROUTER_MODEL:   envVars.OPENROUTER_MODEL   || 'openai/gpt-4o-mini',
};

// ---------------------------------------------------------------------------
// S3 client
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region:      'ru-central1',
  endpoint:    'https://storage.yandexcloud.net',
  credentials: { accessKeyId: envVars.AWS_ACCESS_KEY_ID, secretAccessKey: envVars.AWS_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});

// ---------------------------------------------------------------------------
// Zip builder
// ---------------------------------------------------------------------------

async function buildZip(outputPath, setup) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    const arc = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    arc.on('error', reject);
    arc.pipe(out);
    setup(arc);
    arc.finalize();
  });
}

// ---------------------------------------------------------------------------
// S3 upload
// ---------------------------------------------------------------------------

async function upload(localPath, key, bucket = S3_BUCKET) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

async function uploadDir(localDir, bucket, prefix = '') {
  const MIME = { html:'text/html', css:'text/css', js:'application/javascript',
    json:'application/json', png:'image/png', ico:'image/x-icon',
    svg:'image/svg+xml', woff2:'font/woff2', woff:'font/woff', ttf:'font/ttf' };

  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const localPath = path.join(localDir, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await uploadDir(localPath, bucket, key);
    } else {
      const ext = entry.name.split('.').pop().toLowerCase();
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: fs.readFileSync(localPath),
        ContentType: MIME[ext] || 'application/octet-stream',
      }));
    }
  }
}

// ---------------------------------------------------------------------------
// yc CLI runner
// ---------------------------------------------------------------------------

function yc(args, opts = {}) {
  const result = spawnSync('yc', args, { stdio: opts.quiet ? 'pipe' : 'inherit', cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    const msg = result.stderr || result.stdout || '';
    throw new Error(`yc ${args[0]} failed (${result.status}): ${msg.slice(0, 300)}`);
  }
  return result.stdout || '';
}

// ---------------------------------------------------------------------------
// Function deploy
// ---------------------------------------------------------------------------

const DEPLOY_DIR = path.join(ROOT, 'deploy');

async function deployFunction(fn) {
  console.log(`\n[${fn.name}] building zip...`);
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });

  const zipPath = path.join(DEPLOY_DIR, `${fn.name}.zip`);
  await buildZip(zipPath, (arc) => {
    arc.directory(path.join(ROOT, 'layers/shared'), 'layers/shared');
    arc.directory(path.join(ROOT, 'node_modules'), 'node_modules');
    fn.setup(arc);
  });

  const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`[${fn.name}] zip ${sizeMB} MB — uploading to S3...`);

  const s3Key = `${S3_PREFIX}/${fn.name}.zip`;
  await upload(zipPath, s3Key);

  console.log(`[${fn.name}] deploying...`);
  const envPairs = Object.entries({ ...COMMON_ENV, ...fn.env })
    .filter(([, v]) => v !== undefined && v !== '');

  yc([
    'serverless', 'function', 'version', 'create',
    '--function-name', fn.name,
    '--runtime', 'nodejs18',
    '--entrypoint', 'index.handler',
    '--memory', fn.memory || '256m',
    '--execution-timeout', fn.timeout || '30s',
    '--package-bucket-name', S3_BUCKET,
    '--package-object-name', s3Key,
    '--service-account-id', SERVICE_ACCOUNT_ID,
    ...envPairs.flatMap(([k, v]) => ['--environment', `${k}=${v}`]),
  ]);

  console.log(`[${fn.name}] ✓`);
}

// ---------------------------------------------------------------------------
// Function catalog
// ---------------------------------------------------------------------------

const FUNCTIONS = [
  {
    name: 'mp-api',
    timeout: '30s', memory: '256m',
    env: { ...AI_ENV, YMQ_TEXTS_QUEUE_URL: YMQ.TEXTS, YMQ_IMAGES_QUEUE_URL: YMQ.IMAGES, YMQ_VIDEO_QUEUE_URL: YMQ.VIDEO },
    setup: (arc) => {
      arc.file(path.join(ROOT, 'functions/api/index.js'), { name: 'index.js' });
      arc.file(path.join(ROOT, 'functions/step-excel/index.js'),    { name: 'step-excel.js' });
      arc.file(path.join(ROOT, 'functions/step-assemble/index.js'), { name: 'step-assemble.js' });
    },
  },
  {
    name: 'mp-step-normalize',
    timeout: '30s', memory: '256m', env: {},
    setup: (arc) => arc.file(path.join(ROOT, 'functions/step-normalize/index.js'), { name: 'index.js' }),
  },
  {
    name: 'mp-step-texts',
    timeout: '120s', memory: '256m', env: { ...AI_ENV },
    setup: (arc) => arc.file(path.join(ROOT, 'functions/step-texts/index.js'), { name: 'index.js' }),
  },
  {
    name: 'mp-step-images',
    timeout: '300s', memory: '512m', env: { ...AI_ENV },
    setup: (arc) => arc.file(path.join(ROOT, 'functions/step-images/index.js'), { name: 'index.js' }),
  },
  {
    name: 'mp-step-video',
    timeout: '600s', memory: '512m', env: { ...AI_ENV },
    setup: (arc) => arc.file(path.join(ROOT, 'functions/step-video/index.js'), { name: 'index.js' }),
  },
  {
    name: 'mp-step-excel',
    timeout: '60s', memory: '512m', env: {},
    setup: (arc) => arc.file(path.join(ROOT, 'functions/step-excel/index.js'), { name: 'index.js' }),
  },
  {
    name: 'mp-step-assemble',
    timeout: '30s', memory: '256m', env: {},
    setup: (arc) => arc.file(path.join(ROOT, 'functions/step-assemble/index.js'), { name: 'index.js' }),
  },
];

// ---------------------------------------------------------------------------
// API Gateway update
// ---------------------------------------------------------------------------

async function updateGateway() {
  console.log('\n[api-gateway] reading function id...');
  const out = yc(['serverless', 'function', 'get', 'mp-api', '--format', 'json'], { quiet: true });
  const apiId = JSON.parse(out).id;

  let spec = fs.readFileSync(path.join(ROOT, 'infra/api-gateway.yaml'), 'utf8');
  spec = spec.replace(/\$\{API_FUNCTION_ID\}/g, apiId);

  const tmpSpec = path.join(DEPLOY_DIR, 'mp-gateway-spec.yaml');
  fs.writeFileSync(tmpSpec, spec);

  console.log(`[api-gateway] updating ${GW_NAME} (function ${apiId})...`);
  yc(['serverless', 'api-gateway', 'update', '--name', GW_NAME, '--spec', tmpSpec]);
  console.log('[api-gateway] ✓');
}

// ---------------------------------------------------------------------------
// Frontend build & deploy
// ---------------------------------------------------------------------------

async function deployFrontend() {
  const apiUrl = `https://${GW_DOMAIN}`;
  console.log(`\n[frontend] building with API_BASE=${apiUrl}...`);

  const isWin = process.platform === 'win32';
  const npmCmd = isWin ? 'npm.cmd' : 'npm';
  console.log(`[frontend] running: ${npmCmd} run build in ${path.join(ROOT, 'frontend')}`);
  const build = spawnSync(npmCmd, ['run', 'build'], {
    cwd: path.join(ROOT, 'frontend'),
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, VITE_API_BASE_URL: apiUrl },
  });
  console.log(`[frontend] build exit status=${build.status} signal=${build.signal} error=${build.error?.message}`);
  if (build.status !== 0) throw new Error('Frontend build failed');

  console.log('[frontend] uploading to S3...');
  await uploadDir(path.join(ROOT, 'frontend/dist'), FRONTEND_BUCKET);

  // Ensure public read (bucket-level ACL)
  yc(['storage', 'bucket', 'update', FRONTEND_BUCKET, '--public-read']);

  console.log(`[frontend] ✓  https://${FRONTEND_BUCKET}.website.yandexcloud.net`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const target    = args.find(a => !a.startsWith('--'));
  const noGateway = args.includes('--no-gateway');
  const noFrontend= args.includes('--no-frontend');

  console.log('=== mp-card-creator deploy ===');
  console.log(`Target: ${target || 'all'}  gateway:${!noGateway}  frontend:${!noFrontend}\n`);

  const onlyFrontend = args.includes('--only-frontend');

  let toDeploy = FUNCTIONS;
  if (onlyFrontend) {
    toDeploy = [];
  } else if (target && target !== 'all') {
    toDeploy = FUNCTIONS.filter(f => f.name === target || f.name === `mp-${target}` || f.name === `mp-step-${target}`);
    if (!toDeploy.length) {
      console.error(`Unknown function: ${target}`);
      console.error('Available:', FUNCTIONS.map(f => f.name).join(', '));
      process.exit(1);
    }
  }

  for (const fn of toDeploy) {
    await deployFunction(fn);
  }

  const doGateway  = !noGateway  && !onlyFrontend && (!target || target === 'all');
  const doFrontend = !noFrontend && (onlyFrontend || !target || target === 'all');

  if (doGateway)  await updateGateway();
  if (doFrontend) await deployFrontend();

  console.log('\n=== Деплой завершён ===');
  console.log(`API:      https://${GW_DOMAIN}`);
  if (doFrontend) console.log(`Frontend: https://${FRONTEND_BUCKET}.website.yandexcloud.net`);
}

main().catch(err => {
  console.error('\nDeploy failed:', err.message);
  process.exit(1);
});
