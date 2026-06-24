# Codebase Concerns

**Analysis Date:** 2026-06-15

## Critical Gaps

**No E2E test run completed:**
- CLAUDE.md explicitly marks "E2E прогон: отправить реальный опросник, пройти все 6 шагов" as `[ ]` (incomplete)
- No automated tests exist in the codebase at all — zero `.test.*` or `.spec.*` files found
- The full pipeline has never been validated end-to-end

**Frontend is disconnected from real API:**
- `frontend/PipelineApp.jsx` contains large hardcoded mock datasets: `LINES`, `MASTER_DATA`, `TEXTS`, `IMAGES`, `VIDEO`, `VERSIONS` constants (lines 73–190) with fake article data for articles `0553`, `0612`, `0588`
- The `apiFetch` helper exists and is wired, but the component renders mostly from these static constants rather than live API responses
- New lines created via API will not appear in the UI automatically — the app renders a fixed `LINES` array

**Generator-critic retry loop broken in local mode (step-texts):**
- `enqueueRetry` in `functions/step-texts/index.js` line 223: when `YMQ_TEXTS_QUEUE_URL` is not set (local dev), it only logs `'[step-texts] would enqueue retry'` and returns — the retry is silently dropped
- Same issue in `functions/step-images/index.js` line 196: `'[step-images] would enqueue retry'` — retry is never executed locally
- In local mode, the generator-critic loop runs exactly one attempt regardless of critic verdict

**step-video polling loop broken in local mode:**
- `handleGenerate` in `functions/step-video/index.js` line 95 calls `enqueueMessage(process.env.YMQ_VIDEO_QUEUE_URL, ...)` for the poll phase, but `enqueueMessage` (line 239–253) silently no-ops if queue URL is absent: `console.log('[step-video] would enqueue:', message)` — the poll phase never executes locally

## Technical Debt

**Massive hardcoded mock data in production frontend file:**
- `frontend/PipelineApp.jsx` contains ~120 lines of hardcoded mock data (articles, dimensions, texts, images, video readiness, versions) that duplicate what the API returns
- Files: `frontend/PipelineApp.jsx` lines 73–190
- Impact: any real article data returned by the API is ignored; developers may not notice the disconnect

**versionStore manifest update is not atomic:**
- `yandexCloud.updateManifest` in `layers/shared/versionStore.js` (lines 134–151) does read-modify-write with no locking or conditional put
- Concurrent step executions for the same article (e.g., all 5 sizes of `02-texts` running in parallel) will overwrite each other's history entries
- The local adapter has the same race condition (`local.updateManifest`, lines 31–47)
- Impact: history entries lost under parallelism; `currentVersion` may be stale

**`deepMerge` silently replaces arrays:**
- `deepMerge` in `layers/shared/versionStore.js` (line 252) replaces arrays wholesale rather than appending: `result[key] = value`
- The `history` array in manifest patches is always replaced, not appended — the caller must pass the full merged array every time
- Pattern is fragile and forces all callers to manually spread `[...existing, newEntry]`

**Claude model ID hardcoded as string:**
- `functions/step-images/index.js` line 172: model hardcoded as `'claude-sonnet-4-6'` — will silently break when the model is deprecated

**`api-gateway.yaml` is in `infra/` but untested:**
- The YAML contract is presumably used for cloud deployment, but there is no validation that routes in `functions/api/index.js` actually match the gateway config

## Security Risks

**CORS allows all origins (`*`):**
- `infra/local-server.js` line 99: `'Access-Control-Allow-Origin': '*'`
- Acceptable for local dev, but if this server is exposed beyond localhost (e.g., on a shared network) any origin can call the API
- If this pattern is copied to a production config, it becomes a real risk

**Env file `.env.local` parsed with a naive regex:**
- `infra/local-server.js` lines 36–41: home-rolled env parser using `/^([A-Z_][A-Z0-9_]*)=(.*)$/` — does not handle quoted values with spaces, multiline values, or `#` comments mid-line correctly
- A malformed `.env.local` line could silently set wrong env var values without any error

**No input validation on questionnaire fields:**
- `functions/api/index.js` `handleCreateLine` (lines 181–231) only checks `article` is present; all other questionnaire fields are passed directly to `templateEngine.computeMasterData` without schema validation
- Malformed or malicious input could produce unexpected master data or crash the template engine

**API keys passed in Bearer header with no error masking:**
- `functions/step-images/index.js` line 201: on API error, `res.text()` is logged directly — Kling/OpenAI error responses sometimes echo back parts of the request including auth tokens in some providers

## Reliability Risks

**Fire-and-forget errors are silently swallowed:**
- `functions/api/index.js` `runLocally` (lines 63–72): individual step errors are caught and logged with `console.error` but never surfaced to the caller or the manifest
- A step that crashes locally leaves the manifest in a stale state with no `error` field to indicate failure; the frontend has no way to distinguish "running" from "crashed"

**`handleListLines` swallows all `listArticles` errors:**
- Line 154: `catch { return respond(200, { lines: [] }); }` — any storage failure returns an empty list rather than an error, hiding cloud connectivity problems

**No timeout on OpenAI/Anthropic/Kling fetch calls:**
- All `fetch` calls to external APIs in `step-texts`, `step-images`, `step-video` use no timeout or `AbortController`
- A hanging API response will block the Node.js handler indefinitely in local mode (fire-and-forget goroutine hangs, memory leak)

**Video stub saves literal string `'VIDEO_STUB'` as mp4:**
- `functions/step-video/index.js` line 69: `Buffer.from('VIDEO_STUB')` — saved as a `.mp4` file; any downstream consumer trying to parse this as video will fail silently

**Manifest `currentVersion` logic is racy under concurrent writes:**
- Each step reads `stepMeta?.currentVersion ?? 0` and increments it locally; under concurrent execution of the same step (multiple sizes), all workers read the same version and write to the same `v1`, overwriting each other
- Files: `functions/step-texts/index.js` line 62, `functions/step-images/index.js` line 70, `functions/step-video/index.js` line 156

## Scalability Concerns

**`yandexCloud.listArticles` uses a full DynamoDB Scan:**
- `layers/shared/versionStore.js` line 186: `ScanCommand` with no filter — scans the entire `mold-manifests` table
- As the article count grows, this becomes progressively slower and more expensive; Scan reads every item

**`handleListLines` loads every manifest in parallel:**
- `functions/api/index.js` lines 158–178: `Promise.all(articles.map(...))` fires one `getManifest` + one `getArtifact` call per article simultaneously
- At 100+ articles this creates a thundering herd of S3/YDB requests

**`handleGetStep` inlines all JSON artifacts:**
- Lines 244–252: iterates over every artifact name and reads + parses all `.json` files inline in the response
- A step with many artifacts (e.g., 5 sizes × all versions) will inline a large payload on every GET

**No pagination on any list endpoint:**
- `GET /lines` returns all articles; `listArtifacts` returns all artifact names — no limit/offset/cursor

## Incomplete Items

**Generator-critic retry silently no-ops locally (see Critical Gaps above):**
- `functions/step-texts/index.js` line 223: `console.log('[step-texts] would enqueue retry:', message)` — retry never fires locally
- `functions/step-images/index.js` line 196: same pattern

**Video poll re-enqueue no-ops locally:**
- `functions/step-video/index.js` line 241: `console.log('[step-video] would enqueue:', message)` — poll phase never executes without a real YMQ queue URL

**`step-assemble` does not validate that all prior steps are complete:**
- `functions/step-assemble/index.js` line 55: `pendingSteps` list is computed, but the handler does not block or warn — it assembles a partial report when steps are missing

**`proxy/` directory exists but is not documented:**
- `proxy/` directory is present at project root (appeared in git status) but is not mentioned in CLAUDE.md or PROJECT_BRIEF.md; purpose and contents unknown

**`deploy/` directory exists but deployment is not documented:**
- `deploy/` directory is present but not described in CLAUDE.md; `infra/deploy.sh`, `infra/env.sh`, `infra/env.sh.example` exist but deployment process is undocumented

## Missing Infrastructure

**No automated testing infrastructure:**
- No test runner configured (no `jest.config.*`, `vitest.config.*`)
- No test files anywhere in the codebase
- `templateEngine.js` is described in CLAUDE.md as "testable directly without mocks" but no tests exist

**YMQ queues not provisioned locally:**
- The generator-critic retry loop and video poll loop require Yandex Message Queue URLs to function correctly
- No local queue emulator (e.g., LocalStack, ElasticMQ) is set up or documented
- Result: in local dev, multi-attempt critic loops are silently skipped

**No health check endpoint:**
- No `GET /health` or equivalent — no way to verify the API server is up and connected to storage without making a real business call

**No error state in manifests:**
- When a step crashes (locally or in cloud), nothing is written to the manifest
- Frontend has no way to show "step failed" vs "step pending" vs "step running"

## Immediate Priorities

1. **Fix local retry loop in step-texts and step-images** — `enqueueRetry` must call the handler directly (similar to `runLocally` in `api/index.js`) when no queue URL is present; otherwise local dev never exercises the critic loop at all. Files: `functions/step-texts/index.js` line 221, `functions/step-images/index.js` line 194.

2. **Fix video poll phase in local mode** — `enqueueMessage` in `functions/step-video/index.js` must trigger a recursive/direct `handlePoll` call when `queueUrl` is absent (line 241), otherwise the video step always produces a stub even when Kling API key is set.

3. **Replace hardcoded mock data in PipelineApp.jsx with live API calls** — `LINES`, `MASTER_DATA`, `TEXTS`, `IMAGES`, `VIDEO`, `VERSIONS` constants (lines 73–190) must be removed and replaced with `useEffect`/`apiFetch` calls; otherwise the UI is permanently showing fake data regardless of what the backend produces.

4. **Add error state to manifests** — steps that crash should write `{ error: err.message, failedAt: ... }` to the manifest so the frontend can show failure; the current fire-and-forget in `runLocally` logs to console only.

5. **Run E2E pipeline with a real questionnaire** — submit article `0553` questionnaire through all 6 steps end-to-end and fix any issues that surface; this is the only way to verify the pipeline actually works as a system.

---

*Concerns audit: 2026-06-15*
