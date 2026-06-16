---
plan: 02-02
phase: 02-working-texts-step
wave: 2
status: complete
commit: 0f65f2a
---

# Plan 02-02 Summary — Local Recursive Retry

## What was done

**Task 1 (complete):** Replaced `enqueueRetry` no-op with direct recursive `exports.handler` call in `functions/step-texts/index.js`.

### Changes

| Change | Detail |
|--------|--------|
| Destructure | Added `attemptsLog = []` to message destructure |
| Retry branch | `enqueueRetry(...)` → `return exports.handler({ body: JSON.stringify({...attemptsLog: [...attemptsLog, { attempt, criticVerdict }]}) })` |
| Save branch | `buildAttemptsLog(stepMeta, attempt, criticVerdict)` → `[...attemptsLog, { attempt, criticVerdict }]` |
| Removed | `enqueueRetry` function (lines 221-239) |
| Removed | `buildAttemptsLog` function (lines 260-263) |
| Removed | `@aws-sdk/client-sqs` require (was inside `enqueueRetry`) |

### Acceptance criteria — all met

- [x] `enqueueRetry` count in file: 0
- [x] `attemptsLog` present in file (3 occurrences)
- [x] Self-recursive `exports.handler({` call at line 90 with `body: JSON.stringify(`
- [x] Save branch builds attempts as `[...attemptsLog, { attempt, criticVerdict }]`
- [x] `store.updateManifest` still called with exactly 3 arguments
- [x] Regression tests A, B, C remain GREEN

## Test status after Wave 2

| Test | Status | Notes |
|------|--------|-------|
| TXT-02: no placeholders | GREEN | |
| TXT-02: hands no лицо/личик | GREEN | |
| TXT-01: all 5 sizes produce artifact | GREEN | |
| TXT-03: needsReview after exhaustion | RED | Needs Wave 3 `topicKeywordCheck` to force critic rejection |
| TXT-03: attempts[] length === 3 | RED | Same — needs Wave 3 critic rule |
| DEC-03: runCritic exported (noUnresolvedPlaceholders) | RED | Wave 3 exports runCritic |
| DEC-03: runCritic exported (topicKeywordCheck) | RED | Wave 3 exports runCritic |

Tests 4-7 remain RED because they depend on Wave 3's `topicKeywordCheck` critic rule (forces rejection) and `runCritic` export. The recursion mechanism is in place and will be exercised once Wave 3 adds the rule.

## Next

Wave 3 / Plan 02-03: substitution fix (faceSize→moldSize, add topic/purpose), update prompts.texts.json, extend runCritic with topicKeywordCheck + noUnresolvedPlaceholders, export runCritic. All 4 RED tests turn GREEN.
