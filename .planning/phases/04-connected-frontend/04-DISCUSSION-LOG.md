# Phase 4: Connected Frontend - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 4-connected-frontend
**Areas discussed:** Опрос статуса, Статус ошибки, VersionPicker, Пустой список

---

## Опрос статуса шага (Polling)

| Option | Description | Selected |
|--------|-------------|----------|
| Авто-опрос каждые 5 с | Polling GET /lines/:id/manifest пока шаг running | |
| Кнопка «Обновить» | Только ручное обновление | |
| Авто-опрос + кнопка ручного обновления | Оба механизма | ✓ |

**User's choice:** Авто-опрос + кнопка ручного обновления
**Notes:** Автоматический polling пока шаг running, плюс кнопка для немедленного refresh

---

## Статус «упал» — отображение в UI

| Option | Description | Selected |
|--------|-------------|----------|
| Красный значок в степпере + сообщение внутри шага | computeStepStatus error → ✘ в nav, текст ошибки + кнопка «Повторить» в step view | ✓ |
| Красный значок в степпере только | Только в StepperNav, без деталей внутри | |

**User's choice:** Красный значок в степпере + сообщение внутри шага
**Notes:** Полный двухуровневый error UX

---

## VersionPicker — формат метки

| Option | Description | Selected |
|--------|-------------|----------|
| v{N} · {date} · {size_count} разм. | Максимум из доступных данных | ✓ |
| v{N} · {date} | Проще, без количества размеров | |

**User's choice:** v{N} · {date} · {size_count} разм.
**Notes:** Например «v2 · 20 июн · 5 разм.»

---

## Пустой список линеек

| Option | Description | Selected |
|--------|-------------|----------|
| Чистый empty state + CTA | «Линеек пока нет. Создайте первую →» | ✓ |
| Показывать хардкод как fallback | Если API вернул [] — показать LINES константу | |

**User's choice:** Чистый empty state + CTA
**Notes:** Полное удаление констант, честный empty state

---

## Claude's Discretion

- Точная частота polling (рекомендовано 5 сек)
- Loading скелетоны или spinner
- Форматирование ISO date → «20 июн»
- VideoView/ExcelView/AssembleView без данных — минимальный «не запущен» state
- Точный текст ошибок и empty states

## Deferred Ideas

- Polling через WebSocket/SSE — v2
- Полный ExcelView с реальным скачиванием — Phase 5
- VideoView с данными step-04 — VID-01/VID-02 v2
