# Testing

**Analysis Date:** 2026-06-15

## Test Framework

None. No testing framework is installed or configured.

`package.json` test script:
```json
"test": "echo \"Error: no test specified\" && exit 1"
```

No `jest.config.*`, `vitest.config.*`, `mocha.*`, or equivalent config files exist in the project root.

The only test file found in the entire repository is `frontend/node_modules/gensync/test/index.test.js` — a dependency's own test, not project code.

## Test Coverage

Zero. No test files exist for:
- `layers/shared/templateEngine.js`
- `layers/shared/versionStore.js`
- `layers/shared/excelWriter.js`
- Any function in `functions/`
- Frontend components in `frontend/PipelineApp.jsx`

## Test Patterns

None established.

CLAUDE.md documents `templateEngine.js` as "тестируется напрямую, без моков" (tested directly, without mocks), indicating the intent that it should be unit-tested, but no tests exist yet. Its pure functional design (no I/O, deterministic) makes it the most straightforward module to test.

## How to Run Tests

No test command available. Running `npm test` exits with code 1.

## Notable Gaps

**Critical — templateEngine.js (`layers/shared/templateEngine.js`):**
- `evalExpr` uses `new Function()` to evaluate formula strings from `template.master.json`. Incorrect formula expressions produce runtime errors that only surface during pipeline execution. No tests guard formula correctness.
- `computeMasterData` is the core business logic (price calculations, size derivations). Regressions here silently corrupt all downstream artifacts.

**Critical — versionStore.js (`layers/shared/versionStore.js`):**
- The `cloud-with-fallback` adapter's fallback logic is untested. It's possible for the fallback to engage silently while the cloud write fails, causing data loss that isn't surfaced to the caller.
- `deepMerge` (used for atomic manifest updates) has no edge-case coverage. Incorrect merges corrupt the manifest, breaking all subsequent step reads.

**High — step handlers:**
- `functions/step-texts/index.js` generator-critic loop logic (attempt tracking, `buildAttemptsLog`, `needsReview` flag) is entirely untested. Bugs in attempt counting could cause infinite-loop-like behavior or incorrect `needsReview` tagging.
- `functions/api/index.js` route dispatch regex matching is untested. New routes or URL edge cases have no regression coverage.

**High — excelWriter.js:**
- Excel column mapping logic applied to all 5 sizes × 2 marketplaces (Ozon + WB). Format errors only surface when the xlsx is opened.

**Medium — frontend:**
- `frontend/PipelineApp.jsx` has no component or integration tests. API error handling paths in the UI are untested.

## Recommended First Tests

Given the pure-function design of `templateEngine.js`, it is the highest-value target for initial test coverage. A minimal Jest or Node built-in `node:test` suite can run it without mocks:

```js
// Example (not yet written)
const { computeMasterData } = require('./layers/shared/templateEngine');
const template = require('./layers/shared/config/template.master.json');
// assert output shape and computed field values for a known questionnaire fixture
```
