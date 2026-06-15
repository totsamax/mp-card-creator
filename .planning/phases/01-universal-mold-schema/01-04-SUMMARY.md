---
phase: 01-universal-mold-schema
plan: "04"
subsystem: ui
tags: [frontend, react, formdata, multipart, moldtype, moldsize, file-upload, vite]

# Dependency graph
requires:
  - phase: 01-universal-mold-schema
    plan: "03"
    provides: [multipart POST /lines handler, busboy parsing in local-server.js, photo storage via versionStore]
provides:
  - QuestionnaireForm с select типа молда (face/hands/shoes/other)
  - file-input для фото молда (хранит File-объекты, не имена)
  - FormData multipart submit на POST /lines без ручного Content-Type
  - SIZE_DEFAULTS/SIZE_FIELDS переименованы на moldSize
  - Submit disabled пока не выбрано ≥1 фото
  - Форма отображается при activeTab='form' даже без созданных карточек
affects: [phase-02-working-texts, phase-04-connected-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FormData без ручного Content-Type — браузер выставляет boundary автоматически"
    - "File-объекты в state вместо имён файлов — реальные данные передаются в FormData"
    - "Отдельный fetch для multipart вместо apiFetch (который форсирует application/json)"

key-files:
  created: []
  modified:
    - frontend/PipelineApp.jsx

key-decisions:
  - "FormData отправляется напрямую через fetch(), минуя apiFetch — apiFetch ставит Content-Type: application/json, что ломает multipart boundary"
  - "photoFiles хранят File-объекты (не имена) — переданы в fd.append('photos', file, file.name) для корректной multipart-загрузки"
  - "Кнопка submit disabled при photoFiles.length === 0 — фото обязательно (INP-01)"
  - "activeTab='form' рендерит QuestionnaireForm независимо от наличия lines — исправлен баг, блокировавший E2E"

patterns-established:
  - "FormData pattern: new FormData(), fd.append('questionnaire', JSON.stringify(q)), fd.append('photos', file, file.name) в цикле"
  - "moldType select с дефолтом 'face' — без пустого значения, всегда валидный"

requirements-completed: [INP-01, INP-02]

# Metrics
duration: ~35min
completed: "2026-06-15"
---

# Phase 01 Plan 04: Questionnaire Form — moldType + Photo Upload Summary

**QuestionnaireForm получил select типа молда (Лицо/Руки/Обувь/Другое), file-input для фото (File-объекты), и FormData multipart submit на POST /lines — E2E вертикальный слайс Phase 1 завершён и подтверждён в браузере**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-15 (continuation agent)
- **Completed:** 2026-06-15
- **Tasks:** 3 (+ 1 bug fix)
- **Files modified:** 1

## Accomplishments

- `moldType` select (Лицо/Руки/Обувь/Другое) добавлен в форму — значение уходит в `questionnaire.moldType`
- `faceSize` переименован в `moldSize` в `SIZE_DEFAULTS` и `SIZE_FIELDS` (label «Размер, см»)
- `photoFiles` state хранит File-объекты; `<input type="file" multiple accept="image/*">` показывает счётчик
- FormData submit: `fd.append('questionnaire', JSON.stringify(q))` + `fd.append('photos', file, ...)` — без ручного `Content-Type`
- Кнопка «Сохранить» disabled пока `photoFiles.length === 0`
- Bug fix: форма рендерится при `activeTab='form'` даже когда `lines` пуст (раньше рендерился empty state)
- E2E проверен в браузере: создание карточки с `moldType=hands` + фото — работает, пользователь подтвердил «теперь ок»

## Task Commits

1. **Task 1: moldType select + moldSize rename + photo File-input** — `d1efb4a` (feat)
2. **Task 2: FormData multipart submit на POST /lines** — `db54e50` (feat)
3. **Task 3: Browser E2E** — checkpoint:human-verify, approved пользователем
4. **Fix: QuestionnaireForm visible when no lines exist** — `31bc380` (fix)

## Files Created/Modified

- `frontend/PipelineApp.jsx` — moldType select, photoFiles state, FormData submit, activeTab='form' fix

## Decisions Made

- FormData отправляется через отдельный `fetch()`, а не через `apiFetch` — `apiFetch` жёстко устанавливает `Content-Type: application/json`, что уничтожает boundary и делает multipart невалидным (Pitfall 5 из RESEARCH)
- `photoFiles` хранит `File`-объекты, а не имена — только объекты можно передать в `FormData.append()`
- Дефолт `moldType: 'face'` без пустой опции — select всегда валиден, не требует отдельной проверки

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Форма не рендерилась при отсутствии карточек**
- **Found during:** Task 3 (браузерная E2E проверка)
- **Issue:** Условие рендера QuestionnaireForm требовало наличия `lines.length > 0` или выбранной карточки. При первом открытии UI (lines пуст) форма не показывалась, пользователь не мог создать первую карточку
- **Fix:** Переработано условие: `activeTab === 'form'` рендерит `QuestionnaireForm` независимо от наличия lines
- **Files modified:** `frontend/PipelineApp.jsx`
- **Verification:** npm run build прошёл; в браузере форма открылась, карточка создана
- **Committed in:** `31bc380`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Баг блокировал E2E; исправление необходимо для корректной работы. Scope не расширен.

## Issues Encountered

None beyond the auto-fixed bug above.

## User Setup Required

None — изменения только во frontend, внешних сервисов не добавлялось.

## Next Phase Readiness

- Phase 1 полностью завершена: schema/templateEngine/multipart handler/форма — вертикальный слайс работает E2E
- Готово для Phase 2: step-02-texts может получить `moldType` из manifest и генерировать тексты под тип
- Блокеры, зафиксированные ранее в STATE.md, остаются актуальными для Phase 2+:
  - `enqueueRetry` в step-texts/step-images молча no-ops без YMQ URL — фиксируется в Phase 2
  - step-images ошибка роутинга/запуска — Phase 3

---
*Phase: 01-universal-mold-schema*
*Completed: 2026-06-15*
