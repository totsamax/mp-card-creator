<!-- refreshed: 2026-06-15 -->
# Architecture

**Analysis Date:** 2026-06-15

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     Frontend (React / Vite :5173)                   │
│                     frontend/PipelineApp.jsx                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP /api/* (Vite proxy)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              API Router / Orchestrator (:3001)                       │
│              infra/local-server.js → functions/api/index.js          │
└──┬──────────────┬────────────────┬──────────────────────────────────┘
   │ sync         │ fire-and-forget│ sync
   ▼              ▼                ▼
┌──────────┐  ┌──────────────────────────────────────────────────┐
│01-normalize│ │  Async Step Handlers (one per step)               │
│step-excel  │ │  functions/step-texts/index.js   (02-texts)       │
│step-assemble│ │  functions/step-images/index.js  (03-images)      │
└──────────┘  │  functions/step-video/index.js   (04-video)       │
              └──────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    layers/shared/versionStore.js                     │
│          cloud-with-fallback | yandex-cloud | local adapters         │
└──────────────┬───────────────────────┬──────────────────────────────┘
               │                       │
               ▼                       ▼
┌─────────────────────┐   ┌────────────────────────────────────────┐
│  Yandex YDB         │   │  Yandex Object Storage (S3-compatible)  │
│  manifests table    │   │  artifact blobs: images, xlsx, json     │
│  (DynamoDB compat.) │   │  key: {article}/{step}/v{N}/{artifact}  │
└─────────────────────┘   └────────────────────────────────────────┘
               │ (fallback on any error)
               ▼
┌──────────────────────────────────┐
│  Local filesystem  ./output/     │
│  Same path structure as S3 keys  │
└──────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| local-server | HTTP adapter: translates Node.js `http.IncomingMessage` → YC API Gateway event format, loads `.env.local`, writes to `logs/api.log` | `infra/local-server.js` |
| api/index.js | REST router (CRUD + step orchestration), step cache check, runLocally vs YMQ dispatch | `functions/api/index.js` |
| step-normalize | Questionnaire → master data (5 sizes), stores `master-data.json` | `functions/step-normalize/index.js` (delegated to api for step 01) |
| step-texts | LLM text generation per size with generator-critic loop | `functions/step-texts/index.js` |
| step-images | OpenAI image generation per size/type with Claude Vision critic loop | `functions/step-images/index.js` |
| step-video | kling.ai video generation | `functions/step-video/index.js` |
| step-excel | Generates Ozon/WB xlsx from master data via column maps | `functions/step-excel/index.js` |
| step-assemble | Collects all artifacts into a packaged output folder | `functions/step-assemble/index.js` |
| templateEngine | Pure: questionnaire + template.master.json → SizeRecord[] (5 rows) | `layers/shared/templateEngine.js` |
| versionStore | Storage adapter (3 modes): manifest CRUD + artifact blob storage | `layers/shared/versionStore.js` |
| excelWriter | exceljs-based xlsx generation from master data + column map | `layers/shared/excelWriter.js` |
| PipelineApp | React UI: questionnaire form, pipeline stepper, artifact preview, version selector | `frontend/PipelineApp.jsx` |

## Data Flow

### Primary Request Path: Create a Product Line

1. User submits questionnaire → `POST /lines` (`functions/api/index.js:handleCreateLine`)
2. `computeMasterData(questionnaire, template)` is called (`layers/shared/templateEngine.js`)
3. Resulting `masterData[]` (5 SizeRecords) is saved as `master-data.json` via `store.putArtifact` (`layers/shared/versionStore.js`)
4. Manifest updated via `store.updateManifest` with `{ currentVersion, history[], inputHash }`
5. API returns 200 with `{ article, stepId: '01-normalize', version, masterData }`

### Async Step Trigger Path (steps 02, 03, 04)

1. `POST /lines/:id/steps/:step/regenerate` → `handleRegenerate` (`functions/api/index.js:303`)
2. Builds message batch (one per size, or per size×imageType for images)
3. If `YMQ_*_QUEUE_URL` env var is set → sends to Yandex Message Queue (cloud mode)
4. If not set → calls `runLocally(stepId, messages)` — fire-and-forget, returns 202 immediately
5. Step handler executes: loads master data from store → calls AI API → runs critic → saves artifact → updates manifest

### Artifact Retrieval Path

1. `GET /lines/:id/steps/:step/artifacts/:name` → `handleGetArtifact`
2. Resolves effective version: explicit query `?version=N` > `stepMeta.overrides[name]` > history lookup
3. Returns artifact as base64-encoded binary with appropriate `Content-Type`

### State Management (Manifest)

- One `manifest.json` per article (keyed by `article` in YDB or as file on disk)
- Schema:
  ```json
  {
    "article": "0553",
    "steps": {
      "01-normalize": {
        "currentVersion": 2,
        "history": [{ "version": 1, "createdAt": "...", "inputHash": "abc123", "questionnaire": {} }]
      },
      "03-images": {
        "currentVersion": 3,
        "history": [...],
        "overrides": { "M_infographic.png": "v2" }
      }
    }
  }
  ```
- Writes use read-merge-write pattern (no atomic partial updates in YDB Document API)
- `deepMerge` helper (`layers/shared/versionStore.js:250`) performs non-destructive patch

## Key Design Patterns

### Handler Pattern (Serverless-compatible)
Every step module exports a single `exports.handler = async (event) => {...}` function. `event.body` may be JSON string or base64-encoded depending on invocation path. All handlers parse with `parseMessage()`.

### Storage Adapter Pattern
`versionStore.js` exposes a fixed interface (`getManifest`, `updateManifest`, `putArtifact`, `getArtifact`, `listArtifacts`, `listArticles`) with three backend implementations selected by `STORE_ADAPTER` env var:
- `local`: filesystem at `OUTPUT_DIR`
- `yandex-cloud`: YDB (DynamoDB compat.) + Object Storage (S3 compat.)
- `cloud-with-fallback` (default): wraps every `yandex-cloud` call in try/catch, falls back to `local` per-call on any error

### Input Hash Cache
Before executing a step, handlers compute `sha256(JSON.stringify({ inputs, config }))`. If the last history entry has the same hash and is not flagged `needsReview`, the step is skipped (returns `{ skipped: true }`). Override with `force: true` in the request body.

### Fire-and-Forget Async
Steps 02, 03, 04 are invoked fire-and-forget via `runLocally()` (`functions/api/index.js:56`). The API returns 202 immediately. Progress is tracked by polling `GET /lines/:id/manifest`.

### Dual Dispatch (Cloud / Local)
`handleRegenerate` checks for `YMQ_*_QUEUE_URL` env var. If present, publishes to Yandex Message Queue (production). If absent, calls step handler directly in-process (local dev). Same code path, different transport.

### Template-Driven Computation
`templateEngine.js` uses `new Function()` to evaluate formula strings from `template.master.json`. Fields are evaluated in declaration order so computed fields can reference previously computed fields (e.g., `weightPacked` depends on `moldWeight`).

## Pipeline Steps

| Step | ID | Sync/Async | Input | Output |
|------|----|-----------|-------|--------|
| Normalize | `01-normalize` | Sync | Questionnaire JSON | `master-data.json` (5 SizeRecords) |
| Texts | `02-texts` | Async (fire-and-forget) | master-data + prompts.texts.json | `{size}_texts.json` per size |
| Images | `03-images` | Async (fire-and-forget) | master-data + prompts.images.json | `{size}_{imageType}.png` (4 types × 5 sizes = 20 images) |
| Video | `04-video` | Async (fire-and-forget) | master-data + generated images | video files per size/type |
| Excel | `05-excel` | Sync | master-data + column maps | `ozon.xlsx`, `wb.xlsx` |
| Assemble | `06-assemble` | Sync | all step artifacts | packaged output folder |

Steps 01, 05, 06 are dispatched synchronously by `handleRegenerate` via `requireStep()`. Steps 02, 03, 04 go through `runLocally()` or YMQ.

## Generator-Critic Loops

Steps 02-texts and 03-images run internal generator-critic cycles.

### Shared Mechanics

```
Message: { article, size, [imageType], attempt: N, feedback?: [...issues], force? }

Handler:
  1. Load SizeRecord from master-data.json
  2. Check input hash cache (skip if unchanged and not needsReview)
  3. Call Generator (LLM / image API) with feedback appended to prompt
  4. Call Critic → { ok: boolean, issues: string[] }
  5a. If ok OR attempt >= MAX_ATTEMPTS (3):
       - putArtifact(result)
       - updateManifest with { needsReview: !ok, attempts: [...log] }
       - return 200
  5b. If !ok AND attempt < MAX_ATTEMPTS:
       - enqueueRetry({ ..., attempt: N+1, feedback: issues })
       - return 202
```

### 02-texts Critic (`functions/step-texts/index.js:191`)
Rule-based, no LLM. Checks:
- Field length limits (e.g., `titleShort` ≤ 30 chars) from `config/prompts.critic-texts.json`
- Required substrings present in each field
- Banned phrases not present
Config: `layers/shared/config/prompts.critic-texts.json`

### 03-images Critic (`functions/step-images/index.js:148`)
Claude Vision (`claude-sonnet-4-6`). Sends generated image as base64 alongside text prompt. Returns `{ ok, issues }` JSON. On critic API failure, defaults to `{ ok: true }` to avoid blocking the pipeline.
Config: `layers/shared/config/prompts.critic-images.json`

### Retry in Local Dev
When `YMQ_*_QUEUE_URL` is not set, `enqueueRetry()` only logs a warning. Retries do not happen automatically in local mode — only the first attempt runs (see `functions/step-texts/index.js:222`, `functions/step-images/index.js:195`).

### Generator Fallback Chain (02-texts)
`generateTexts()` tries providers in order: Anthropic Claude (haiku) → OpenAI (gpt-4o-mini) → template-computed stub. Controlled by `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` env vars. `USE_STUB=true` bypasses all API calls.

## Error Handling

**Strategy:** Throw errors upward; do not swallow silently. `console.error` is the logging mechanism.

**Patterns:**
- Top-level `try/catch` in `exports.handler` → returns `{ statusCode: 500, error: err.message }`
- Store operations: cloud adapter errors → per-call fallback to local (logged as `console.warn`)
- Critic failures in 03-images → treated as `ok: true` to avoid blocking (explicitly noted in code)
- AI API failures → step returns 500 (caller can retry via regenerate endpoint)

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. No worker threads. Async steps run fire-and-forget in the same process in local mode.
- **Global state:** None. `versionStore` adapter is selected per-call via `getAdapter()`. No module-level mutable singletons.
- **Circular imports:** None detected. Dependency graph is strictly layered: `infra` → `functions/api` → `layers/shared`.
- **YDB atomic updates:** Not available for nested fields. `updateManifest` uses read-merge-write, creating a TOCTOU window under concurrent writes to the same article.
- **Local retry limitation:** Generator-critic retry loop requires YMQ. In local dev, only attempt 1 runs automatically. Subsequent attempts must be triggered manually.

## Anti-Patterns

### Writing step 01-normalize inline in api/index.js

**What happens:** Step 01 (normalize) is implemented directly in `functions/api/index.js:handleCreateLine` rather than in `functions/step-normalize/index.js`.
**Why it's wrong:** Breaks the pattern that all steps live in their own module; `step-normalize/index.js` exists but is unused.
**Do this instead:** Move normalization logic to `functions/step-normalize/index.js` and call it via `requireStep('step-normalize')`.

---

*Architecture analysis: 2026-06-15*
