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
  // TODO(Task 2): full E2E scenario — spawn server, wait-for-port, POST /lines,
  // sequential step runs, pollStep, artifact validation.
}
