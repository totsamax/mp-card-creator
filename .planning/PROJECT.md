# mp-card-creator

## What This Is

Агентный пайплайн генерации карточек товаров для силиконовых молдов (Ozon и Wildberries). Вход: опросник + фото молда и отливки. Выход: тексты на 5 размеров (XS–XL), инфографические слайды для карточки товара, Excel-выгрузки под формат маркетплейса.

Скелет пайплайна построен, 6 шагов реализованы, но E2E прогон ни разу не выполнялся — система не работает как целое.

## Core Value

Залил опросник + фото молда → получил готовый пакет для публикации на Ozon/WB.

## Requirements

### Validated

- ✓ Опросник → master-data (5 размеров) через templateEngine — existing
- ✓ versionStore с тремя режимами (local / yandex-cloud / cloud-with-fallback) — existing
- ✓ step-excel: генерация xlsx для Ozon и WB — existing
- ✓ step-assemble: сборка итогового пакета — existing
- ✓ React UI со степпером и формой опросника — existing (но отключён от API)
- ✓ Yandex Cloud: YDB + Object Storage — existing (с локальным фолбэком)

### Active

- [ ] Фото молда и отливки как обязательная часть опросника (без них нельзя генерировать слайды)
- [ ] template.master.json универсален для любого типа молда (лицо, руки, обувь, другие)
- [ ] Frontend подключён к живому API (убрать хардкод LINES/TEXTS/IMAGES/VIDEO в PipelineApp.jsx)
- [ ] step-images запускается и сохраняет изображения (сейчас шаг не стартует)
- [ ] Generator-critic цикл работает локально (сейчас enqueueRetry молча no-ops без YMQ URL)
- [ ] Ошибки шагов попадают в манифест (поле error) — UI видит разницу между "запущен", "упал", "готов"
- [ ] Полный E2E прогон: реальный опросник + фото → все 6 шагов → итоговый пакет

### Out of Scope

- YMQ (Yandex Message Queue) для локальной разработки — retry-цикл реализуем через прямой рекурсивный вызов хэндлера
- Видеошаг (step-video / kling.ai) — разблокируется после стабильного прохождения шагов 01–05
- Множественные шаблоны по типам молда (face.master.json, hands.master.json...) — один универсальный шаблон с полем `moldType` в опроснике

## Context

Проект начат как прототип агентного пайплайна под конкретную нишу (молды). Весь backend-код написан, но не отлажен в совокупности:

- Главный баг UI: в `frontend/PipelineApp.jsx` строки 73–190 — хардкодные константы LINES/MASTER_DATA/TEXTS/IMAGES/VIDEO. Всё что возвращает API — игнорируется.
- Шаг 03-images не запускается (ошибка роутинга или запуска).
- Retry-цикл критика в step-texts и step-images: при отсутствии YMQ URL вместо повтора пишет в лог и выходит.
- template.master.json содержит только параметры лицевых молдов (faceSize, poraType и т.д.); другие типы не описаны.
- Слайды для карточки делаются по фиксированному шаблону (структура слайдов есть, примеры есть) — контент генерируется AI на основе фото молда + мастер-данных.
- Фото молда и отливки должны приходить как часть опросника — это входные данные для step-images.

**Codebase map:** `.planning/codebase/` (создан 2026-06-15) — полное описание стека, архитектуры, конвенций, проблем.

## Constraints

- **Tech stack**: Node.js / CommonJS, React + Vite, без TypeScript — не менять
- **AI API**: OpenAI (тексты + изображения), Anthropic Claude Vision (критик), Kling.ai (видео)
- **Storage**: Yandex Cloud с локальным фолбэком — архитектура уже выбрана
- **Локальная разработка**: без YMQ — retry-циклы должны работать через прямой вызов хэндлера
- **Slide шаблон**: структура слайдов зафиксирована (есть примеры) — AI генерирует контент, не структуру

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Один универсальный template.master.json, не по типам молда | Меньше поддерживать, тип молда — параметр опросника | — Pending |
| Retry-цикл локально через рекурсивный вызов хэндлера, не YMQ | YMQ недоступен в dev, emulator не настроен | — Pending |
| Фото молда — часть опросника, не отдельный шаг | Нет смысла генерировать слайды без фото входных данных | — Pending |
| Начать с шагов 01–03 (normalize + texts + images) | Это core value; excel/assemble работают, video — позже | — Pending |

## Evolution

Этот документ обновляется при переходе между фазами и завершении milestone.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-15 after initialization*
