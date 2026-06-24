# External Integrations

**Analysis Date:** 2026-06-15

## AI APIs

### OpenAI

- **Purpose 1 — Text generation** (`functions/step-texts/index.js`)
  - Endpoint: `https://api.openai.com/v1/chat/completions`
  - Model: `gpt-4o-mini`
  - Auth: `Authorization: Bearer ${OPENAI_API_KEY}` header
  - Transport: native `fetch` (no SDK)

- **Purpose 2 — Image generation** (`functions/step-images/index.js`)
  - Endpoint: `https://api.openai.com/v1/images/generations`
  - Model: `gpt-image-1`
  - Parameters: `n: 1, size: '1024x1024'`
  - Auth: `Authorization: Bearer ${OPENAI_API_KEY}` header
  - Transport: native `fetch`
  - Response: base64-encoded image decoded to `Buffer` and stored as artifact

### Anthropic Claude

- **Purpose — Image critic (Claude Vision)** (`functions/step-images/index.js`)
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - Model: `claude-sonnet-4-6`
  - Auth: `x-api-key: ${ANTHROPIC_API_KEY}` header + `anthropic-version: 2023-06-01`
  - Transport: native `fetch`
  - Usage: Receives generated image as base64, returns structured critique verdict

- **Purpose — Text critic (fallback)** (`functions/step-texts/index.js`)
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - Model: `claude-haiku-4-5-20251001`
  - Auth: `x-api-key: ${ANTHROPIC_API_KEY}` header
  - Transport: native `fetch`

### Kling.ai

- **Purpose — Video generation** (`functions/step-video/index.js`)
  - Submit endpoint: `https://api.klingai.com/v1/videos/image2video` (POST)
  - Poll endpoint: `https://api.klingai.com/v1/videos/image2video/{taskId}` (GET)
  - Auth: `Authorization: Bearer ${KLING_API_KEY}` header
  - Transport: native `fetch`
  - Pattern: async fire-and-forget — submit returns `taskId`, caller re-invokes handler with `phase: 'poll'` until complete
  - Video params: model, duration, cfg_scale from `layers/shared/config/prompts.video.json` (`klingApi.imageToVideo`)

## Cloud Storage (Yandex Cloud)

### YDB Serverless (manifests)

- **SDK:** `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` (DynamoDB-compatible API)
- **Client:** `DynamoDBClient` wrapped with `DynamoDBDocumentClient`
- **Endpoint:** `${YDB_DOCUMENT_API_ENDPOINT}` (Yandex Cloud Document API)
- **Region:** `ru-central1` (hardcoded)
- **Auth:** `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
- **Table:** `${YDB_TABLE_NAME}` (default: `mold-manifests`)
- **Schema:** `{ article: string (PK), data: string (JSON-serialized manifest), updatedAt: ISO8601 }`
- **Operations used:** `GetCommand`, `PutCommand`, `ScanCommand`
- **Implementation:** `layers/shared/versionStore.js` — `yandexCloud` adapter

### Object Storage (artifacts)

- **SDK:** `@aws-sdk/client-s3`
- **Client:** `S3Client` with `forcePathStyle: true`
- **Endpoint:** `${YC_ENDPOINT}` (default: `https://storage.yandexcloud.net`)
- **Bucket:** `${YC_BUCKET_NAME}` (default: `mold-pipeline-output`)
- **Auth:** `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
- **Key format:** `{article}/{stepId}/v{version}/{artifactName}`
- **Operations used:** `PutObjectCommand`, `GetObjectCommand`, `ListObjectsV2Command`
- **Implementation:** `layers/shared/versionStore.js` — `yandexCloud` adapter

## Other External Services

None beyond AI APIs and Yandex Cloud. No email, SMS, payment, or analytics integrations detected.

`@aws-sdk/client-sqs` is declared in `package.json` dependencies but no usage found in current source files — likely reserved for future queue-based step dispatch.

## Integration Patterns

### Storage Adapter Pattern

All storage access goes through a single module (`layers/shared/versionStore.js`) that exposes a uniform interface regardless of backend:

```
getManifest(article)
updateManifest(article, stepId, patch)
putArtifact(article, stepId, version, name, buffer)
getArtifact(article, stepId, version, name)
listArtifacts(article, stepId, version)
listArticles()
```

Three adapter implementations are selected via `STORE_ADAPTER` env var:
- `local` — filesystem only (`OUTPUT_DIR`)
- `yandex-cloud` — YDB + Object Storage only
- `cloud-with-fallback` (default) — tries `yandex-cloud`, catches any error and retries via `local`

Fallback is **per-call, not sticky**: each invocation independently tries cloud first.
Fallback warning: `console.warn('[versionStore] cloud unavailable (${method}), falling back to local:', err.message)`

### AI API Call Pattern

All AI API calls use native `fetch` (no SDK wrappers):
1. Build prompt from JSON config template + `sizeRecord` data
2. POST to API endpoint with `Authorization` or `x-api-key` header
3. Parse JSON response, extract content
4. Return raw result to caller (step handler)

### Generator-Critic Loop Pattern

Steps `02-texts` and `03-images` implement a generator→critic loop:
1. Generate output via OpenAI
2. Critique via rule-based check (texts) or Claude Vision (images)
3. If critic returns `ok: false` and `attempt < 3`: recurse with `attempt + 1` and `feedback` array
4. On exhaustion: save with `needsReview: true` in manifest
5. All attempts recorded in `manifest.steps[stepId].history[]`

### Async Step Pattern

Long-running steps (`02-texts`, `03-images`, `04-video`) run fire-and-forget:
- `functions/api/index.js` calls `runLocally(stepId, messages)` and immediately returns HTTP 202
- Progress tracked by polling `GET /lines/:id/manifest`

## Auth & Secrets

**Storage:**
- `.env.local` in project root (parsed manually by `infra/local-server.js` at startup)
- Never committed to git (in `.gitignore`)

**Required API keys:**

| Env Var | Service | Used In |
|---------|---------|---------|
| `OPENAI_API_KEY` | OpenAI | `functions/step-texts/index.js`, `functions/step-images/index.js` |
| `ANTHROPIC_API_KEY` | Anthropic | `functions/step-texts/index.js`, `functions/step-images/index.js` |
| `KLING_API_KEY` | Kling.ai | `functions/step-video/index.js` |
| `AWS_ACCESS_KEY_ID` | Yandex Cloud | `layers/shared/versionStore.js` |
| `AWS_SECRET_ACCESS_KEY` | Yandex Cloud | `layers/shared/versionStore.js` |
| `YDB_DOCUMENT_API_ENDPOINT` | YDB | `layers/shared/versionStore.js` |
| `YDB_TABLE_NAME` | YDB | `layers/shared/versionStore.js` (default: `mold-manifests`) |
| `YC_BUCKET_NAME` | Object Storage | `layers/shared/versionStore.js` (default: `mold-pipeline-output`) |
| `YC_ENDPOINT` | Object Storage | `layers/shared/versionStore.js` (default: `https://storage.yandexcloud.net`) |

**Key access pattern:**
```js
// Keys read directly from process.env at call time — not cached at module load
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) return respond(500, { error: 'OPENAI_API_KEY not set' });
```

---

*Integration audit: 2026-06-15*
