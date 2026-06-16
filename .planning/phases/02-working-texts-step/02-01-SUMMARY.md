---
phase: 02-working-texts-step
plan: "01"
subsystem: test
tags: [tdd, red-contract, step-texts, node-test]
dependency_graph:
  requires: []
  provides: [test/step-texts.test.js]
  affects: [functions/step-texts/index.js, layers/shared/config/prompts.critic-texts.json]
tech_stack:
  added: []
  patterns: [node:test direct-handler-call, USE_STUB=true deterministic testing, readManifest-via-fs]
key_files:
  created:
    - test/step-texts.test.js
  modified: []
decisions:
  - "Tests call step-texts handler directly (never via runLocally) — runLocally is fire-and-forget and not awaitable in unit tests"
  - "Each test uses a unique article ID (TXT02A, TXT02B, TXT01A, TXT03A, TXT03B) to avoid cache-skip Pitfall 5"
  - "TXT-03 RED condition: no topicKeywordCheck in critic today so needsReview stays false; test asserts true — FAILS as designed"
  - "attempts.length===3 test FAILS today: buildAttemptsLog reads from history between recursive calls, but intermediate verdicts not persisted — Plans 02+03 fix this"
  - "runCritic not exported → two DEC-03 tests FAIL immediately — Plan 03 adds export"
metrics:
  duration_minutes: 4
  completed: "2026-06-16"
  tasks_completed: 2
  files_created: 1
---

# Phase 02 Plan 01: RED Test Contract for step-texts Summary

RED test contract for the Phase 02 working-texts-step — 7 tests covering TXT-01/02/03 + DEC-03 runCritic rules, with 4 intentionally failing against the current handler.

## What Was Built

Created `test/step-texts.test.js` as the executable specification for Phase 02. The file is a self-contained `node:test` unit test suite that:

- Sets `USE_STUB=true`, `STORE_ADAPTER=local`, `SHARED_LAYER_PATH` before any requires (deterministic, no network)
- Provides three shared helpers: `createLine(article, moldType)` for seeding `master-data.json` via the api handler, `runTexts(article, size, extra)` for calling the step-texts handler directly (always with `force: true`), and `readManifest(article)` for reading `manifest.json` from disk via fs
- Covers all requirements: TXT-01 (5-size generation), TXT-02 (no placeholders, no лицо/личик for hands), TXT-03 (recursion termination, attempts[] accumulation), DEC-03 (runCritic export + topicKeywordCheck + noUnresolvedPlaceholders)

## Test Results (RED State)

```
# tests 7
# pass 3
# fail 4
Exit code: 1 (RED-AS-EXPECTED)
```

**Passing tests (behavior that already works):**
- TXT-02: no unresolved {{...}} placeholders (stub returns clean templateEngine texts)
- TXT-02: moldType=hands no 'лицо'/'личик' (hands template doesn't use face words)
- TXT-01: all 5 sizes produce a texts artifact (handler works per-size today)

**Failing tests (RED contract — Plans 02+03 turn these GREEN):**
- TXT-03: `body.needsReview === true` after critic exhaustion — FAILS (critic passes stub texts; no topicKeywordCheck rule yet)
- TXT-03: `history.attempts.length === 3` — FAILS (only 1 attempt recorded; intermediate verdicts not persisted between recursive calls)
- DEC-03: `typeof stepTexts.runCritic === 'function'` — FAILS (runCritic not exported)
- DEC-03: topicKeywordCheck flags missing topic words — FAILS (same: not exported)

## Deviations from Plan

None — plan executed exactly as written.

The plan accurately predicted which tests would be RED vs GREEN, and the exact failure messages match the expected behaviors documented in RESEARCH.md Pitfalls 3 and 4.

## Stub Tracking

No stubs introduced. `USE_STUB=true` activates the existing `templateTexts(sizeRecord)` fallback in step-texts, which is the correct deterministic path for unit testing (not a new stub introduced by this plan).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. This plan creates a test file only.

The DoS-guard regression test (TXT-03 needsReview after MAX_ATTEMPTS) is now present as specified in the plan's threat model (T-02-01). It will turn GREEN when Plans 02+03 implement topicKeywordCheck and recursive retry.

## Self-Check: PASSED

- FOUND: `test/step-texts.test.js` (289 lines)
- FOUND: commit `2a207f4` — test(02-01): add RED test contract for step-texts handler
