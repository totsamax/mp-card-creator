# Phase 5: E2E Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 5-E2E Validation
**Areas discussed:** AI-режим, Фикстура для теста, Сценарии покрытия

---

## AI-режим

| Option | Description | Selected |
|--------|-------------|----------|
| USE_STUB=true | Быстро, бесплатно, нет реального контента — проверяет структуру/прохождение | |
| Реальные AI-ключи | Настоящий OPENAI_API_KEY, реальные тексты и слайды | ✓ |
| E2E со stub + ручной проверкой качества | Авто-тест со stub, потом ручной прогон с реальными ключами | |

**User's choice:** Реальные AI-ключи
**Notes:** Дополнительно решено — проверяем структуру + контент: файлы существуют, PNG ненулевого размера, тексты без нераскрытых {{}} шаблонов, xlsx открывается без ошибок.

---

## Фикстура для теста

### Тип молда

| Option | Description | Selected |
|--------|-------------|----------|
| Лицевой молд (face) | Статья 0553 или новая. Полный шаблон — все поля faceSize, poraType, faceOval заполнены | ✓ |
| Другой тип молда (hands / shoe / other) | Проверяет универсальность moldType из Phase 1 | |

**User's choice:** Лицевой молд

### Фото молда

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder PNG (test/fixtures/) | ~1-5KB, быстро, E2E проверяет приём/сохранение фото | |
| Реальное фото молда | Настоящее фото, загружается через UI при ручном прогоне | ✓ |

**User's choice:** Реальное фото молда
**Notes:** Пользователь предоставляет фото перед запуском E2E. Для автоматического теста — предполагаем что фото лежит в test/fixtures/.

---

## Сценарии покрытия

### Что входит в E2E

| Option | Description | Selected |
|--------|-------------|----------|
| Happy path шаги 01→06 | Опросник → нормализация → тексты → изображения → excel → assemble. Проверка: все файлы есть, манифест в done | ✓ |
| Happy path + error recovery | После прохождения: сломать ключ, проверить ✘ → Повторить | |

**User's choice:** Happy path 01→06
**Notes:** Phase 4 уже проверяла error recovery вручную. Phase 5 фокусируется на прохождении до финального пакета.

### Формат прогона

| Option | Description | Selected |
|--------|-------------|----------|
| node:test E2E-скрипт | API-вызовы + polling статуса на node:test. npm test | ✓ |
| Руководство по ручному прогону | Step-by-step чек-лист: URL, кнопки, что проверить | |

**User's choice:** node:test E2E-скрипт

---

## Claude's Discretion

- Таймауты polling (02-texts ≈5 мин, 03-images ≈10 мин)
- Нужен ли отдельный `npm run test:e2e` или включить в основной `npm test`
- Структура ассертов после assemble (точный список файлов)
- Очистка output/ после теста

## Deferred Ideas

- step-video (kling.ai) — VID-01/VID-02
- Error recovery E2E-сценарий
- Yandex Cloud smoke-test
