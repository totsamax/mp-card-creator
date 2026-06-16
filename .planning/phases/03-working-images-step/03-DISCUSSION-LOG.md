# Phase 3: Working Images Step - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 3-working-images-step
**Areas discussed:** Фото молда как reference, Объём для MVP, Кнопка в UI

---

## Фото молда как reference (IMG-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Edits API (image-in-image) | POST /v1/images/edits: фото молда — image[], текст — prompt. OpenAI видит реальный молд и генерирует по нему. | ✓ |
| Generations + фото в промпте | Оставить /v1/images/generations, добавить описание фото в текст промпта | |

**User's choice:** Edits API (image-in-image)
**Notes:**
- Все загруженные фото передаются (не только первое)
- 400 если фото не найдено (фото обязательно — INP-01)
- Stub при отсутствии API key

---

## Объём генерации (MVP)

| Option | Description | Selected |
|--------|-------------|----------|
| 1 тип: infographic | 5 вызовов — один infographic на каждый размер (XS–XL). | ✓ |
| 2 типа: main + infographic | 10 вызовов | |
| Все 4 типа | 20 вызовов — main, infographic, scale, lifestyle | |

**User's choice:** 1 тип: infographic
**Notes:**
- Изменить константу `IMAGE_TYPES = ['infographic']` в api/index.js (не env-флаг)
- prompts.images.json оставить с 4 типами промптов

---

## Кнопка в UI

| Option | Description | Selected |
|--------|-------------|----------|
| Отдельная кнопка для 03-images | Добавить в степпер, POST regenerate, остальной UI на хардкоде до Phase 4 | ✓ |
| Перенести на Phase 4 | UI целиком Phase 4, проверять через curl | |
| В степпере 03-images | Рядом со статусом шага | ✓ |
| Отдельная панель | Секция "Генерация изображений" отдельно | |

**User's choice:** Кнопка в степпере 03-images
**Notes:** Только 202 статус, без индикатора прогресса. Phase 4 добирает остальное.

---

## Claude's Discretion

- Конкретная реализация FormData multipart для edits API (Node.js builtin vs. ручной boundary)
- Формулировка промпта infographic после добавления topic/purpose
- Обработка critic при отсутствии ANTHROPIC_API_KEY (оставить as-is)

## Deferred Ideas

- Типы слайдов main/scale/lifestyle — после MVP
- Индикатор прогресса через polling манифеста — Phase 4
- Generator-critic тестирование с реальным Claude Vision — Phase 5
