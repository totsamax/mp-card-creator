<!-- refreshed: 2026-06-15 -->
# Project Structure

**Analysis Date:** 2026-06-15

## Directory Layout

```
mp-card-creator/
├── layers/
│   └── shared/                    # Shared library consumed by all step functions
│       ├── templateEngine.js      # Pure computation: questionnaire → SizeRecord[]
│       ├── versionStore.js        # Storage adapter (local / yandex-cloud / cloud-with-fallback)
│       ├── excelWriter.js         # xlsx generation via exceljs
│       └── config/
│           ├── template.master.json        # Formula definitions for 5-size product lines
│           ├── ozon.column-map.json        # Ozon xlsx column mapping
│           ├── wb.column-map.json          # WB xlsx column mapping
│           ├── prompts.texts.json          # LLM prompt templates for step-texts
│           ├── prompts.images.json         # Prompt templates for step-images (4 image types)
│           ├── prompts.video.json          # Prompt templates for step-video
│           ├── prompts.critic-texts.json   # Rule-based critic config (length limits, required/banned)
│           └── prompts.critic-images.json  # Claude Vision critic prompt template
├── functions/
│   ├── api/
│   │   └── index.js               # HTTP router + orchestrator (entry point for all requests)
│   ├── step-normalize/
│   │   └── index.js               # Step 01 module (currently unused — logic is in api/index.js)
│   ├── step-texts/
│   │   └── index.js               # Step 02: LLM text generation with generator-critic loop
│   ├── step-images/
│   │   └── index.js               # Step 03: OpenAI image generation with Claude Vision critic
│   ├── step-video/
│   │   └── index.js               # Step 04: kling.ai video generation
│   ├── step-excel/
│   │   └── index.js               # Step 05: xlsx output for Ozon and WB
│   └── step-assemble/
│       └── index.js               # Step 06: bundle all artifacts for an article
├── infra/
│   └── local-server.js            # Thin HTTP adapter (Node.js http → YC API Gateway event format)
├── frontend/
│   ├── PipelineApp.jsx            # Main React component (questionnaire + pipeline stepper)
│   ├── src/                       # Vite project source
│   └── dist/                      # Built frontend assets (generated, not committed)
├── input/
│   └── questionnaire.schema.json  # JSON Schema for questionnaire validation
├── deploy/                        # Deployment scripts / cloud config
├── proxy/                         # Cloudflare Worker proxy (wrangler project)
├── logs/
│   └── api.log                    # Rolling log from local-server (max 10 MB, rotates to api.log.old)
├── output/                        # Local artifact storage fallback (in .gitignore)
│   └── {article}/
│       ├── manifest.json
│       └── {step}/v{N}/{artifact}
├── package.json                   # Root scripts: dev, api, etc.
├── CLAUDE.md                      # Architecture and convention reference
└── PROJECT_BRIEF.md               # Product brief and pipeline spec
```

## Module Boundaries

### `layers/shared/`
**Owns:** Reusable business logic with no HTTP concerns: template computation, storage I/O, Excel generation, all config JSON.
**Does NOT own:** HTTP routing, AI API calls, step orchestration logic, UI.
**Consumed by:** All `functions/step-*` modules via `SHARED_LAYER_PATH` env var or relative path fallback.

### `functions/api/`
**Owns:** HTTP routing, request parsing, step dispatch (sync inline for 01/05/06, fire-and-forget or YMQ for 02/03/04), input hash cache check for step 01.
**Does NOT own:** Business logic, storage implementation, AI API calls.

### `functions/step-*/`
**Owns:** Single pipeline step — loads data from store, calls AI API, runs critic, writes artifacts, updates manifest.
**Does NOT own:** HTTP parsing (uses `parseMessage` helper only), storage implementation, routing.

### `infra/`
**Owns:** Local development server setup — HTTP → event adapter, `.env.local` loading, console logging to file.
**Does NOT own:** Business logic. It is a thin shim only.

### `frontend/`
**Owns:** React UI — questionnaire form, pipeline status display, artifact preview, version selection.
**Does NOT own:** Any backend logic. Communicates exclusively via HTTP to `:3001`.

### `layers/shared/config/`
**Owns:** All data-driven configuration: formula templates, column maps, prompt templates, critic rules.
**Does NOT own:** Logic. All files are pure JSON — no code.

## Naming Conventions

**Files:**
- Config JSON: `kebab-case.json` (e.g., `ozon.column-map.json`, `prompts.critic-texts.json`)
- JS modules: `camelCase.js` (e.g., `templateEngine.js`, `versionStore.js`, `excelWriter.js`)
- Step directories: `step-{name}/index.js` (e.g., `step-texts/index.js`)

**Exports:**
- Every step module exports exactly one function: `exports.handler = async (event) => {...}`
- Shared modules export named functions: `module.exports = { computeMasterData, round, evalExpr, renderText }`

**Artifacts (storage keys):**
- Pattern: `{article}/{stepId}/v{version}/{artifact}`
- Text artifacts: `{SIZE}_texts.json` (e.g., `M_texts.json`)
- Image artifacts: `{SIZE}_{imageType}.png` (e.g., `M_infographic.png`)
- Master data: `master-data.json`

**Step IDs (strings used in manifest and routing):**
- `01-normalize`, `02-texts`, `03-images`, `04-video`, `05-excel`, `06-assemble`

## Entry Points

**API Server (development):**
- `infra/local-server.js` — starts HTTP server on `:3001`, loads `.env.local`, delegates all requests to `functions/api/index.js`
- Started via `npm run api` or as part of `npm run dev`

**API Handler (production / cloud):**
- `functions/api/index.js:exports.handler` — receives YC API Gateway events directly

**Frontend:**
- `frontend/PipelineApp.jsx` — Vite dev server on `:5173`, proxies `/api/*` to `:3001`

**Step Handlers (triggered by YMQ in production, directly in local dev):**
- `functions/step-texts/index.js:exports.handler`
- `functions/step-images/index.js:exports.handler`
- `functions/step-video/index.js:exports.handler`
- `functions/step-excel/index.js:exports.handler`
- `functions/step-assemble/index.js:exports.handler`

## Shared Code

All shared code lives in `layers/shared/`. Modules reference it via:
```js
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');
const store = require(path.join(SHARED, 'versionStore'));
```

This pattern allows the same code to work locally (relative path) and in a Yandex Cloud Lambda Layer (`SHARED_LAYER_PATH` set by runtime).

### `layers/shared/templateEngine.js`
Exports: `computeMasterData(questionnaire, template)` → `SizeRecord[]`
Pure functions only. Uses `new Function()` to evaluate formula strings from `template.master.json`. No I/O, no imports outside Node.js builtins.

### `layers/shared/versionStore.js`
Exports: `getManifest`, `updateManifest`, `putArtifact`, `getArtifact`, `listArtifacts`, `listArticles`
All methods delegate to the adapter selected by `STORE_ADAPTER` env var (default: `cloud-with-fallback`).

### `layers/shared/excelWriter.js`
Exports: xlsx generation function consuming master data and a column map JSON.
Uses `exceljs`. Called by `functions/step-excel/index.js`.

### `layers/shared/config/`
All JSON, no code. Loaded directly with `require()` by step handlers:
- `template.master.json` — formula definitions consumed by `templateEngine.js`
- `ozon.column-map.json`, `wb.column-map.json` — consumed by `excelWriter.js`
- `prompts.*.json` — consumed by respective step handlers

## Where to Add New Code

**New pipeline step:**
- Create `functions/step-{name}/index.js` exporting `exports.handler = async (event) => {...}`
- Register step ID in `functions/api/index.js` (add to `STEP_QUEUES` if async, or add direct call in `handleRegenerate` if sync)
- Add any prompt config to `layers/shared/config/prompts.{name}.json`

**New storage method:**
- Add the method to all three adapter objects (`local`, `yandexCloud`, `makeCloudWithFallback`) in `layers/shared/versionStore.js`
- Export it in the public interface section at the bottom of `versionStore.js`

**New marketplace column map:**
- Add `layers/shared/config/{marketplace}.column-map.json`
- Handle it in `functions/step-excel/index.js`

**New questionnaire field:**
- Update `input/questionnaire.schema.json`
- If formula-driven: add to `computedFields` or `textTemplates` in `layers/shared/config/template.master.json`
- If manual per-size: add to `sizes[]` in questionnaire and pass through in `layers/shared/templateEngine.js:computeMasterData`

**Shared utility function:**
- Add to `layers/shared/` as a new `camelCase.js` module
- Export named functions via `module.exports = { ... }`

---

*Structure analysis: 2026-06-15*
