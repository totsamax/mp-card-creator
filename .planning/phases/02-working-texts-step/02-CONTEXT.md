---
phase: 02
name: working-texts-step
status: context_ready
created: "2026-06-16"
---

# Phase 02: Working Texts Step — Context

## Phase Goal

Тексты для всех 5 размеров генерируются с учётом типа молда. Critic loop реально повторяет попытки локально — без YMQ.

## Requirements Covered

- TXT-01: Тексты для всех 5 размеров (XS–XL)
- TXT-02: Промпты учитывают moldType — не упоминают «лицо» когда молд для рук
- TXT-03: Generator-critic loop работает локально через прямой вызов handler'а

## Success Criteria (from ROADMAP.md)

1. Запуск шага 02-texts для статьи с `moldType=hands` генерирует тексты, не упоминающие «лицо»
2. Все 5 размеров (XS–XL) получают файлы `{size}_texts.json` в output/
3. Если критик отклонил текст (ok: false), handler вызывает себя повторно напрямую — без YMQ URL — до 3 попыток
4. Манифест содержит запись `attempts[]` с результатом каждой попытки (включая verdict критика)

---

## Decisions

### DEC-01: Local retry через рекурсивный вызов handler'а

**Decision:** `enqueueRetry` в `step-texts` заменяется на прямой рекурсивный `await exports.handler(nextMessage)` — без YMQ.

**Rationale:** В локальной среде YMQ_TEXTS_QUEUE_URL отсутствует. Текущий `enqueueRetry` молча no-ops (`console.log('[step-texts] would enqueue retry:', message)`). `maxAttempts=3` уже определён в коде. Паттерн `runLocally` в `api/index.js` показывает, что прямой вызов хэндлера — устоявшийся подход в этом проекте.

**Implementation:**
```js
// В step-texts/index.js, вместо enqueueRetry:
if (attempt < MAX_ATTEMPTS) {
  return exports.handler({ ...message, attempt: attempt + 1, feedback: criticResult.issues });
}
// Достигнут лимит попыток:
await store.updateManifest(article, { [`steps.02-texts.sizes.${size}.needsReview`]: true });
```

**Scope fence:** YMQ эмуляция — вне scope Phase 2 (v2 requirement DEV-01). Рекурсия — только до `MAX_ATTEMPTS=3`. Не трогать `step-images` и `step-video`.

---

### DEC-02: Контекст типа молда в промпте — через `{{topic}}` и `{{purpose}}`

**Decision:** В `prompts.texts.json` (user-template) добавить плейсхолдеры `{{topic}}` и `{{purpose}}`. В `step-texts` добавить их в цепочку `.replace()`.

**Rationale:** `topic` и `purpose` уже вычислены templateEngine'ом из `moldTypes[moldType]` и присутствуют в каждом `sizeRecord` (templateEngine.js lines 133–134). Это минимальная инъекция с максимальным контролем: LLM получает русскоязычное описание ("Руки куклы, кисти рук"), а не raw enum ("hands"). Отдельные промпты per moldType — излишняя сложность, не нужна.

**Template change** (в prompts.texts.json, в user-блок добавить строки):
```
- Тема товара: {{topic}}
- Назначение: {{purpose}}
```

**Substitution fix** (step-texts/index.js):
```js
.replace('{{topic}}',      sizeRecord.topic)
.replace('{{purpose}}',    sizeRecord.purpose)
.replace('{{moldSize}}',   sizeRecord.moldSize)   // faceSize→moldSize fix
// Удалить: .replace('{{faceSize}}', sizeRecord.faceSize)  ← баг из Phase 1
```

**Scope fence:** Не создавать отдельные JSON-файлы промптов per moldType. Менять только prompts.texts.json и step-texts substitution chain.

---

### DEC-03: Правила критика текстов

**Decision:** Расширить `prompts.critic-texts.json` двумя новыми проверками, оставив существующие (длина полей, banned phrases).

**New rules:**

1. **Ключевые слова темы в titleFull** — titleFull должен содержать хотя бы одно слово из `sizeRecord.topic` (динамическая проверка, не статика). Реализация: критик получает `topic` как параметр и проверяет пересечение слов.

2. **Аннотация без нераскрытых плейсхолдеров** — annotation не должна содержать `{{...}}`. Простая regex-проверка `/\{\{[^}]+\}\}/`.

**Что НЕ проверяем (scope fence):**
- Запрет слов неверного типа (e.g., "лицо" для hands) — решается через DEC-02 на уровне генератора, а не критика
- Минимальная длина annotation — пока не нужна
- SEO-оценка релевантности — v2 scope

**Config shape** (prompts.critic-texts.json additions):
```json
"topicKeywordCheck": {
  "enabled": true,
  "field": "titleFull",
  "message": "titleFull не содержит ключевых слов из темы товара"
},
"noUnresolvedPlaceholders": {
  "enabled": true,
  "field": "annotation",
  "pattern": "\\{\\{[^}]+\\}\\}",
  "message": "annotation содержит нераскрытый плейсхолдер"
}
```

---

## Existing Bugs to Fix in Phase 2

### BUG-01: `{{faceSize}}` в step-texts (не переименован в Phase 1)

**File:** `functions/step-texts/index.js:109`
```js
.replace('{{faceSize}}', sizeRecord.faceSize)  // ← устарело
```
`sizeRecord.faceSize` теперь `sizeRecord.moldSize`. Если не исправить — `{{faceSize}}` остаётся нераскрытым в промпте → LLM видит буквальный плейсхолдер.

**Fix:** Заменить строку на `.replace('{{moldSize}}', sizeRecord.moldSize)` и обновить `prompts.texts.json`.

---

## Codebase Assets (reusable)

| Asset | Location | Notes |
|-------|----------|-------|
| `enqueueRetry` (to replace) | `functions/step-texts/index.js` | Текущая no-op заглушка — заменить на рекурсию |
| `MAX_ATTEMPTS` const | `functions/step-texts/index.js` | Уже `3` — оставить |
| `sizeRecord.topic` / `.purpose` | computed in `templateEngine.js:133-134` | Уже в каждой записи masterData |
| `runLocally` pattern | `functions/api/index.js` | Аналог паттерна для прямого вызова handler'а |
| `prompts.texts.json` | `layers/shared/config/` | Добавить `{{topic}}` и `{{purpose}}` |
| `prompts.critic-texts.json` | `layers/shared/config/` | Добавить 2 новых правила |

## What NOT to Change in Phase 2

- `step-images`, `step-video`, `step-excel`, `step-assemble` — не трогать
- `versionStore` — не менять
- `templateEngine` — не менять (Phase 1 завершена)
- YMQ emulation — v2 scope

## Open Questions (deferred)

- Нужна ли минимальная длина для `annotation`? → Отложено до первого реального прогона
- Запрет слов неверного типа в критике — отложено (решается через промпт, DEC-02)
