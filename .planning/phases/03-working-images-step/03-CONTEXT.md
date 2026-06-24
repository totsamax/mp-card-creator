# Phase 3: Working Images Step - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning (updated with slide composition architecture)

<domain>
## Phase Boundary

`step-images` собирает PNG-слайды карточки товара: фон-шаблон + фото молда склеиваются через OpenAI Images Edits API, инструкция по компоновке — в `prompts.images.json`. Для MVP: только тип `infographic`, все 5 размеров. UI: кнопка запуска в степпере. Изображения доступны через GET API.

**Не входит в Phase 3:** полное переподключение UI к API (Phase 4), типы слайдов кроме `infographic` (после MVP), step-video/kling.ai (v2).

</domain>

<decisions>
## Implementation Decisions

### Архитектура слайда (ключевое)

- **D-00:** Итоговый слайд = фон-шаблон (статичный PNG) + фото молда (из versionStore) + инструкция компоновки (из prompts.images.json с подстановкой данных sizeRecord). Всё это отправляется в OpenAI `/v1/images/edits`. AI «склеивает» компоненты по инструкции.
- **D-00b:** `step-images` НЕ зависит от `step-texts`. Текстовые элементы на слайде (название, размеры) берутся из `sizeRecord` (master-data), а не из артефакта `02-texts`.
- **D-00c:** Фоновые шаблоны хранятся в `layers/shared/templates/` (файлы предоставляет пользователь). Для MVP нужен `infographic.png`. Если файл не найден → 500 с понятным сообщением.

### Фото молда как reference-изображение (IMG-03)

- **D-01:** Использовать OpenAI `/v1/images/edits`. `image[]` = [фон-шаблон, ...все фото молда]. `prompt` = инструкция компоновки из `prompts.images.json`.
- **D-02:** Все загруженные фото молда передаются (не только первое). Читать через `store.listArtifacts(article, 'photos', 1)` → `store.getArtifact` для каждого.
- **D-03:** Если фото не загружено → step-images возвращает 400 `"no mold photo found"`. Фото обязательно (INP-01 гарантирует это при создании линии).
- **D-04:** Если OPENAI_API_KEY отсутствует → stub (1×1 прозрачный PNG). Не менять stub-путь.

### Объём генерации (MVP)

- **D-05:** `IMAGE_TYPES = ['infographic']` в `functions/api/index.js` — изменить константу. Итого: 5 вызовов OpenAI (1 тип × 5 размеров). Остальные типы (main, scale, lifestyle) — после MVP.
- **D-06:** `prompts.images.json` оставить с 4 типами промптов — константа IMAGE_TYPES определяет что реально запускается.

### Кнопка запуска в UI

- **D-07:** Добавить кнопку "Генерировать изображения" в секцию степпера `03-images` в `PipelineApp.jsx`. Нажатие → `POST /lines/:id/steps/03-images/regenerate`. Остальной UI на хардкоде до Phase 4.
- **D-08:** Кнопка показывает 202 → "запущено". Без индикатора прогресса (Phase 4).

### Bugs (carry-forward из Phase 2)

- **D-09:** `{{faceSize}}` → `{{moldSize}}` в `generateImage` substitution chain + в `prompts.images.json`. Применить к `functions/step-images/index.js`.
- **D-10:** `enqueueRetry` → рекурсивный `exports.handler({ body: JSON.stringify({...}) })` + `attemptsLog` (DEC-01 из Phase 2). Применить к `functions/step-images/index.js`.
- **D-11:** `buildAttemptsLog(stepMeta, attempt, criticVerdict)` → `[...attemptsLog, { attempt, criticVerdict }]`.
- **D-12:** Добавить `{{topic}}` и `{{purpose}}` в промпт infographic — учёт типа молда в инструкции компоновки.

### Claude's Discretion

- Конкретная реализация FormData multipart для edits API (Node.js built-in `FormData` + `Blob` или ручной boundary).
- Формулировка промпта infographic как инструкции компоновки (после добавления topic/purpose и перехода от text-only к image-in-image).
- Обработка Claude Vision критика: оставить as-is (принимает всё без ANTHROPIC_API_KEY). Не менять в Phase 3.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Шаг изображений
- `functions/step-images/index.js` — текущий handler: generateImage (text-only, {{faceSize}} bug, enqueueRetry no-op, НЕТ чтения шаблонов), runCritic (Claude Vision), buildAttemptsLog (broken pattern)
- `layers/shared/config/prompts.images.json` — промпты для 4 типов слайдов; нужно переработать в инструкции компоновки
- `layers/shared/config/prompts.critic-images.json` — конфиг Claude Vision критика; не менять в Phase 3
- `layers/shared/templates/` — НОВАЯ директория; сюда пользователь положит `infographic.png` и другие фоны

### Хранилище фото
- `functions/api/index.js` lines 205-223 — сохранение фото через `store.putArtifact(article, 'photos', 1, safeName, f.buffer)`, refs → `questionnaire.photos`
- `functions/api/index.js` lines 55-75 — `runLocally` + dispatch для 03-images: уже реализован, возвращает 202

### Phase 2 паттерны (применить аналогично)
- `.planning/phases/02-working-texts-step/02-CONTEXT.md` — DEC-01 (рекурсия), DEC-02 (faceSize→moldSize, topic/purpose), DEC-03 (attemptsLog)
- `functions/step-texts/index.js` — реализованный образец: recursive handler, attemptsLog accumulation

### Frontend
- `frontend/PipelineApp.jsx` — секция степпера `03-images`, добавить кнопку

### API routing
- `functions/api/index.js` lines 369-391 — dispatch step-03-images: `SIZES.flatMap(size => IMAGE_TYPES.map(...))` → `runLocally`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `functions/step-texts/index.js` — образец recursive retry + attemptsLog: скопировать паттерн
- `store.listArtifacts(article, 'photos', 1)` — получить список имён фото (нужно добавить, если нет)
- `store.getArtifact(article, 'photos', 1, filename)` — читает фото молда как Buffer
- `store.putArtifact` / `store.updateManifest` — стандартный save-branch
- `Node.js built-in FormData` + `Blob` (Node 18+) — для multipart edits API

### Established Patterns
- Handler pattern: `parseMessage → load master data → cache check → generate → critic → save/retry`
- Stub path (`!apiKey → return Buffer.from(..., 'base64')`) — сохранить
- `respond(statusCode, body)` helper — уже есть

### Integration Points
- `functions/api/index.js` `IMAGE_TYPES` → изменить на `['infographic']`
- `layers/shared/templates/infographic.png` → читать через `fs.readFileSync` при запуске generateImage
- `frontend/PipelineApp.jsx` → кнопка в секции 03-images, `apiFetch` для POST

</code_context>

<specifics>
## Specific Ideas

- Фоновые шаблоны: `layers/shared/templates/{imageType}.png`. Для MVP нужен `infographic.png`.
- Edits API: `image[]` = [Buffer фона, Buffer фото1, Buffer фото2, ...]. Prompt = инструкция как расположить фото молда на фоне + какой текст (название, размеры) разместить.
- step-images НЕЗАВИСИМ от step-texts: текстовые данные берёт напрямую из sizeRecord (moldName, moldSize, color и т.д.).
- Промпт инструкции компоновки должен явно описывать layout: где фото молда, где текстовые блоки, стиль оформления.

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
