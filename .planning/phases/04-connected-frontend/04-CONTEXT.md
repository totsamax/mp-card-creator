# Phase 4: Connected Frontend - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Убрать все захардкоженные данные из `frontend/PipelineApp.jsx` (константы LINES, MASTER_DATA, TEXTS, IMAGES, VIDEO, VERSIONS, ASSEMBLE_TREE) и подключить UI к реальному API. Список линеек загружается из GET /lines. Манифест каждой линейки подгружается из GET /lines/:id/manifest. Статус шага читается из манифеста, включая state `'error'`. При падении шага бэкенд пишет `{ error, failedAt }` в манифест (REL-01).

**Не входит в Phase 4:** step-video подключение (VID-01/VID-02 — v2), экспорт xlsx через реальный API (ExcelView и AssembleView получают минимальный real-data view, полная функциональность — Phase 5), E2E прогон (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Опрос статуса (polling)

- **D-01:** После нажатия «Запустить шаг» (async steps 02-texts, 03-images) — автоматический опрос `GET /lines/:id/manifest` каждые 5 секунд пока шаг running. Дополнительно — кнопка ручного обновления «Обновить статус» для немедленного refresh. Polling останавливается когда manifest меняется (step больше не running).
- **D-02:** «Running» state: шаг помечается как running сразу после 202 (optimistic UI). Polling подтверждает или исправляет.

### Статус «упал» (error state)

- **D-03:** `computeStepStatus` получает новый state `'error'` — определяется по наличию `manifest.steps[stepId].error`.
- **D-04:** `STATE_INDICATOR` добавляет `error` → красный символ `✘` в StepperNav (аналогично существующим состояниям).
- **D-05:** Внутри степ-вьюхи — текст ошибки из `manifest.steps[stepId].error` + кнопка «Повторить».
- **D-06 (backend):** При падении шага обработчик (в try/catch) пишет в манифест `{ error: err.message, failedAt: new Date().toISOString() }` через `store.updateManifest`. Функции `runLocally` в `api/index.js` оборачиваются в try/catch с этим же поведением.

### VersionPicker из реального манифеста

- **D-07:** `VERSIONS` константа удаляется. VersionPicker получает версии из `manifest.steps[stepId].history[]`. Формат метки: `v{N} · {date} · {size_count} разм.` (date = `createdAt` в читаемом виде, size_count = уникальные sizes в history entries для этой версии).
- **D-08:** Если `manifest.steps[stepId]` отсутствует — VersionPicker показывает «Шаг ещё не запускался» + кнопка «Запустить шаг» (текущее поведение уже есть, сохранить).

### Пустой список линеек

- **D-09:** Если `GET /lines` вернул `{ lines: [] }` — пустой экран с CTA: «Линеек пока нет. Создайте первую →» (кнопка открывает QuestionnaireForm). Никакого fallback на LINES константу.

### Список линеек — загрузка и обновление

- **D-10:** При монтировании App — `apiFetch('/lines')` → `setLines(data.lines)`. На submit QuestionnaireForm (`submitQuestionnaire`) — после успешного ответа `POST /lines` добавляем новую линейку в state без reload страницы (UI-02).
- **D-11:** Для каждой открытой линейки manifest загружается при первом открытии через `GET /lines/:id/manifest`. Хранится в state `manifests[lineId]`. Обновляется polling'ом во время running шагов.

### VideoView и ExcelView

- **D-12 (Claude's Discretion):** VideoView убирает VIDEO константу → показывает пустой state «Видео: шаг не запущен» для каждого размера (шаг-04 не в scope Phase 4). ExcelView аналогично — убирает VERSIONS[line.id]?.excel fallback, показывает «Выгрузка не сформирована» если в manifest нет шага `05-excel`.

### AssembleView

- **D-13 (Claude's Discretion):** ASSEMBLE_TREE константа удаляется. AssembleView показывает summary из manifest: какие шаги завершены и их версии. Не пытается рендерить tree.

### Claude's Discretion

- Точная частота polling (5 сек рекомендовано, можно скорректировать по ощущению)
- Loading скелетоны или spinner при загрузке GET /lines
- Форматирование `createdAt` ISO → «20 июн» в VersionPicker
- Точный текст empty state и ошибок

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Frontend — основной файл
- `frontend/PipelineApp.jsx` — 100% изменений Phase 4; читать весь файл: константы LINES/MASTER_DATA/TEXTS/IMAGES/VIDEO/VERSIONS/ASSEMBLE_TREE (строки 86–229), apiFetch/submitQuestionnaire (11–31), NormalizeView/TextsView/ImagesView (317–471), computeStepStatus/STATE_INDICATOR/StepperNav (530–604), VersionPicker (262–295)

### Backend — API и манифест
- `functions/api/index.js` — GET /lines (строки 155–182 → `lineInfo` с `{ id, moldName, brand, sizes, steps }`), GET /lines/:id/manifest (114–117), runLocally fire-and-forget (55–75), regenerate endpoint (133–141)
- `layers/shared/versionStore.js` — `updateManifest` (read-merge-write pattern) — добавление `error`/`failedAt` должно идти через него

### Шаги для error handling (REL-01)
- `functions/step-texts/index.js` — верхний try/catch handler (строки 25–97); добавить updateManifest при catch
- `functions/step-images/index.js` — аналогично

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01, UI-02, UI-03, REL-01 (Frontend + Reliability секции)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apiFetch(path, opts)` (строка 11) — уже есть, использовать для всех GET/POST
- `submitQuestionnaire(questionnaire, photoFiles)` (строка 21) — уже работает, расширить чтобы результат добавлялся в список
- `VersionPicker` component (строка 262) — уже принимает `versions[]` и `onRegenerate`; просто поменять источник данных
- `computeStepStatus` (строка 530) — читает из manifest, добавить case `'error'`
- `STATE_INDICATOR` (строка 565) — добавить ключ `error`

### Established Patterns
- NormalizeView и TextsView уже содержат частичную API-интеграцию с fallback на мок — убрать fallback
- `manifests?.[lineId]` уже передаётся в StepperNav и step views — паттерн правильный, расширить на реальную загрузку
- ImagesView уже строит URL через `manifest.steps['03-images'].history` — образцовая реализация

### Integration Points
- `lines` state (сейчас `= LINES`) → `useState([])` + `useEffect` с `apiFetch('/lines')`
- `manifests` state (сейчас не определён как настоящий state) → `useState({})` + загрузка при выборе линейки
- polling: `useEffect` с `setInterval` при `runningSteps` > 0

</code_context>

<specifics>
## Specific Ideas

- Polling работает пока шаг running; останавливается когда manifest обновился
- «Авто-опрос + кнопка ручного обновления» — оба механизма нужны
- VersionPicker формат: `v{N} · {date} · {size_count} разм.`
- Empty state: «Линеек пока нет. Создайте первую →» с кнопкой открывающей форму

</specifics>

<deferred>
## Deferred Ideas

- Полный ExcelView с реальным скачиванием xlsx — Phase 5
- VideoView с реальными данными step-04 — VID-01/VID-02 (v2)
- Polling через WebSocket или SSE вместо setInterval — v2

</deferred>

---

*Phase: 4-Connected Frontend*
*Context gathered: 2026-06-21*
