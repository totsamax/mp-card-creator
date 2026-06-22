---
phase: 4
plan: 01
subsystem: backend / pipeline error handling
tags: [REL-01, D-06, error-capture, manifest, tdd]
requires:
  - "store.updateManifest deep-merge contract (layers/shared/versionStore.js)"
provides:
  - "manifest.steps[stepId].error (string|null) + failedAt (ISO string|null) contract for frontend error state (Plan 03 UI-03)"
affects:
  - functions/step-texts/index.js
  - functions/step-images/index.js
  - functions/api/index.js
tech-stack:
  added: []
  patterns:
    - "Top-level handler try/catch → store.updateManifest({ error, failedAt }) on throw"
    - "Success-path patch clears { error: null, failedAt: null } so retry resolves a failed state"
key-files:
  created:
    - test/step-error-capture.test.js
  modified:
    - functions/step-texts/index.js
    - functions/step-images/index.js
    - functions/api/index.js
decisions:
  - "Forced deterministic throw in RED tests via monkeypatched store.putArtifact — no network / no AI-key dependency"
  - "Critic-failure swallow in step-images stays ok:true and does NOT write an error (needsReview is not a step error)"
metrics:
  duration: ~10m
  completed: 2026-06-22
  tasks: 2
  files: 4
---

# Phase 4 Plan 01: Step Error Capture Summary

Pipeline steps now persist `{ error, failedAt }` into `manifest.steps[stepId]` when they throw (step-texts, step-images, and the `runLocally` fire-and-forget runner), and clear them to `null` on a successful run — implementing REL-01 (D-06), the data contract Plan 03's UI error indicator reads.

## What Was Built

- **`test/step-error-capture.test.js`** — three `node:test` cases proving the contract: step-texts and step-images write a non-empty `error` string + ISO `failedAt` on failure, and a successful step clears a prior failure to `null`. Throws are injected deterministically by monkeypatching `store.putArtifact` (no network, no API keys).
- **`functions/step-texts/index.js`** — handler body wrapped in a top-level `try/catch`; the catch writes `{ error: err.message, failedAt: ISO }` then returns 500. The success-save patch now also sets `error: null, failedAt: null`. The previous inner LLM `try/catch` (which returned early) was folded into the outer catch so there is a single error-write site.
- **`functions/step-images/index.js`** — generation-failure catch (and a new top-level catch) write `{ error, failedAt }`; success patch clears to `null`. The critic-failure swallow still sets `criticVerdict = { ok: true }` and does NOT write an error.
- **`functions/api/index.js`** — `runLocally` per-message catch now records `{ error, failedAt }` via `store.updateManifest(msg.article, stepId, …)`, wrapped in its own try/catch so a manifest-write failure cannot crash the runner loop.

## Verification

- `node --test test/step-error-capture.test.js` → 3 pass (was 3 fail in RED)
- `node --test 'test/**/*.test.js'` → 20 pass / 0 fail (no regression in step-texts, step-images, templateEngine, create-line.smoke)
- `grep "failedAt"` matches in all three modified backend files
- `grep "error: null"` matches in both step handlers

## TDD Gate Compliance

- RED gate: `test(04-01): add failing RED contract for step error capture` (`3cdd56c`) — 3 tests failing before implementation.
- GREEN gate: `feat(04-01): capture step failures to manifest (REL-01)` (`2bbe79a`) — all 3 tests passing.
- REFACTOR: not needed.

## Deviations from Plan

None — plan executed exactly as written. Both handler bodies were wrapped in a top-level try/catch (the plan's recommended option), giving a single error-write site per handler that works on both the direct-invoke (cloud YMQ) and `runLocally` paths.

## Known Stubs

None. This plan is backend error-capture only; no UI or placeholder data introduced.

## Self-Check: PASSED

- Files: test/step-error-capture.test.js, functions/step-texts/index.js, functions/step-images/index.js, functions/api/index.js — all present.
- Commits: 3cdd56c (RED), 2bbe79a (GREEN) — both present in git log.
