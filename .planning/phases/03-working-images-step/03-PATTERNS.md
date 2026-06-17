# Phase 3: Working Images Step - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 6 (4 modified, 1 new test, 1 new asset directory)
**Analogs found:** 5 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `functions/step-images/index.js` (modify) | service (step handler) | request-response + transform (image-in-image) | `functions/step-texts/index.js` | exact (sibling step, identical handler contract) |
| `layers/shared/config/prompts.images.json` (modify) | config | transform (prompt template) | `layers/shared/config/prompts.texts.json` | exact (sibling prompt config) |
| `functions/api/index.js` (modify, line 12) | route/dispatcher | request-response | self (`SIZES`/`VIDEO_TYPES` constants, dispatch loop) | exact (one-token constant change) |
| `frontend/PipelineApp.jsx` (verify/optional) | component | request-response (POST trigger) | self (`VersionPicker` + `handleRegenerateStep`) | exact (button already exists) |
| `test/step-images.test.js` (new) | test | request-response (handler invocation) | `test/step-texts.test.js` | exact (sibling step test) |
| `layers/shared/templates/` (new dir) | config/static asset | file-I/O (read background PNG) | none | no analog |

## Pattern Assignments

### `functions/step-images/index.js` (service, request-response + transform)

**Analog:** `functions/step-texts/index.js` (the already-fixed sibling — Phase 2 applied the same four fixes there; replicate verbatim).

This file already shares the analog's exact structure (imports lines 1-13, `parseMessage`, `respond`, `sha256`, cache check, terminal-save branch). Phase 3 ports four corrections from step-texts plus rewrites `generateImage`.

**Imports pattern** — already correct in step-images lines 1-13. Add `fs` (research line 274):
```js
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');   // ADD — step-images currently imports only crypto + path
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');
const store        = require(path.join(SHARED, 'versionStore'));
const promptsTmpl  = require(path.join(SHARED, 'config/prompts.images.json'));
```
`SHARED` is defined at step-images line 6 — reuse for `path.join(SHARED, 'templates', `${imageType}.png`)`.

**Destructure `attemptsLog`** — COPY from step-texts line 26 (step-images line 25 omits `attemptsLog`):
```js
// step-texts:26 (analog) — add `attemptsLog = []`:
const { article, size, imageType, attempt = 1, feedback = [], force = false, attemptsLog = [] } = msg;
```

**Terminal-save `attempts` field (BUG-3 / D-11)** — COPY from step-texts line 78. step-images line 83 currently calls the broken `buildAttemptsLog(stepMeta, ...)` helper; replace with the threaded accumulator:
```js
// step-texts:72-79 (analog) — historyEntry.attempts:
const historyEntry = {
  version: nextVersion,
  size,
  imageType,                                   // step-images carries imageType (step-texts does not)
  createdAt: new Date().toISOString(),
  inputHash,
  needsReview,
  attempts: [...attemptsLog, { attempt, criticVerdict }],   // D-11 — was buildAttemptsLog(stepMeta,...)
};
```
Then DELETE the `buildAttemptsLog` helper (step-images lines 227-230).

**Recursive retry (BUG-2 / D-10)** — COPY from step-texts lines 90-93. step-images lines 99-101 currently call the no-op `enqueueRetry` then `respond(202)`. Replace with a direct self-recursion (add `imageType` to the threaded body):
```js
// step-texts:89-93 (analog) — replace enqueueRetry + respond(202):
return exports.handler({ body: JSON.stringify({
  article, size, imageType, attempt: attempt + 1,
  feedback: criticVerdict.issues, force,
  attemptsLog: [...attemptsLog, { attempt, criticVerdict }],
}) });
```
Then DELETE the `enqueueRetry` helper (step-images lines 194-209) — this also removes the only `@aws-sdk/client-sqs` usage in this file.

**`generateImage` rewrite (BUG-1 D-09 + BUG-4 D-01 + D-12)** — no analog for the Edits-API call (step-texts uses chat/completions); the structure (prompt substitution → stub guard → API call → Buffer return) mirrors step-texts `generateTexts` lines 100-181. Current step-images `generateImage` is lines 108-142. Apply:
- Substitution chain (step-images lines 111-119): replace `.replace('{{faceSize}}', sizeRecord.faceSize)` with `.replace('{{moldSize}}', sizeRecord.moldSize)` (D-09 — `faceSize` is `undefined` on every sizeRecord), and add `.replace('{{topic}}', sizeRecord.topic).replace('{{purpose}}', sizeRecord.purpose)` (D-12). Note step-texts line 111/117/118 already substitute `{{moldSize}}`, `{{topic}}`, `{{purpose}}` — mirror those field names exactly.
- Stub guard (step-images lines 125-131): keep VERBATIM (D-04). It returns the 1×1 PNG before any template/photo read.
- Pass `article` into `generateImage` — update call site step-images line 53: `generateImage(article, sizeRecord, imageType, feedback)`.
- Replace the `/v1/images/generations` JSON POST (step-images lines 133-141) with the Edits-API multipart pattern from research lines 134-172 (background template via `fs.readFileSync(path.join(SHARED,'templates',`${imageType}.png`))` → friendly 500 on ENOENT; photos via `store.listArtifacts(article,'photos',1)` + `store.getArtifact(...)`; built-in `FormData`+`Blob` with `image[]` = [bg, ...photos]; POST `https://api.openai.com/v1/images/edits` with only `Authorization` header — NO manual `Content-Type`; parse `data.data[0].b64_json`).

**"no mold photo" → 400 (D-03, OQ-1):** the empty-photo check throws inside `generateImage` and currently surfaces as 500 via the catch at step-images lines 54-57. Per D-03 move the `store.listArtifacts(article,'photos',1)` empty check into the handler body BEFORE calling `generateImage` and `return respond(400, { error: 'no mold photo found' })` there. The `respond` helper (step-images lines 232-238) is unchanged.

**Keep as-is (research lines 86-91):** `parseMessage` (215-225), `respond` (232-238), `sha256` (240-242), stub path (125-131), `runCritic` (148-188), cache check (42-47).

---

### `layers/shared/config/prompts.images.json` (config, transform)

**Analog:** `layers/shared/config/prompts.texts.json` (sibling prompt config; same `{{token}}` substitution convention and `feedback*` suffix key).

**Current structure** (full file, 10 lines): keys `imageTypes` (4 types), `prompts` (4 entries), `feedbackSuffix`. D-06 keeps all 4 prompt entries; only `infographic` matters for MVP.

**Changes:**
- D-09: replace every `{{faceSize}}` with `{{moldSize}}`. It appears in the `main`, `infographic`, and `scale` prompts (lines 4, 5, 6). Only `infographic` is dispatched for MVP, but fix all to keep the config consistent and avoid future `undefined`.
- D-12: add `{{topic}}` and `{{purpose}}` tokens to the `infographic` prompt (line 5) so the composition instruction accounts for the mold type. These tokens must match the substitution chain added to `generateImage` and the field names already used by step-texts (`prompts.texts.json` references `{{topic}}`/`{{purpose}}`).
- Claude's Discretion: reword the `infographic` prompt from a text-to-image description into a layout/composition instruction (where to place the mold photo on the background, where the text blocks go). The `feedbackSuffix` key (line 9) is consumed by `generateImage` (`promptsTmpl.feedbackSuffix.replace('{{issues}}', ...)`) — keep that key name.

---

### `functions/api/index.js` (route/dispatcher, request-response)

**Analog:** self — sibling constants `SIZES` (line 11) and `VIDEO_TYPES` (line 13) and the dispatch loop (lines 369-391).

**Single change (D-05), line 12:**
```js
// FROM:
const IMAGE_TYPES = ['main', 'infographic', 'scale', 'lifestyle'];
// TO:
const IMAGE_TYPES = ['infographic'];
```

**Dispatch loop is UNCHANGED** (lines 374-376) — it already maps `SIZES.flatMap(size => IMAGE_TYPES.map(...))`, so with one type it yields exactly 5 messages (D-05). `runLocally('03-images', ...)` (lines 56-73, 389-390) already fire-and-forgets and the route returns `respond(202, ...)` (line 392). No routing work needed.

---

### `frontend/PipelineApp.jsx` (component, request-response)

**Analog:** self — `VersionPicker` (lines 262-295) + `handleRegenerateStep` (lines 848-858).

**The trigger button already exists (IMG-01 satisfied).** `VersionPicker` renders "Запустить шаг" when no versions (lines 267-269) or "Перегенерировать" when versions exist (lines 290-292); both call `onRegenerate` → `handleRegenerateStep`:
```js
// handleRegenerateStep (848-858) — already POSTs to 03-images for the active step:
const stepId = STEP_KEY_TO_ID[activeStep];           // 'images' → '03-images'
await apiFetch(`/lines/${activeLineId}/steps/${stepId}/regenerate`,
  { method: 'POST', body: JSON.stringify({ force: true }) });
```
`apiFetch` (line 11) prepends `API_BASE`, sets JSON `Content-Type`, throws on non-2xx.

**Phase 3 work:** verify the existing button works end-to-end for `activeStep === 'images'`. D-07 literal (a dedicated "Генерировать изображения" button) is OPTIONAL; if added, place it alongside `VersionPicker`/in `ImagesView` and reuse `handleRegenerateStep` (same pattern, no new fetch wiring). Do NOT touch the frontend `IMAGE_TYPES` 4-tile array (research OQ-2 — cosmetic, Phase 4 owns it).

---

### `test/step-images.test.js` (test, new)

**Analog:** `test/step-texts.test.js` (sibling step test; reuse its harness wholesale).

**Env preamble** — COPY from step-texts.test.js lines 7-10 (sets local store, tmp output, shared path, stub mode so generation never hits the network and never reads the template PNG):
```js
process.env.STORE_ADAPTER     = 'local';
process.env.OUTPUT_DIR        = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
process.env.USE_STUB          = 'true';   // unset OPENAI_API_KEY → stub 1×1 PNG path
```
Note: step-images stub is gated on `!apiKey` (OPENAI_API_KEY), not `USE_STUB` — ensure `OPENAI_API_KEY` is unset in the test env so the stub branch returns before any template/photo read (research Pitfall 3 / OQ-3).

**`createLine` helper** — COPY VERBATIM from step-texts.test.js lines 25-69. It seeds master-data via the api handler using a multipart-style event with a `files: [{ filename, mimeType, buffer }]` photo so `store.putArtifact(article,'photos',1,...)` runs — this is REQUIRED for step-images (the photo must exist for IMG-03 / D-03). The fixture is `test/fixtures/test-mold.png` (line 26).

**`runImages` helper** — adapt `runTexts` (lines 75-81), adding `imageType`:
```js
async function runImages(article, size, imageType = 'infographic', extra = {}) {
  const result = await handler({
    body: JSON.stringify({ article, size, imageType, attempt: 1, force: true, ...extra }),
  });
  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  return { statusCode: result.statusCode, body };
}
```
Always pass `force: true` (Pitfall 5 — avoids cache-skip) and a unique article per test.

**`readManifest` helper** — COPY VERBATIM from lines 86-89.

**Test cases to mirror** (RED in Wave 0; map per research §Test Map): all-5-sizes produce `{size}_infographic.png` (IMG-02/03/04); prompt has no unresolved `{{...}}` and no literal `faceSize` (D-09 — mirror the regression guards at step-texts.test.js lines 104-111); manifest `attempts[]` accumulation through MAX_ATTEMPTS (D-10/D-11 — mirror lines 200-232); `respond(400, 'no mold photo found')` when photo absent (D-03). For deterministic IMG-03 (photo used as reference) without a live API, mirror the step-texts `runCritic` export pattern (step-texts line 237 `exports.runCritic`) by exporting a `buildEditRequest` helper from step-images returning `{ prompt, imageCount }` to assert on (research Wave-0 Gaps).

---

### `layers/shared/templates/` (config/static asset, file-I/O) — NO ANALOG

New directory holding user-provided background PNGs read via `fs.readFileSync(path.join(SHARED, 'templates', `${imageType}.png`))`. For MVP only `infographic.png` is needed (D-00c). No existing static-asset-read pattern in the codebase (all other shared assets are `require`d JSON configs). Path resolution reuses the existing `SHARED` constant (step-images line 6) so tests pointing `SHARED_LAYER_PATH` at a fixture layer resolve `templates/` under it. The stub path returns before this read, so stub-mode Wave-0 tests do NOT require the file; real generation 500s with a friendly message until the user supplies it.

## Shared Patterns

### Recursive local retry + attemptsLog accumulation (Phase 2 canonical)
**Source:** `functions/step-texts/index.js` lines 26 (destructure), 78 (accumulate), 89-93 (recurse)
**Apply to:** `functions/step-images/index.js` (D-10/D-11). The generator-critic loop runs synchronously via `exports.handler({ body: JSON.stringify({...}) })` — never YMQ in local dev. Thread `attemptsLog` through the message body, never read prior attempts from the saved manifest.
```js
// destructure:  const { ..., attemptsLog = [] } = msg;
// accumulate:   attempts: [...attemptsLog, { attempt, criticVerdict }]
// recurse:      return exports.handler({ body: JSON.stringify({ ..., attempt: attempt+1, attemptsLog: [...attemptsLog, { attempt, criticVerdict }] }) });
```

### Handler skeleton (parse → load master → cache → generate → critic → save/retry)
**Source:** both `step-texts/index.js` and `step-images/index.js` (already identical lines 1-47)
**Apply to:** unchanged in step-images; only the generate + retry + save bodies are touched. `parseMessage`, `respond`, `sha256` are duplicated verbatim across both files — keep step-images' copies as-is.

### versionStore artifact read/write (photos in, slides out)
**Source:** `functions/api/index.js:218` (`store.putArtifact(article, 'photos', 1, safeName, f.buffer)`) + `layers/shared/versionStore.js` exports `listArtifacts`/`getArtifact`/`putArtifact`/`updateManifest`
**Apply to:** `step-images/index.js` `generateImage` — read photos with `store.listArtifacts(article, 'photos', 1)` then `store.getArtifact(article, 'photos', 1, name)` (Buffer per photo); save slides with the existing `store.putArtifact(article, STEP_ID, nextVersion, `${size}_${imageType}.png`, imageBuffer)` (step-images line 74, unchanged) + `store.updateManifest` (lines 86-90, unchanged).

### Prompt token substitution
**Source:** `functions/step-texts/index.js` lines 108-119 (`.replace('{{moldName}}', ...).replace('{{topic}}', ...).replace('{{purpose}}', ...)`)
**Apply to:** `step-images/index.js` `generateImage` substitution chain — use the SAME sizeRecord field names (`moldSize`, `topic`, `purpose`), never `faceSize`.

### Test harness (local store + stub + per-test unique article + force)
**Source:** `test/step-texts.test.js` lines 7-10 (env), 25-69 (`createLine`), 75-81 (`runTexts`), 86-89 (`readManifest`)
**Apply to:** `test/step-images.test.js` — reuse `createLine`/`readManifest` verbatim; adapt `runTexts`→`runImages` to carry `imageType`. Discovery: `node --test 'test/**/*.test.js'`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `layers/shared/templates/` | config/static asset | file-I/O | First static binary asset read from disk; all other shared assets are `require`d JSON. The fs read pattern itself is documented in RESEARCH.md lines 271-280. |

## Metadata

**Analog search scope:** `functions/` (step-texts, step-images, api), `layers/shared/config/`, `test/`, `frontend/PipelineApp.jsx`
**Files scanned:** 7 (all line numbers cross-checked against RESEARCH.md, which independently verified them)
**Pattern extraction date:** 2026-06-16
