# Coding Conventions

**Analysis Date:** 2026-06-15

## Module System

All backend code uses CommonJS (`'use strict'` at top, `require()`, `module.exports` / `exports.handler`). No ESM (`import`/`export`) anywhere in backend. Frontend (`frontend/PipelineApp.jsx`) uses ESM via Vite.

## Function/Handler Pattern

Every step function is a CommonJS module with a single named export:

```js
'use strict';
exports.handler = async (event) => { ... };
```

The `event` object mirrors Yandex Cloud Function / API Gateway shape: `event.httpMethod`, `event.path`, `event.body`, `event.isBase64Encoded`, `event.queryStringParameters`.

Each handler file also defines a local `respond(statusCode, body)` helper that returns the canonical response shape:

```js
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
```

This helper is duplicated across every step file (`functions/step-normalize/index.js`, `functions/step-texts/index.js`, etc.) rather than shared.

Helper functions are defined after the handler using function declarations (hoisted). Private helpers (`sha256`, `parseMessage`, `buildAttemptsLog`, `respond`) stay file-local; nothing beyond `exports.handler` is exported from step files.

`layers/shared/templateEngine.js` exports named functions: `module.exports = { computeMasterData, round, evalExpr, renderText }`.

## Error Handling

**Inbound parsing:** every handler wraps `JSON.parse(event.body)` in try/catch and returns `respond(400, { error: '...' })` on failure. Empty catch blocks (`catch { }` with no binding) are used when the error is intentionally discarded.

**Computation errors:** wrapped in try/catch, return `respond(400, { error: \`...: ${err.message}\` })`.

**LLM/API call errors:** wrapped in try/catch with fallback logic. Pattern used in `functions/step-texts/index.js`:
1. Try Anthropic → on failure, warn and fall through to OpenAI
2. Try OpenAI → on failure, warn and fall through to stub
3. Stub always succeeds

**Storage errors:** `versionStore` local adapter catches `ENOENT` and returns `null`/`[]` rather than throwing. Other errors propagate up. `cloud-with-fallback` adapter wraps every cloud call in try/catch and falls back to local on any error.

**Unhandled errors at API level:** `functions/api/index.js` has a top-level try/catch around the entire route dispatch that returns `respond(500, { error: err.message })` and logs via `console.error('[api] unhandled error:', err)`.

**Do not swallow errors silently.** The CLAUDE.md convention: "Ошибки бросаем, не глотаем молча."

## Logging

`console.log`, `console.warn`, `console.error` only. No logging framework.

Prefix pattern: `[module-name]` in brackets identifies the source:
- `[api]` — `functions/api/index.js`
- `[local]` — local fire-and-forget runner inside `functions/api/index.js`
- `[versionStore]` — `layers/shared/versionStore.js`
- `[step-texts]` — `functions/step-texts/index.js`

Log levels used:
- `console.error` — unhandled exceptions and fatal errors
- `console.warn` — degraded mode (cloud unavailable, LLM unavailable, fallback engaged)
- `console.log` — successful local step execution progress

## Async Patterns

All async functions use `async/await`. No `.then()/.catch()` chains.

**Fire-and-forget pattern** (used for async steps 02-texts, 03-images, 04-video):

```js
(async () => {
  for (const msg of messages) {
    try {
      const r = await handler({ body: JSON.stringify(msg) });
      console.log(`[local] ${stepId} ok:`, ...);
    } catch (err) {
      console.error(`[local] ${stepId} error:`, err.message);
    }
  }
})().catch(console.error);
```

The outer IIFE is intentionally not awaited. The API handler returns `respond(202, ...)` immediately. Progress is tracked via manifest polling.

**Parallel loading:** `handleListLines()` in `functions/api/index.js` uses `Promise.all` to fetch all manifests concurrently.

**Sequential S3 stream consumption:** `for await (const chunk of res.Body)` pattern in `layers/shared/versionStore.js`.

## Naming Conventions

**Files:**
- Config/data files: `kebab-case.json` — e.g., `ozon.column-map.json`, `prompts.critic-texts.json`
- JS modules: `camelCase.js` — e.g., `templateEngine.js`, `versionStore.js`, `excelWriter.js`
- Step directories: `step-{name}/` with `index.js` entry point

**Variables and functions:**
- `camelCase` for all local variables, function names, object keys
- `UPPER_SNAKE_CASE` for module-level constants: `STEP_ID`, `MAX_ATTEMPTS`, `SIZES`, `IMAGE_TYPES`, `OUTPUT_DIR`, `YDB_TABLE`, `S3_BUCKET`
- Environment variable references always via `process.env.VAR_NAME`

**Artifacts:**
- Path pattern: `output/{article}/{step}/v{N}/{artifact}` — e.g., `output/0553/03-images/v2/M_infographic.png`
- Artifact names: `{size}_{type}.{ext}` — e.g., `M_texts.json`, `XL_infographic.png`

**Step IDs:**
- Numeric prefix + kebab name: `01-normalize`, `02-texts`, `03-images`, `04-video`, `05-excel`, `06-assemble`

## Comments and Documentation

JSDoc used sparingly but present on public/complex functions in shared modules:

```js
/**
 * computeMasterData(questionnaire, template) → SizeRecord[]
 *
 * @param {object} questionnaire  - validated questionnaire
 * @param {object} template       - contents of template.master.json
 * @returns {object[]}            - one record per size (XS–XL)
 */
```

Inline comments explain non-obvious decisions:
- `// eslint-disable-next-line no-new-func` before dynamic `new Function()` usage
- `// Read-merge-write (YDB Document API has no native nested-field atomic update)`
- `// Local mode fallback: run step handlers directly (fire-and-forget)`

Route tables documented via block comments in `functions/api/index.js` (lines 76–84).

## Code Organization

**File length:** step files are 80–280 lines. `versionStore.js` is 264 lines covering all three adapters. `functions/api/index.js` is 377 lines.

**Section separators:** `// ---------------------------------------------------------------------------` lines divide major sections within a file (adapters, helpers, sub-handlers).

**Dependency loading pattern in step files:**
1. `'use strict'`
2. Built-in requires (`crypto`, `path`)
3. `SHARED` path resolution
4. Shared layer requires
5. Constants
6. `exports.handler`
7. Private async helpers
8. Sync helpers (`respond`, `sha256`, `parseMessage`)

**Lazy requires:** AWS SDK clients are instantiated inside functions (`getSQS()`, `getS3Client()`, `getDynamoClient()`) rather than at module load time, to avoid cold-start overhead and allow env vars to be set before instantiation.

**Input caching:** every step computes `sha256(JSON.stringify({ inputs }))` and compares against the last manifest history entry to skip redundant recomputation. `force: true` in request body bypasses the cache.
