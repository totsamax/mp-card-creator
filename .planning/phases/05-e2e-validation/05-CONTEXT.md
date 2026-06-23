# Phase 5: E2E Validation - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Впервые запустить полный пайплайн конец-в-конец с реальными AI-ключами и убедиться, что система работает как целое. Вход: реальный опросник (лицевой молд) + настоящее фото молда. Выход: полный пакет артефактов в output/ (master-data.json, тексты для 5 размеров, слайды, ozon.xlsx, wb.xlsx). Формат: автоматизированный node:test E2E-скрипт покрывает happy path шагов 01→06 и завершается с exit 0.

**Не входит в Phase 5:** step-video/kling.ai (VID-01/VID-02 — v2), error recovery сценарии (Phase 4 уже проверила ✘-состояние), Yandex Cloud (STORE_ADAPTER=local).

</domain>

<decisions>
## Implementation Decisions

### AI-режим
- **D-01:** E2E прогон использует настоящий OPENAI_API_KEY — реальные вызовы к OpenAI API. Не USE_STUB=true.
- **D-02:** Проверяем структуру + контент: файлы существуют + PNG ненулевого размера + тексты не содержат нераскрытых `{{}}` шаблонов + xlsx открывается без ошибок (exceljs readFile).

### Фикстура для теста
- **D-03:** Тип молда: `face` (лицевой). Опросник построен под template.master.json с полями faceSize, poraType, faceOval.
- **D-04:** Фото молда: реальное фото, загружается через API как часть POST /lines (multipart). Фото предоставляет пользователь перед запуском E2E.
- **D-05:** Статья для E2E: новая уникальная статья (например, `e2e-test-YYYYMMDD`) — не перезаписывать 0553.

### Формат E2E прогона
- **D-06:** node:test E2E-скрипт в `test/e2e.test.js`. Запускается через `npm test` вместе с unit-тестами (или отдельным npm script `npm run test:e2e`).
- **D-07:** Скрипт поднимает API-сервер (`infra/local-server.js`) перед тестом и убивает после. Или предполагает, что сервер уже запущен (проще).
- **D-08:** Happy path: POST /lines → 201 → POST /lines/:id/steps/01-normalize → 200 → POST /lines/:id/steps/02-texts/regenerate → 202 → (poll до done, таймаут 5 мин) → POST .../03-images/regenerate → 202 → (poll, таймаут 10 мин) → POST .../05-excel/regenerate → 200 → POST .../06-assemble/regenerate → 200 → проверить output/.

### Claude's Discretion
- Таймауты polling (AI-генерация медленная — 02-texts до 3 мин на шаг, 03-images до 5 мин).
- Структура проверок: точный список файлов в output/{article}/ после assemble.
- Нужен ли отдельный `npm run test:e2e` или включить в основной `npm test`.
- Нужна ли очистка output/ после теста или оставить для осмотра.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pipeline архитектура
- `CLAUDE.md` — конвенции кода, API маршруты, структура versionStore, async-шаги
- `functions/api/index.js` — роутер: POST /lines, regenerate, GET /lines/:id/manifest
- `layers/shared/versionStore.js` — хранилище артефактов (local-режим для E2E)

### Существующие тесты (образцы)
- `test/create-line.smoke.test.js` — паттерн smoke-теста: POST /lines, проверка ответа
- `test/step-texts.test.js` — паттерн тестирования шага с USE_STUB
- `test/step-images.test.js` — паттерн для images-шага

### Конфиги шагов
- `layers/shared/config/template.master.json` — параметры лицевого молда (faceSize, poraType)
- `input/questionnaire.schema.json` — схема опросника для построения валидного тела POST /lines

### Требования
- `.planning/REQUIREMENTS.md` — REL-02 (E2E прогон без ручного вмешательства)
- `.planning/ROADMAP.md` — Phase 5 Success Criteria (3 критерия)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/create-line.smoke.test.js` — уже делает POST /lines с multipart FormData + фото; скопировать паттерн
- `test/fixtures/` — директория для тестовых файлов (существует, используется в smoke-тесте)
- node:test + встроенный fetch (Node 18+) — уже используется во всех тестах

### Established Patterns
- Polling манифеста: `GET /lines/:id/manifest` → `manifest.steps[stepId].status` (done / running / error)
- Fire-and-forget: async шаги (02-texts, 03-images) возвращают 202, результат — в манифесте
- STORE_ADAPTER=local + OUTPUT_DIR=./test/tmp-output — изоляция E2E от production output/

### Integration Points
- E2E-тест запускает живой API-сервер (infra/local-server.js) или ожидает что он уже запущен
- После шага 06-assemble: `output/{article}/` содержит все артефакты финального пакета

</code_context>

<specifics>
## Specific Ideas

- E2E-скрипт должен печатать прогресс в stdout: `[e2e] step 02-texts: polling... (30s)`, `[e2e] step 02-texts: done ✓`
- Timeout для async-шагов: 02-texts = 5 мин (5 размеров × ~1 мин OpenAI), 03-images = 10 мин (5 размеров × imagesEdits)
- После завершения: распечатать список созданных артефактов и их размеры

</specifics>

<deferred>
## Deferred Ideas

- step-video (kling.ai) — VID-01/VID-02, после стабильного E2E фаз 01–05
- Error recovery E2E-сценарий (сломать ключ → ✘ → Повторить) — Phase 4 уже проверила UI, E2E на это — отдельная задача после Phase 5
- Yandex Cloud smoke-test (STORE_ADAPTER=yandex-cloud) — после настройки prod-окружения

</deferred>

---

*Phase: 5-E2E Validation*
*Context gathered: 2026-06-23*
