'use strict';

// ---------------------------------------------------------------------------
// E2E pipeline orchestrator (Phase 5 — e2e-validation, REL-02).
//
// Runs the full pipeline 01→02→03→05→06 through a LIVE HTTP server
// (infra/local-server.js) with REAL OpenAI calls (D-01) and validates that a
// complete artifact package landed in an isolated OUTPUT_DIR.
//
// PAID/SLOW — gated behind RUN_E2E so plain `npm test` never triggers real
// OpenAI calls. Run with:  RUN_E2E=1 npm run test:e2e
//
// Required before running (D-04 / D-01):
//   - test/fixtures/e2e-face-mold.png : real photo of a face mold (> 1000 bytes)
//   - OPENAI_API_KEY in environment / .env.local (NEVER hardcoded here)
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const ExcelJS = require('exceljs');

// Skip-guard (D-06 / RESEARCH A2): file is visible in `npm test` but the paid
// run only happens with RUN_E2E=1. When the flag is absent, register a single
// skipped placeholder and do NOT register the real (network-touching) test.
if (!process.env.RUN_E2E) {
  test('e2e (skipped — set RUN_E2E=1 to run)', { skip: true }, () => {});
} else {
  // Load .env.local from project root (same pattern as infra/local-server.js)
  // Does NOT override already-set env vars — safe to run with explicit exports.
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
      }
    });
  } catch { /* .env.local not present — ok */ }

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------
  const PORT = Number(process.env.E2E_PORT) || 3101; // separate port — NOT 3001 (dev clash)
  const OUTPUT_DIR = path.join(__dirname, 'e2e-output');
  const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
  const SHARED = path.resolve(__dirname, '../layers/shared');
  const PHOTO_PATH = path.join(__dirname, 'fixtures', 'e2e-face-mold.png');
  const QUESTIONNAIRE_PATH = path.join(__dirname, 'fixtures', 'e2e-face-questionnaire.json');

  // Unique article per run (Pitfall 5 / D-05) — defeats input-hash cache hits.
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  const ARTICLE = `e2e-test-${stamp}`;

  let server = null;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function preflight() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('E2E требует реальный OPENAI_API_KEY (D-01); задай в .env.local или окружении');
    }
    let st;
    try {
      st = fs.statSync(PHOTO_PATH);
    } catch {
      st = null;
    }
    if (!st || st.size < 1000) {
      throw new Error(
        'Положи реальное фото лицевого молда в test/fixtures/e2e-face-mold.png (D-04), ' +
        `текущая фикстура отсутствует/слишком мала (${st ? st.size + 'b' : 'нет файла'})`
      );
    }
  }

  function startServer() {
    server = spawn('node', [path.resolve(__dirname, '../infra/local-server.js')], {
      env: {
        ...process.env,                 // inherits real OPENAI_API_KEY (D-01) — never hardcoded
        PORT: String(PORT),
        STORE_ADAPTER: 'local',
        OUTPUT_DIR,
        SHARED_LAYER_PATH: SHARED,
      },
      stdio: 'inherit',                 // step progress visible in test output
    });
  }

  function waitForPort(port, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      (function attempt() {
        const sock = net.createConnection(port, '127.0.0.1');
        sock.once('connect', () => { sock.destroy(); resolve(); });
        sock.once('error', () => {
          sock.destroy();
          if (Date.now() > deadline) return reject(new Error('server did not start'));
          setTimeout(attempt, 200);
        });
      })();
    });
  }

  async function pollStep(baseUrl, article, stepId, { expect, timeoutMs }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/lines/${article}/manifest`);
      const manifest = await res.json();
      const meta = manifest.steps && manifest.steps[stepId];

      // Pitfall 3: background step may have failed AFTER returning 202.
      // Check error BEFORE artifact-count and throw immediately.
      if (meta && meta.error) {
        throw new Error(`step ${stepId} failed: ${meta.error} @ ${meta.failedAt}`);
      }
      if (meta && meta.currentVersion) {
        const stepRes = await fetch(`${baseUrl}/lines/${article}/steps/${stepId}`);
        const step = await stepRes.json();
        const artifacts = step.artifacts || [];
        console.log(`[e2e] ${stepId}: ${artifacts.length}/${expect} артефактов...`);
        if (artifacts.length >= expect) return manifest;
      } else {
        console.log(`[e2e] ${stepId}: ожидание старта...`);
      }
      await new Promise(r => setTimeout(r, 5000)); // poll every 5s (like the UI)
    }
    throw new Error(`step ${stepId} timed out after ${timeoutMs}ms`);
  }

  function artifactPath(stepId, version, name) {
    return path.join(OUTPUT_DIR, ARTICLE, stepId, `v${version}`, name);
  }

  async function getManifest(baseUrl) {
    const res = await fetch(`${baseUrl}/lines/${ARTICLE}/manifest`);
    return res.json();
  }

  // -------------------------------------------------------------------------
  // The E2E test (timeout generous: 5min texts + 10min images + overhead)
  // -------------------------------------------------------------------------
  test('e2e: full pipeline 01→06 produces a complete artifact package', { timeout: 20 * 60 * 1000 }, async (t) => {
    preflight();

    const baseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;

    // D-07 fallback: if E2E_BASE_URL is set, use the already-running server.
    if (!process.env.E2E_BASE_URL) {
      startServer();
      await waitForPort(PORT, 10000);
    }

    // Guaranteed teardown — kill ONLY after all checks (Pitfall 4).
    t.after(() => {
      if (server) server.kill('SIGTERM');
    });

    // ---- (1) POST /lines (multipart: photo + questionnaire) ----
    const questionnaire = {
      ...JSON.parse(fs.readFileSync(QUESTIONNAIRE_PATH, 'utf8')),
      article: ARTICLE, // unique runtime article (D-05)
    };
    const photo = fs.readFileSync(PHOTO_PATH);
    const fd = new FormData();
    fd.append('questionnaire', JSON.stringify(questionnaire));
    fd.append('photo', new Blob([photo], { type: 'image/png' }), 'e2e-face-mold.png');
    // No manual Content-Type — fetch/undici sets the multipart boundary.

    const createRes = await fetch(`${baseUrl}/lines`, { method: 'POST', body: fd });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200,
      `POST /lines expected 200, got ${createRes.status}: ${JSON.stringify(createBody)}`);
    assert.strictEqual(createBody.stepId, '01-normalize',
      `expected stepId 01-normalize, got ${createBody.stepId}`);
    console.log(`[e2e] линия создана: ${ARTICLE} (01-normalize выполнен внутри POST /lines)`);

    // ---- (2) 02-texts (async, 202 → poll for 5 artifacts) ----
    const txtRes = await fetch(`${baseUrl}/lines/${ARTICLE}/steps/02-texts/regenerate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(txtRes.status, 202, `02-texts regenerate expected 202, got ${txtRes.status}`);
    await pollStep(baseUrl, ARTICLE, '02-texts', { expect: 5, timeoutMs: 5 * 60 * 1000 });

    // ---- (3) 03-images (async, 202 → poll for 5 artifacts) ----
    const imgRes = await fetch(`${baseUrl}/lines/${ARTICLE}/steps/03-images/regenerate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(imgRes.status, 202, `03-images regenerate expected 202, got ${imgRes.status}`);
    await pollStep(baseUrl, ARTICLE, '03-images', { expect: 5, timeoutMs: 10 * 60 * 1000 });

    // ---- (4) 05-excel (sync, 200) ----
    const xlsxRes = await fetch(`${baseUrl}/lines/${ARTICLE}/steps/05-excel/regenerate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(xlsxRes.status, 200, `05-excel regenerate expected 200, got ${xlsxRes.status}`);
    console.log('[e2e] 05-excel: готово');

    // ---- (5) 06-assemble (sync, 200) ----
    const asmRes = await fetch(`${baseUrl}/lines/${ARTICLE}/steps/06-assemble/regenerate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(asmRes.status, 200, `06-assemble regenerate expected 200, got ${asmRes.status}`);
    console.log('[e2e] 06-assemble: готово');

    // -----------------------------------------------------------------------
    // Validation (D-02) — versions taken from manifest, NOT hardcoded.
    // -----------------------------------------------------------------------
    const manifest = await getManifest(baseUrl);
    const ver = (stepId) => manifest.steps[stepId].currentVersion;

    // master-data.json — 5 records
    const masterRaw = fs.readFileSync(artifactPath('01-normalize', ver('01-normalize'), 'master-data.json'), 'utf8');
    const master = JSON.parse(masterRaw);
    assert.strictEqual(master.length, 5, `master-data.json expected 5 records, got ${master.length}`);
    console.log(`[e2e] master-data.json: ${master.length} записей`);

    // {size}_texts.json ×5 — no unresolved {{...}}
    const txtVer = ver('02-texts');
    for (const size of SIZES) {
      const p = artifactPath('02-texts', txtVer, `${size}_texts.json`);
      const txt = JSON.parse(fs.readFileSync(p, 'utf8'));
      const blob = JSON.stringify(txt);
      assert.ok(!/\{\{.*?\}\}/.test(blob), `${size}: нераскрытый плейсхолдер в текстах`);
    }
    console.log(`[e2e] тексты: 5/5 без нераскрытых {{}}`);

    // {size}_infographic.png ×5 — size > 1000 (reject 1×1 stub, Pitfall 2)
    const imgVer = ver('03-images');
    const imgHistory = manifest.steps['03-images'].history || [];
    for (const size of SIZES) {
      const p = artifactPath('03-images', imgVer, `${size}_infographic.png`);
      const st = fs.statSync(p);
      assert.ok(st.size > 1000, `${size}: PNG слишком мал (вероятно заглушка): ${st.size}b`);
      console.log(`[e2e] ${size}_infographic.png: ${st.size}b`);
    }
    // Warn (not fail) if any image came back needsReview (degraded generation).
    const flagged = imgHistory.filter(h => h.needsReview === true).map(h => h.size);
    if (flagged.length) {
      console.warn(`[e2e] ВНИМАНИЕ: needsReview=true для размеров: ${flagged.join(', ')}`);
    }

    // xlsx — opens without errors (D-02)
    const xlsxVer = ver('05-excel');
    for (const f of [`${ARTICLE}_ozon.xlsx`, `${ARTICLE}_wb.xlsx`]) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(artifactPath('05-excel', xlsxVer, f)); // throws if corrupt
      assert.ok(wb.worksheets.length > 0, `${f}: нет листов`);
      console.log(`[e2e] ${f}: ${wb.worksheets.length} лист(ов)`);
    }

    // assemble-report.json — exists, parses, lists completedSteps
    const asmVer = ver('06-assemble');
    const report = JSON.parse(fs.readFileSync(artifactPath('06-assemble', asmVer, 'assemble-report.json'), 'utf8'));
    assert.ok(Array.isArray(report.completedSteps), 'assemble-report.json: completedSteps must be an array');
    console.log(`[e2e] assemble-report.json: completedSteps=[${report.completedSteps.join(', ')}]`);

    console.log(`[e2e] ✓ полный пакет собран в ${path.join(OUTPUT_DIR, ARTICLE)}`);

    // Cleanup (RESEARCH Q3) — keep artifacts for human inspection by default;
    // remove only when explicitly requested.
    if (process.env.RUN_E2E_CLEAN) {
      fs.rmSync(path.join(OUTPUT_DIR, ARTICLE), { recursive: true, force: true });
      console.log('[e2e] RUN_E2E_CLEAN: артефакты удалены');
    }
  });
}
