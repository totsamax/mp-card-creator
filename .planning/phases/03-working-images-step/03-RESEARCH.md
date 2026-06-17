# Phase 3: Working Images Step - Research

**Researched:** 2026-06-16
**Domain:** OpenAI Images Edits API (image-in-image), Node.js multipart, versionStore artifact reading, recursive local retry
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-00:** Итоговый слайд = фон-шаблон (статичный PNG) + фото молда (из versionStore) + инструкция компоновки (из prompts.images.json с подстановкой sizeRecord). Всё отправляется в OpenAI `/v1/images/edits`. AI «склеивает» компоненты.
- **D-00b:** `step-images` НЕ зависит от `step-texts`. Текстовые элементы берутся из `sizeRecord` (master-data), не из артефакта `02-texts`.
- **D-00c:** Фоновые шаблоны в `layers/shared/templates/`. Для MVP нужен `infographic.png`. Файл не найден → 500 с понятным сообщением.
- **D-01:** OpenAI `/v1/images/edits`. `image[]` = [фон-шаблон, ...все фото молда]. `prompt` = инструкция компоновки из `prompts.images.json`.
- **D-02:** Все фото молда передаются. Читать через `store.listArtifacts(article, 'photos', 1)` → `store.getArtifact` для каждого.
- **D-03:** Фото не загружено → 400 `"no mold photo found"`. Фото обязательно (INP-01).
- **D-04:** OPENAI_API_KEY отсутствует → stub (1×1 прозрачный PNG). Не менять stub-путь.
- **D-05:** `IMAGE_TYPES = ['infographic']` в `functions/api/index.js`. Итого 5 вызовов OpenAI (1 тип × 5 размеров).
- **D-06:** `prompts.images.json` оставить с 4 типами промптов — IMAGE_TYPES определяет что запускается.
- **D-07:** Кнопка "Генерировать изображения" в секции степпера `03-images` в `PipelineApp.jsx`. → `POST /lines/:id/steps/03-images/regenerate`.
- **D-08:** Кнопка показывает 202 → "запущено". Без индикатора прогресса.
- **D-09:** `{{faceSize}}` → `{{moldSize}}` в `generateImage` substitution chain + в `prompts.images.json`.
- **D-10:** `enqueueRetry` → рекурсивный `exports.handler({ body: JSON.stringify({...}) })` + `attemptsLog` (DEC-01 из Phase 2).
- **D-11:** `buildAttemptsLog(stepMeta, attempt, criticVerdict)` → `[...attemptsLog, { attempt, criticVerdict }]`.
- **D-12:** Добавить `{{topic}}` и `{{purpose}}` в промпт infographic.

### Claude's Discretion

- Конкретная реализация FormData multipart (Node built-in `FormData` + `Blob` или ручной boundary).
- Формулировка промпта infographic как инструкции компоновки.
- Claude Vision критик: оставить as-is (принимает всё без ANTHROPIC_API_KEY). Не менять в Phase 3.

### Deferred Ideas (OUT OF SCOPE)

- Типы слайдов `main`, `scale`, `lifestyle` — после MVP.
- Индикатор прогресса в UI (polling) — Phase 4.
- Critic для изображений (Claude Vision) — реализован, не менять.
- Generator-critic loop тестирование через реальный critic — Phase 5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IMG-01 | Шаг 03-images запускается при нажатии кнопки в UI | UI button **already exists** via `VersionPicker` → `handleRegenerateStep` → `POST .../03-images/regenerate`. The route + `runLocally` dispatch already returns 202. See "UI Stepper" + "API routing" sections. Mostly a verification/labeling task, not net-new wiring. |
| IMG-02 | Генерируются инфографические слайды по зафиксированному шаблону | `IMAGE_TYPES=['infographic']` (D-05) + read `layers/shared/templates/infographic.png` as background. Edits API composites. See "OpenAI Edits API" + "Templates dir" sections. |
| IMG-03 | Входное фото молда используется как reference | `store.listArtifacts(article,'photos',1)` → `getArtifact` per photo → append each as `image[]`. Prompt explicitly references the mold photo. See "versionStore photo listing". |
| IMG-04 | Изображения сохраняются в output/ и доступны в UI | `store.putArtifact(...,'{size}_infographic.png',buf)` (unchanged) + `GET .../artifacts/:name` (exists, line 127-129 api). See "Artifact retrieval". |
</phase_requirements>

## Summary

Phase 3 converts `functions/step-images/index.js` from a stubbed, broken text-to-image generator into a working image-in-image compositor. The current handler has **four concrete defects** carried over from the Phase 2 pattern fix that was never applied to step-images: a `{{faceSize}}` placeholder that references a field that **does not exist** in master-data (the field is `moldSize`), a no-op `enqueueRetry` instead of recursive `exports.handler` self-call, a broken `buildAttemptsLog` that reads from `stepMeta.history` instead of threading an `attemptsLog` argument, and it calls `/v1/images/generations` (text→image) instead of `/v1/images/edits` (image→image composition).

The fix mirrors the already-working `functions/step-texts/index.js` exactly. step-texts threads `attemptsLog` through the message body and recurses via `exports.handler({ body: JSON.stringify({...}) })` — step-images must adopt the identical pattern (D-10, D-11). For image generation, `generateImage` must: (1) read the background template from `layers/shared/templates/{imageType}.png` via `fs.readFileSync` and 500 if missing (D-00c), (2) read all mold photos via `store.listArtifacts(article,'photos',1)` + `store.getArtifact` and 400 `"no mold photo found"` if none (D-02/D-03), (3) build a `multipart/form-data` body with Node 18+ built-in `FormData`+`Blob` sending `image[]` = [background, ...photos], and (4) POST to `https://api.openai.com/v1/images/edits` with `model: gpt-image-1`, parsing `data.data[0].b64_json` (D-01).

The UI button (IMG-01) **already exists** — `VersionPicker` renders "Запустить шаг"/"Перегенерировать" which calls `handleRegenerateStep`, already POSTing to `/lines/:id/steps/03-images/regenerate` for the active step. The remaining UI work is minimal (label/verify, optionally a dedicated button per D-07). The `GET artifacts` route already serves PNGs (IMG-04).

**Primary recommendation:** Replicate the step-texts recursive pattern verbatim, rewrite `generateImage` to read template+photos and call the Edits API with built-in `FormData`/`Blob`, change `IMAGE_TYPES` to `['infographic']`, and add a Wave-0 RED test (`test/step-images.test.js`) modeled on `test/step-texts.test.js`. No new npm packages are needed — everything uses Node.js 18+ built-ins (`fetch`, `FormData`, `Blob`, `fs`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trigger image generation (button) | Frontend (React) | API router | UI emits POST; router already dispatches |
| Route POST → step dispatch | API / Backend (`functions/api`) | — | Owns `/regenerate` routing + `runLocally` fire-and-forget |
| Read background template | Backend (`step-images`) | Filesystem | Static asset on disk in shared layer |
| Read mold photos | Backend (`step-images`) | versionStore | Photos are step-`photos` artifacts |
| Compose slide (image-in-image) | External (OpenAI Edits API) | Backend builds request | AI does the compositing per prompt |
| Persist slide PNG | Backend → versionStore | Object Storage / FS | Standard `putArtifact` save-branch |
| Serve slide to UI | API / Backend | — | `GET .../artifacts/:name` returns base64 PNG |

## Current step-images/index.js — Exact Bugs Found

File: `functions/step-images/index.js` (243 lines). All four defects are D-09…D-11 + the Edits-API switch.

| # | Bug | Line(s) | Current code | Fix (per CONTEXT) |
|---|-----|---------|--------------|-------------------|
| BUG-1 (D-09) | `{{faceSize}}` references a **non-existent** master-data field | 113 | `.replace('{{faceSize}}', sizeRecord.faceSize)` | Replace with `{{moldSize}}` → `sizeRecord.moldSize`. `faceSize` is `undefined` on every sizeRecord (templateEngine emits `moldSize`, never `faceSize`). |
| BUG-2 (D-10) | `enqueueRetry` is a no-op without `YMQ_IMAGES_QUEUE_URL` — retry silently dies | 99-101, 194-209 | `await enqueueRetry({...}); return respond(202, {queued:true...})` | Recurse: `return exports.handler({ body: JSON.stringify({ article, size, imageType, attempt: attempt+1, feedback: criticVerdict.issues, force, attemptsLog: [...attemptsLog, {attempt, criticVerdict}] }) });` — copy step-texts:90-93 exactly. Delete `enqueueRetry`. |
| BUG-3 (D-11) | `buildAttemptsLog` reads prior attempts from the **saved manifest history** (wrong source) instead of threading through the call chain | 83, 227-230 | `attempts: buildAttemptsLog(stepMeta, attempt, criticVerdict)` where the helper does `stepMeta?.history?.slice(-1)[0]?.attempts ?? []` | Add `attemptsLog = []` to destructure (line 25), use `attempts: [...attemptsLog, { attempt, criticVerdict }]` in historyEntry (matches step-texts:78). Delete `buildAttemptsLog` helper. |
| BUG-4 (D-01) | Calls text→image `/v1/images/generations` — ignores background + photos entirely | 133-141 | `fetch('.../v1/images/generations', {... body: JSON.stringify({model:'gpt-image-1', prompt, n:1, size:'1024x1024'})})` | Rewrite `generateImage` to read template + photos, build `FormData`, POST `/v1/images/edits`. See code pattern below. |

**Secondary observations (not bugs, keep as-is):**
- `parseMessage` (215-225), `respond` (232-238), `sha256` (240-242) are correct — keep.
- Stub path (lines 125-131): keep verbatim (D-04). It returns a 1×1 transparent PNG when `!apiKey`.
- `runCritic` (148-188): keep as-is (D-04 / Claude's Discretion — accepts everything without `ANTHROPIC_API_KEY`).
- Cache check (42-47): correct. Note `inputHash` (line 39) hashes `{sizeRecord, imageType, promptsTmpl}` — it does **not** include photos or template bytes. For MVP this is acceptable (photos are fixed per line); flag in Open Questions.
- The `enqueueRetry` SQS path uses `@aws-sdk/client-sqs` (line 200) — after D-10 the whole function is deleted, removing that import usage from this file.

## OpenAI Images Edits API — Node.js raw fetch pattern

[VERIFIED: OpenAI API docs via WebSearch + community/QuantumNous mirror] `gpt-image-1` supports **multi-image edits**: up to 16 input images, each PNG/WEBP/JPG < 25 MB, sent as repeated `image[]` multipart fields. Response defaults to `b64_json` for `gpt-image-1` (no `response_format` param needed). `size` accepts `1024x1024`, `1536x1024`, `1024x1536`, or `auto`.

> Note on D-00c "RGBA PNG ≤4MB": that constraint is the older `dall-e-2` edit limit. `gpt-image-1` raises it to 25 MB and accepts PNG/JPG/WEBP without a strict RGBA requirement. The templates the user provides should still be PNG for predictability. [CITED: platform.openai.com/docs/api-reference/images]

**Recommended `generateImage` rewrite (Node.js 18+ built-ins, no SDK):**

```js
// Source pattern: OpenAI images/edits + Node built-in FormData/Blob (verified shape)
const fs = require('fs');
// at top of file: const fs = require('fs');  (add — currently only crypto+path imported)

async function generateImage(article, sizeRecord, imageType, feedback) {
  const apiKey = process.env.OPENAI_API_KEY;

  // 1) Build composition prompt from sizeRecord (D-00b: no dependency on step-texts)
  let prompt = (promptsTmpl.prompts[imageType] || promptsTmpl.prompts.infographic)
    .replace('{{moldName}}',   sizeRecord.moldName)
    .replace('{{moldSize}}',   sizeRecord.moldSize)      // D-09: was {{faceSize}}
    .replace('{{color}}',      sizeRecord.color)
    .replace('{{moldLength}}', sizeRecord.moldLength)
    .replace('{{moldWidth}}',  sizeRecord.moldWidth)
    .replace('{{moldHeight}}', sizeRecord.moldHeight)
    .replace('{{toyFrom}}',    sizeRecord.toyFrom)
    .replace('{{toyTo}}',      sizeRecord.toyTo)
    .replace('{{topic}}',      sizeRecord.topic)         // D-12
    .replace('{{purpose}}',    sizeRecord.purpose);      // D-12

  if (feedback.length > 0) {
    prompt += promptsTmpl.feedbackSuffix.replace('{{issues}}', feedback.join('; '));
  }

  // 2) Stub path UNCHANGED (D-04)
  if (!apiKey) {
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
  }

  // 3) Background template from layers/shared/templates/{imageType}.png (D-00c)
  const templatePath = path.join(SHARED, 'templates', `${imageType}.png`);
  let bgBuffer;
  try {
    bgBuffer = fs.readFileSync(templatePath);
  } catch {
    throw new Error(`Background template not found: ${templatePath}. Add ${imageType}.png to layers/shared/templates/`);
  }

  // 4) All mold photos from versionStore (D-02/D-03)
  const photoNames = await store.listArtifacts(article, 'photos', 1);
  if (!photoNames || photoNames.length === 0) {
    throw new Error('no mold photo found');   // surfaced as 500 by caller; see note below
  }
  const photoBuffers = [];
  for (const name of photoNames) {
    photoBuffers.push(await store.getArtifact(article, 'photos', 1, name));
  }

  // 5) multipart/form-data with built-in FormData + Blob (Node 18+)
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  // image[] order: background first, then every mold photo
  form.append('image[]', new Blob([bgBuffer], { type: 'image/png' }), `${imageType}.png`);
  photoBuffers.forEach((buf, i) => {
    form.append('image[]', new Blob([buf], { type: 'image/png' }), `mold-${i}.png`);
  });

  // 6) POST — do NOT set Content-Type; fetch derives the boundary from FormData
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI Images Edits API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, 'base64'); // gpt-image-1 returns b64_json by default
}
```

**Critical gotchas:**
- **Do NOT set `Content-Type` header manually.** When `body` is a `FormData` instance, Node's `fetch` (undici) auto-generates the `multipart/form-data; boundary=...` header. Setting it manually breaks the boundary. (This matches an existing project decision logged in STATE.md: "FormData без ручного Content-Type — браузер сам выставляет boundary".)
- `Blob` and `FormData` are **global** in Node 18+ — no `require`. Confirmed runtime: **Node v22.22.1**.
- The mold-photo check throws → current caller wraps `generateImage` in try/catch and returns **500** (line 54-57). D-03 wants **400 `"no mold photo found"`**. Decide in planning: either (a) check photos in the handler before calling `generateImage` and `return respond(400,...)`, or (b) special-case the message. Cleaner: move the `listArtifacts`/empty check into the handler body and `respond(400, { error: 'no mold photo found' })` there. (Open Question OQ-1.)
- `generateImage` now needs `article` passed in — update the call site (line 53): `imageBuffer = await generateImage(article, sizeRecord, imageType, feedback);`.

## versionStore photo listing — CONFIRMED EXISTS

[VERIFIED: codebase read `layers/shared/versionStore.js`] `listArtifacts(article, stepId, version)` **exists and is exported** in all three adapters:

- `local` (lines 60-68): `fs.promises.readdir(<OUTPUT_DIR>/<article>/<stepId>/v<version>)`; returns `[]` on ENOENT.
- `yandex-cloud` (lines 175-183): `ListObjectsV2Command` with prefix `${article}/${stepId}/v${version}/`, strips prefix → returns filenames.
- `cloud-with-fallback` (lines 200-213): wraps yandex-cloud, falls back to local on error.
- Public export (line 242): `listArtifacts: (article, stepId, version) => getAdapter().listArtifacts(article, stepId, version)`.

`getArtifact(article, stepId, version, name)` returns a **Buffer** (local: `fs.promises.readFile`; cloud: stream collected into `Buffer.concat`). Exactly what the Edits API needs.

**Photo storage location (CONFIRMED):** `functions/api/index.js:218` stores uploads via `store.putArtifact(article, 'photos', 1, safeName, f.buffer)`. So photos live at step `'photos'`, version `1`. → `store.listArtifacts(article, 'photos', 1)` returns the sanitized filenames; `store.getArtifact(article, 'photos', 1, name)` returns each photo Buffer. This is exactly D-02.

## IMAGE_TYPES constant — exact location

[VERIFIED: codebase read]
- **Backend (the one to change, D-05):** `functions/api/index.js:12`
  ```js
  const IMAGE_TYPES = ['main', 'infographic', 'scale', 'lifestyle'];
  ```
  → change to `const IMAGE_TYPES = ['infographic'];`
- **Dispatch loop using it (CONFIRMED, line 374-376):**
  ```js
  messages = SIZES.flatMap(size =>
    IMAGE_TYPES.map(imageType => ({ article, size, imageType, attempt: 1, force }))
  );
  ```
  With `IMAGE_TYPES=['infographic']` this yields exactly 5 messages (1 type × 5 sizes) → 5 OpenAI calls. ✓ matches D-05.
- **Frontend constant (separate, line 156-161 in `frontend/PipelineApp.jsx`):** a different array of `{key,label}` objects used by `ImagesView` to render a grid of 4 tiles per size. This is **not** the dispatch constant. CONTEXT does not ask to change it (the extra tiles will simply show the empty-image placeholder for non-infographic types). Leave for Phase 4 cleanup unless planning chooses to trim it. (Note: `computeStepStatus` for images uses `total = sizes.length * 4` at line 555 — with only infographic generated, status will show e.g. `5/20` "partial". Cosmetic; out of scope for Phase 3 success criteria. Flag OQ-2.)

## Recursive handler pattern (from step-texts) — condensed

[VERIFIED: codebase read `functions/step-texts/index.js`] The working pattern to replicate in step-images:

```js
// 1) Destructure attemptsLog from the message (default [])
const { article, size, imageType, attempt = 1, feedback = [], force = false, attemptsLog = [] } = msg;

// ... generate + critic ...

// 2) Terminal branch (critic ok OR attempts exhausted): save with full attempts log
if (criticVerdict.ok || attempt >= MAX_ATTEMPTS) {
  const historyEntry = {
    version: nextVersion, size, imageType, createdAt: new Date().toISOString(),
    inputHash, needsReview,
    attempts: [...attemptsLog, { attempt, criticVerdict }],   // D-11
  };
  // ... putArtifact + updateManifest ...
  return respond(200, {...});
}

// 3) Retry branch: recurse DIRECTLY (no YMQ), threading attemptsLog forward
return exports.handler({ body: JSON.stringify({
  article, size, imageType, attempt: attempt + 1,
  feedback: criticVerdict.issues, force,
  attemptsLog: [...attemptsLog, { attempt, criticVerdict }],   // D-10/D-11
}) });
```

Key differences from step-texts: step-images carries `imageType` in the message; otherwise identical. step-texts:90-93 is the canonical recursion call; step-texts:78 is the canonical attempts accumulation.

## UI Stepper section for 03-images

[VERIFIED: codebase read `frontend/PipelineApp.jsx`]

**The trigger button for IMG-01 already exists.** Flow:
- `STEPS[2]` = `{ key: 'images', code: '03', label: 'Изображения', icon: ImageIcon }` (line 78).
- `STEP_KEY_TO_ID = { ..., images: '03-images', ... }` (line 786).
- When `activeStep === 'images'`, the page renders `<VersionPicker onRegenerate={handleRegenerateStep} />` (lines 993-998).
- `VersionPicker` (262-295): if no versions → renders **"Запустить шаг"** button (line 267-269); if versions exist → **"Перегенерировать"** button (line 290-292). Both call `onRegenerate`.
- `handleRegenerateStep` (848-858):
  ```js
  const stepId = STEP_KEY_TO_ID[activeStep];  // '03-images'
  await apiFetch(`/lines/${activeLineId}/steps/${stepId}/regenerate`, {
    method: 'POST', body: JSON.stringify({ force: true })
  });
  ```
  This already produces `POST /lines/:id/steps/03-images/regenerate` and the route returns 202.

**Implication for D-07:** Success Criterion 1 (button → POST → 202) is **already satisfied** by existing code. The planning options:
1. **Minimal (recommended):** verify the existing VersionPicker button works end-to-end for images, add a Wave-0 frontend smoke check / manual verify. No net-new button needed.
2. **Per D-07 literal:** add a dedicated labeled "Генерировать изображения" button in the images section. If chosen, place it in `ImagesView` (lines 421-471) or alongside `VersionPicker` for `stepKey==='images'`, calling the same `handleRegenerateStep`. Use `apiFetch` (line 11) which sets JSON Content-Type — fine here (regenerate body is JSON, not multipart).

`apiFetch` signature (line 11): `apiFetch(path, opts = {})` — prepends `API_BASE`, sets `Content-Type: application/json`, throws on non-2xx, returns parsed JSON.

## Templates directory — DOES NOT EXIST, must create

[VERIFIED: filesystem] `layers/shared/templates/` does **not** exist (only `config/`, `excelWriter.js`, `templateEngine.js`, `versionStore.js` under `layers/shared/`).

**fs path pattern for reading the background:**
```js
const path = require('path');
const fs   = require('fs');  // ADD — step-images currently imports only crypto + path
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');
const templatePath = path.join(SHARED, 'templates', `${imageType}.png`);
const bgBuffer = fs.readFileSync(templatePath); // throws ENOENT → catch → throw friendly error (D-00c)
```

`SHARED` is already defined at line 6 of step-images. Tests override it via `process.env.SHARED_LAYER_PATH` (see step-texts.test.js:9), so `templates/` will resolve under whatever shared layer the test points at — keep the real `infographic.png` at `layers/shared/templates/infographic.png`.

**Planning note:** the background PNG is a user-provided asset (D-00c). For Wave-0 tests to pass without a real design asset, the plan needs either (a) a committed placeholder `layers/shared/templates/infographic.png`, or (b) tests that run the stub path (`OPENAI_API_KEY` unset → returns 1×1 PNG and **never reads the template**). Note the stub path returns **before** template/photo reads in the recommended code, so stub-mode tests don't need the template file. Real-API tests do. (Open Question OQ-3.)

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fetch` (undici) | Node v22.22.1 | HTTP to OpenAI Edits API | Already used throughout; project mandates no extra HTTP libs |
| Node.js built-in `FormData` | Node v22.22.1 | multipart/form-data body | Global since Node 18; correct boundary handling with fetch |
| Node.js built-in `Blob` | Node v22.22.1 | Wrap image Buffers for FormData | Global since Node 18 |
| Node.js built-in `fs` | Node v22.22.1 | Read background template | `readFileSync` for static asset |
| `versionStore` (project) | — | List/read mold photos, save slides | Existing storage abstraction (3 adapters) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Built-in FormData+Blob | `openai` npm SDK `images.edit` + `toFile` | Violates "no extra deps" spirit; SDK had a bug rejecting gpt-image-1 on `images.edit` ([CITED: github.com/openai/openai-node/issues/1844]) — raw fetch avoids it |
| Built-in FormData | `form-data` npm package + manual boundary | Unnecessary dependency; built-in works on Node 22 |

**Installation:** None. No new npm packages. (Package Legitimacy Audit therefore N/A — see below.)

## Package Legitimacy Audit

**Not applicable.** Phase 3 installs **no external packages**. All functionality uses Node.js 18+/22 built-ins (`fetch`, `FormData`, `Blob`, `fs`, `crypto`, `path`) and the existing project `versionStore`. No registry verification required.

## Architecture Patterns

### Data Flow (image generation)

```
[UI] "Запустить шаг" (VersionPicker)
   └─ apiFetch POST /lines/:id/steps/03-images/regenerate {force:true}
        │
        ▼
[api/index.js] handleRegenerate → stepId '03-images'
   ├─ build messages: SIZES × IMAGE_TYPES(['infographic']) = 5 msgs
   ├─ no YMQ URL → runLocally('03-images', messages)  [fire-and-forget, returns 202]
        │
        ▼ (background, per message)
[step-images handler] parseMessage → load master-data → cache check
   └─ generateImage(article, sizeRecord, 'infographic', feedback)
        ├─ stub if !OPENAI_API_KEY → 1×1 PNG (return early)
        ├─ fs.readFileSync(SHARED/templates/infographic.png)  → bg Buffer
        ├─ store.listArtifacts(article,'photos',1) → names
        ├─ store.getArtifact(article,'photos',1,name) per name → photo Buffers
        ├─ FormData: image[]=[bg, ...photos], prompt, model, size
        └─ fetch POST /v1/images/edits → b64_json → Buffer
   └─ runCritic (Claude Vision stub → ok:true) 
   └─ terminal: putArtifact('{size}_infographic.png') + updateManifest(attempts[])
        │  (or recurse on critic reject up to MAX_ATTEMPTS=3)
        ▼
[output/{article}/03-images/v{N}/{size}_infographic.png]
        │
        ▼
[UI ImagesView] GET /lines/:id/steps/03-images/artifacts/{size}_infographic.png?version=N
   └─ api handleGetArtifact → base64 PNG (Content-Type image/png)
```

### Anti-Patterns to Avoid
- **Setting `Content-Type` manually with FormData** — breaks the multipart boundary. Let fetch set it.
- **Calling `/v1/images/generations`** — that's text→image and ignores the reference photo (the IMG-03 requirement). Must use `/v1/images/edits`.
- **Reading retry history from the manifest** (`buildAttemptsLog` current bug) — thread `attemptsLog` through the message instead.
- **Depending on step-texts artifacts** — D-00b: pull title/size text from `sizeRecord` only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| multipart/form-data encoding | Manual boundary string + Buffer concat | Built-in `FormData` + `Blob` | undici fetch handles boundary + length correctly |
| Local retry loop | YMQ emulator / setTimeout queue | Recursive `exports.handler` (step-texts pattern) | Already proven in Phase 2; synchronous, testable |
| Listing/reading photos | Direct S3/`fs` calls in handler | `store.listArtifacts` / `store.getArtifact` | Adapter handles cloud+fallback transparently |
| Image compositing logic | Sharp/canvas pixel manipulation | OpenAI `/v1/images/edits` (D-00) | The decided architecture: AI composites per prompt |

## Common Pitfalls

### Pitfall 1: `{{faceSize}}` resolves to `undefined`
**What goes wrong:** `sizeRecord.faceSize` is `undefined` (master-data has `moldSize`, never `faceSize`), so the prompt contains the literal string `undefined` or an empty value.
**Why:** templateEngine emits `moldSize` (questionnaire field renamed in Phase 1). step-images was never updated.
**How to avoid:** D-09 — replace with `{{moldSize}}` in both `generateImage` and `prompts.images.json`.
**Warning sign:** prompt logs containing `undefined` or `{{faceSize}}`.

### Pitfall 2: Manual Content-Type header
**What goes wrong:** `headers: {'Content-Type':'multipart/form-data'}` without a boundary → OpenAI returns 400 "could not parse multipart".
**How to avoid:** omit Content-Type; only set `Authorization`.

### Pitfall 3: Missing template file in tests
**What goes wrong:** real-API tests `fs.readFileSync` a non-existent `infographic.png` → throw.
**How to avoid:** run handler tests in stub mode (unset `OPENAI_API_KEY`) which returns before reading the template; commit a placeholder PNG for any real-API test. (OQ-3.)

### Pitfall 4: 500 vs 400 for missing photo
**What goes wrong:** throwing inside `generateImage` for "no mold photo" surfaces as 500 (caught at line 54-57), but D-03 wants 400.
**How to avoid:** move the photo-empty check into the handler body and `respond(400, {error:'no mold photo found'})`. (OQ-1.)

### Pitfall 5: Cache-skip in tests
**What goes wrong:** re-running same article without `force:true` returns `{skipped:true}` (cache check lines 42-47).
**How to avoid:** use unique article IDs per test and/or `force:true` — exactly as step-texts.test.js does (`runTexts` always passes `force:true`).

## Validation Architecture

> nyquist_validation is **enabled** (config.json workflow.nyquist_validation = true).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert` |
| Config file | none — discovery via glob in package.json |
| Quick run command | `node --test 'test/step-images.test.js'` |
| Full suite command | `node --test 'test/**/*.test.js'` (npm test) |

> Node v22 requires a **glob pattern**, not a directory, for `--test` discovery (logged in STATE.md decisions). The package.json `test` script already uses `'test/**/*.test.js'`.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMG-02/03/04 | step-images produces `{size}_infographic.png` for all 5 sizes via stub | unit/integration | `node --test 'test/step-images.test.js'` | ❌ Wave 0 |
| IMG-03 | prompt sent to Edits API references the mold photo / `image[]` includes photo buffers | unit | same | ❌ Wave 0 |
| D-09 | no `{{faceSize}}` / no unresolved `{{...}}` in prompt | unit | same | ❌ Wave 0 |
| D-10/D-11 | critic reject recurses to MAX_ATTEMPTS, manifest `attempts[]` length === 3 | unit | same | ❌ Wave 0 |
| IMG-01 | POST /lines/:id/steps/03-images/regenerate returns 202 | integration | same (via api handler) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test 'test/step-images.test.js'`
- **Per wave merge:** `npm test` (full suite — currently 10/10 GREEN; must stay green)
- **Phase gate:** full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/step-images.test.js` — model on `test/step-texts.test.js` (reuse its `createLine` multipart helper, `readManifest`, unique-article-per-test, `force:true`). Set `process.env.USE_STUB`/unset `OPENAI_API_KEY` so generation uses the stub PNG path. Covers IMG-01..04 + D-09/D-10/D-11.
- [ ] To assert IMG-03 (photo used as reference) deterministically without a live API: refactor `generateImage` so the prompt/`image[]` assembly is unit-testable, **or** export a helper `buildEditRequest(article, sizeRecord, imageType, feedback)` returning `{ prompt, imageCount }` that the test can assert on (prompt has no `{{...}}`, imageCount === 1 background + N photos). Recommended — mirrors how step-texts exports `runCritic`.
- [ ] (If real-API test wanted later) commit `layers/shared/templates/infographic.png` placeholder. Not required for stub-mode Wave 0.

## Security Domain

> security_enforcement enabled (ASVS level 1).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth (single-team tool, out of scope) |
| V3 Session Management | no | Stateless handlers |
| V4 Access Control | partial | `article` regex validated in api (line 108-110) before any store call — already enforced |
| V5 Input Validation | yes | `imageType` is server-controlled (`IMAGE_TYPES`), not user free-text → no path injection via `templates/${imageType}.png`. Keep `imageType` constrained to the allowlist. |
| V6 Cryptography | no | No new crypto; `sha256` only for cache hashing |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `imageType` in `templates/${imageType}.png` | Tampering | `imageType` originates from the server `IMAGE_TYPES` allowlist via dispatch, not raw user input. Validate `imageType` against `promptsTmpl.imageTypes` before `fs.readFileSync`; reject unknown types. |
| Path traversal via photo filename | Tampering | Already mitigated: filenames sanitized at upload (api/index.js:214 `replace(/[^a-zA-Z0-9._-]/g,'_')`). `listArtifacts` returns only stored names. |
| SSRF via OpenAI URL | — | URL is a hardcoded constant; no user-controlled host. |
| API key leakage in logs | Info disclosure | Do not log `prompt` request with the Authorization header; current code logs only generation metadata. Keep keys out of `console.*`. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (fetch/FormData/Blob) | Edits API request | ✓ | v22.22.1 | — |
| `OPENAI_API_KEY` | Real image generation | unknown (env) | — | Stub 1×1 PNG (D-04) — tests + local dev work without it |
| `ANTHROPIC_API_KEY` | Image critic | unknown (env) | — | Critic returns `{ok:true}` (D-04) |
| `layers/shared/templates/infographic.png` | Real generation background | ✗ (dir missing) | — | Stub path skips template read; real generation 500s until provided (D-00c) |

**Missing dependencies with fallback:** OPENAI/ANTHROPIC keys (stub paths). 
**Missing, blocking real generation only:** `infographic.png` template — user-provided per D-00c; not blocking for stub-mode Wave-0 tests or the 202 success criterion.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gpt-image-1` accepts repeated `image[]` multipart fields for multi-image edits | OpenAI Edits API | Medium — if the field name differs (e.g. `image` repeated), the request 400s. Mitigation: verify against live API in Phase 5 E2E; QuantumNous mirror + community confirm `image[]`. |
| A2 | `gpt-image-1` returns `b64_json` by default (no `response_format` needed) | OpenAI Edits API | Low — if it returns `url`, parse `data.data[0].url` instead. Easy to adapt. |
| A3 | The user will supply `layers/shared/templates/infographic.png` before real generation | Templates dir | Low — stub mode unaffected; documented as a user dependency (D-00c). |
| A4 | `gpt-image-1` model name is correct/available on the account | OpenAI Edits API | Medium — current code already uses `gpt-image-1`; if account lacks access, generation 500s. Stub path unaffected. |

## Open Questions (RESOLVED)

1. **400 vs 500 for "no mold photo found"** (D-03 says 400)
   - Known: throwing in `generateImage` surfaces as 500 (caught at handler line 54-57).
   - RESOLVED: move photo-empty check into the handler body before `generateImage`, `respond(400, {error:'no mold photo found'})` — implemented in Plan 03-02 Task 2.

2. **Frontend `IMAGE_TYPES` (4 tiles) vs backend (1 type)**
   - Known: `ImagesView` renders 4 tiles/size; `computeStepStatus` uses `*4` → status shows partial.
   - RESOLVED: leave frontend as-is for Phase 3 (cosmetic, not a success criterion); deferred to Phase 4 per CONTEXT.md `<deferred>` section.

3. **Wave-0 test mode for template/photo reads**
   - Known: stub path returns before reading template/photos.
   - RESOLVED: Wave-0 tests run in stub mode (OPENAI_API_KEY unset); `buildEditRequest` exported for unit-testing prompt/image assembly without network or template file — implemented in Plan 03-01.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dall-e-2` edits: single RGBA PNG ≤4MB, requires mask | `gpt-image-1` edits: up to 16 images, PNG/JPG/WEBP ≤25MB, prompt-driven, no mask required | 2025 (gpt-image-1 GA) | Multi-image composition (bg + photos) in one call — enables D-00 architecture |
| `/v1/images/generations` (text→image) | `/v1/images/edits` (image→image) | this phase | Reference photo actually used (IMG-03) |

## Sources

### Primary (HIGH confidence)
- Codebase reads: `functions/step-images/index.js`, `functions/step-texts/index.js`, `functions/api/index.js`, `layers/shared/versionStore.js`, `layers/shared/templateEngine.js`, `frontend/PipelineApp.jsx`, `test/step-texts.test.js`, configs — all line numbers verified.
- Filesystem probes: templates dir absence, Node v22.22.1, package.json test script, config.json workflow flags.

### Secondary (MEDIUM confidence)
- https://github.com/QuantumNous/new-api-docs/blob/main/docs/en/api/openai-image.md — gpt-image-1 `image[]`, formats, b64_json default, size values.
- https://github.com/LazaUK/AIFoundry-GPT-image-1-Editing — multipart edit field structure, base64 response.
- https://github.com/openai/openai-node/issues/1844 — SDK `images.edit` rejected gpt-image-1 (rationale for raw fetch).

### Tertiary (LOW confidence)
- OpenAI community threads (multi-image edit timeouts, multiple-image-per-call) — corroborating, not authoritative.

## Metadata

**Confidence breakdown:**
- step-images bugs + line numbers: HIGH — direct codebase read.
- versionStore listArtifacts / photo path: HIGH — direct read, confirmed exported.
- IMAGE_TYPES location + dispatch: HIGH — direct read.
- Recursive pattern: HIGH — copied from working step-texts.
- UI button existence: HIGH — direct read, flow traced.
- OpenAI Edits API multi-image `image[]` + b64_json: MEDIUM — docs.openai.com returned 403; verified via community + QuantumNous mirror + WebSearch. Confirm in Phase 5 E2E with a live key.

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (stable codebase; OpenAI API surface moderately fast-moving — re-verify Edits multipart shape if not exercised by then)
