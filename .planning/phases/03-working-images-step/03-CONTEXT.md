# Phase 3: Working Images Step - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

`step-images` генерирует PNG-слайды карточки товара для всех 5 размеров, используя фото молда как reference через OpenAI Images Edits API. UI предоставляет кнопку запуска. Изображения доступны через GET API.

**Не входит в Phase 3:** полное переподключение UI к API (Phase 4), типы слайдов кроме `infographic` (после MVP), step-video/kling.ai (v2).

</domain>

<decisions>
## Implementation Decisions

### Фото молда как reference-изображение (IMG-03)

- **D-01:** Использовать OpenAI `/v1/images/edits` (image-in-image), а не `/v1/images/generations`. Фото молда передаётся как `image[]` parameter в multipart FormData.
- **D-02:** Все загруженные фото (`questionnaire.photos[]`) передаются в edits API как контекстные изображения (не только первое).
- **D-03:** Если фото не загружено (нет artifacts в `photos` step) → step-images возвращает 400 `"no mold photo found"`. Фото обязательно (INP-01 уже требует его при создании линии).
- **D-04:** Если OPENAI_API_KEY отсутствует → stub (1×1 прозрачный PNG), как сейчас. Не менять stub-путь.

### Объём генерации (MVP)

- **D-05:** `IMAGE_TYPES = ['infographic']` в `functions/api/index.js` — изменить константу (не env-флаг). Итого: 5 вызовов OpenAI на запуск шага (1 тип × 5 размеров). Остальные типы (main, scale, lifestyle) — после MVP.
- **D-06:** `prompts.images.json` оставить с полными 4 типами промптов — только IMAGE_TYPES-константа сужает реальный запуск.

### Кнопка запуска в UI

- **D-07:** Добавить кнопку "Генерировать изображения" в секцию степпера `03-images` в `PipelineApp.jsx`. Нажатие делает `POST /lines/:id/steps/03-images/regenerate`. UI остаётся на хардкоде во всём остальном — Phase 4 убирает хардкод.
- **D-08:** Кнопка отображает статус ответа (202 → "запущено"). Не нужна сложная индикация прогресса — Phase 4 это сделает.

### Bugs (carry-forward из Phase 2)

- **D-09:** `{{faceSize}}` → `{{moldSize}}` в `generateImage` substitution chain (BUG аналогичен Phase 2 BUG-01). Применить к `functions/step-images/index.js`.
- **D-10:** `enqueueRetry` → рекурсивный `exports.handler({ body: JSON.stringify({...}) })` + `attemptsLog` accumulation (DEC-01 из Phase 2). Применить к `functions/step-images/index.js`.
- **D-11:** `buildAttemptsLog(stepMeta, attempt, criticVerdict)` → `[...attemptsLog, { attempt, criticVerdict }]` (inline spread, как в Phase 2).
- **D-12:** Добавить `{{topic}}` и `{{purpose}}` в промпт infographic в `prompts.images.json` — чтобы генерация учитывала тип молда.

### Claude's Discretion

- Конкретная реализация FormData multipart для edits API (Node.js built-in FormData или ручной boundary — исследовать в рамках plan-phase).
- Формат промпта для infographic после добавления `{{topic}}`/`{{purpose}}` — переформулировать на русский/сделать более конкретным.
- Обработка ANTHROPIC_API_KEY-critic: оставить как есть (принимает всё при отсутствии ключа) — не менять в Phase 3.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Шаг изображений
- `functions/step-images/index.js` — текущий handler: generateImage (text-only, {{faceSize}} bug, enqueueRetry no-op), runCritic (Claude Vision), buildAttemptsLog (broken pattern)
- `layers/shared/config/prompts.images.json` — промпты для 4 типов слайдов; infographic нужно обновить
- `layers/shared/config/prompts.critic-images.json` — конфиг Claude Vision критика; не менять в Phase 3

### Хранилище фото
- `functions/api/index.js` lines 205-223 — сохранение фото через `store.putArtifact(article, 'photos', 1, safeName, f.buffer)`, refs → `questionnaire.photos`
- `functions/api/index.js` lines 55-75 — `runLocally` + dispatch для 03-images: уже реализован, возвращает 202

### Phase 2 паттерны (применить аналогично)
- `.planning/phases/02-working-texts-step/02-CONTEXT.md` — DEC-01 (рекурсия), DEC-02 (faceSize→moldSize, topic/purpose), DEC-03 (attemptsLog)
- `functions/step-texts/index.js` — реализованный образец: recursive handler, attemptsLog accumulation, exports.handler wrapping

### Frontend
- `frontend/PipelineApp.jsx` — найти секцию степпера `03-images` (hardcoded stepper), добавить кнопку

### API routing
- `functions/api/index.js` lines 369-391 — dispatch step-03-images: `SIZES.flatMap(size => IMAGE_TYPES.map(...))` → `runLocally`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `functions/step-texts/index.js` — полный образец recursive retry + attemptsLog: скопировать паттерн в step-images
- `store.getArtifact(article, 'photos', 1, filename)` — читает фото молда; нужно получить список через `store.listArtifacts(article, 'photos', 1)` сначала
- `store.putArtifact` / `store.updateManifest` — стандартный save-branch; не менять
- Builtin `FormData` (Node.js 22) — для multipart edits API вызова

### Established Patterns
- Handler pattern: `parseMessage → load master data → cache check → generate → critic → save/retry` — сохранить структуру
- Stub path (`!apiKey → return Buffer.from(..., 'base64')`) — не менять, тесты используют его
- `respond(statusCode, body)` helper — уже есть в step-images

### Integration Points
- `functions/api/index.js` `IMAGE_TYPES` constant → изменить на `['infographic']`
- `functions/api/index.js` `STEP_QUEUES['03-images']` → уже есть; runLocally уже вызывает step-images handler
- `frontend/PipelineApp.jsx` → добавить кнопку в секцию 03-images степпера; использовать `apiFetch` для POST

</code_context>

<specifics>
## Specific Ideas

- Кнопка в UI: минимальная — только POST и показ "запущено/202". Без индикатора прогресса (Phase 4).
- edits API вызов: передать все фото из `questionnaire.photos` (не только первое) — пользователь может загрузить 2-3 ракурса молда.
- `{{faceSize}}` в `prompts.images.json` — заменить на `{{moldSize}}` во всех 4 шаблонах (даже если в MVP используется только infographic).

</specifics>

<deferred>
## Deferred Ideas

- Типы слайдов `main`, `scale`, `lifestyle` — после MVP (IMAGE_TYPES расширяется при добавлении)
- Индикатор прогресса в UI (polling манифеста) — Phase 4
- Critic для изображений (Claude Vision) — уже реализован, но требует ANTHROPIC_API_KEY; не менять в Phase 3
- Generator-critic loop для images — рекурсия добавляется (D-10), но тестирование через реальный critic — Phase 5 (E2E)

None — discussion stayed within phase scope

</deferred>

---

*Phase: 3-Working Images Step*
*Context gathered: 2026-06-16*
