# Phase 2: Working Texts Step - Research

**Researched:** 2026-06-16
**Domain:** Node.js serverless step handler — LLM text generation, rule-based critic loop, local recursive retry, manifest versioning
**Confidence:** HIGH (codebase-grounded; no external dependencies)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**DEC-01: Local retry через рекурсивный вызов handler'а**
- `enqueueRetry` в `step-texts` заменяется на прямой рекурсивный `await exports.handler(nextMessage)` — без YMQ.
- Рекурсия — только до `MAX_ATTEMPTS=3`.
- Scope fence: YMQ эмуляция вне scope (v2 DEV-01). Не трогать `step-images`, `step-video`.

**DEC-02: Контекст типа молда в промпте — через `{{topic}}` и `{{purpose}}`**
- В `prompts.texts.json` (user-template) добавить плейсхолдеры `{{topic}}` и `{{purpose}}`.
- В `step-texts` добавить их в цепочку `.replace()`.
- Substitution fix: добавить `{{topic}}`, `{{purpose}}`, `{{moldSize}}`; удалить `{{faceSize}}`.
- Scope fence: НЕ создавать отдельные JSON-файлы промптов per moldType. Менять только `prompts.texts.json` и substitution chain.

**DEC-03: Правила критика текстов**
- Расширить `prompts.critic-texts.json` двумя проверками, оставив существующие (длина, banned phrases).
  1. **topicKeywordCheck**: titleFull должен содержать хотя бы одно слово из `sizeRecord.topic` (динамическая проверка).
  2. **noUnresolvedPlaceholders**: annotation не должна содержать `{{...}}` (regex `/\{\{[^}]+\}\}/`).
- НЕ проверяем (scope fence): запрет слов неверного типа (решается через DEC-02 на генераторе), минимальную длину annotation, SEO-релевантность (v2).

### Claude's Discretion
- Точная реализация topicKeywordCheck (как именно разбивать topic на слова, нормализация регистра).
- Структура `attempts[]` log за пределами `{ attempt, criticVerdict }` (минимум зафиксирован).

### Deferred Ideas (OUT OF SCOPE)
- Минимальная длина для `annotation` — отложено до первого реального прогона.
- Запрет слов неверного типа в критике — решается через промпт (DEC-02), не критиком.
- YMQ-эмулятор (DEV-01) — v2.
- Исправление `faceSize` в `step-images` / `step-video` — Phase 3 / v2 (НЕ трогать в этой фазе).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TXT-01 | Генерируются тексты для всех 5 размеров (XS–XL) на основе мастер-данных и типа молда | `handleRegenerate` (api/index.js:366-368) уже фан-аутит на все 5 `SIZES` через `runLocally`. Каждый `size` пишет `{size}_texts.json`. Требуется проверить, что все 5 реально записываются (см. Pitfall 1 — version collision). |
| TXT-02 | Промпты учитывают тип молда — не упоминают «лицо» для рук | `sizeRecord.topic`/`.purpose` уже вычислены templateEngine'ом из `template.moldTypes[moldType]` (templateEngine.js:57-58, 133-134). Инъекция в промпт = DEC-02. Для `hands`: topic="Руки куклы, кисти рук", purpose="Для кукол...". |
| TXT-03 | Generator-critic loop работает локально (retry через прямой вызов handler'а) | Заменить `enqueueRetry` (step-texts/index.js:90, 221-239) на рекурсивный `return exports.handler(...)`. Паттерн прямого вызова — `runLocally` (api/index.js:56-73). |
</phase_requirements>

## Summary

Phase 2 — это **точечный bugfix + малая фича** в одном файле-хендлере (`functions/step-texts/index.js`) плюс два конфиг-файла. Никаких новых зависимостей, новых модулей или архитектурных решений не нужно. Вся инфраструктура (templateEngine, versionStore, runLocally fan-out, MAX_ATTEMPTS, attempts-log builder) уже на месте — фаза «дотягивает» три недоделки, оставленные в скелете.

Три изменения: (1) заменить no-op `enqueueRetry` на рекурсивный вызов хендлера с инкрементом `attempt`; (2) исправить устаревший `{{faceSize}}`-плейсхолдер на `{{moldSize}}` и добавить `{{topic}}`/`{{purpose}}` в цепочку подстановки и в `prompts.texts.json`; (3) добавить два правила в критик. Критическая тонкость, которую нужно проверить на этапе планирования: **`updateManifest` имеет сигнатуру `(article, stepId, patch)` — три аргумента**, а не двух-аргументную dotted-path форму `{ [`steps.02-texts.sizes.${size}...`]: true }`, как показано в черновике DEC-01. Этот черновик не сработает с реальным API versionStore — планировщик должен использовать настоящую сигнатуру.

**Primary recommendation:** Вносить изменения только в `functions/step-texts/index.js`, `layers/shared/config/prompts.texts.json`, `layers/shared/config/prompts.critic-texts.json`. Написать unit-тесты на хендлер с `USE_STUB=true` (детерминированный, без сети) для проверки рекурсии, attempts-log и подстановки. Использовать настоящую трёх-аргументную сигнатуру `updateManifest`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Генерация текстов (LLM call) | Step handler (`step-texts`) | AI API (Anthropic/OpenAI) | Хендлер stateless, читает/пишет через versionStore; LLM — внешний сервис с fallback на stub |
| Critic (rule-based проверки) | Step handler (`step-texts`, `runCritic`) | — | Чистая функция без I/O, не LLM (по дизайну для текстов — Claude Vision только для изображений) |
| Retry orchestration | Step handler (рекурсия) | — | Локально: прямой вызов `exports.handler`. В облаке: YMQ (вне scope) |
| Fan-out на 5 размеров | API router (`handleRegenerate` → `runLocally`) | — | Router решает, какие messages породить; хендлер обрабатывает один size за вызов |
| Хранение артефактов + манифест | versionStore (адаптер) | FS / Yandex Cloud | Per-call adapter, без глобального состояния |
| Промпт-данные (topic/purpose) | templateEngine (Phase 1, готово) | template.master.json | Вычислено заранее, лежит в `master-data.json`; step-texts только читает |

**Граница фазы:** `step-texts` — единственный tier, который меняется. `runLocally` уже корректно передаёт `{ article, size, attempt: 1, force }` — рекурсия живёт внутри хендлера, router не трогаем.

## Standard Stack

Фаза не вводит новых пакетов. Весь стек уже установлен и используется.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | builtin (Node 22.22.1) | Тест-раннер для unit-тестов хендлера | Уже используется (`test/*.test.js`); zero-dep, project convention из Phase 1 |
| `node:assert` | builtin | Ассерты в тестах | Парный с `node:test` |
| `node:crypto` | builtin | `sha256` для inputHash | Уже импортирован в step-texts |
| built-in `fetch` | builtin (Node 18+) | LLM API-вызовы | Уже используется; проект на Node 22 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| — | — | — | Новых не требуется |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Рекурсивный `exports.handler` | Цикл `while (attempt <= MAX)` внутри одного вызова | Цикл проще читать, но CONTEXT DEC-01 явно фиксирует рекурсию (паттерн консистентен с message-shape). Следовать DEC-01. |
| `node:test` | Внешний раннер (jest/vitest) | Запрещено: проект без доп. зависимостей, Phase 1 уже выбрал `node:test`. |

**Installation:** Не требуется — все зависимости уже в `package.json` / встроены в Node.

**Version verification:** Node.js v22.22.1 подтверждён (`node --version`). `node --test` с glob-паттерном `'test/**/*.test.js'` работает (зафиксировано в STATE.md: "node --test requires glob pattern (not directory)"). Новые пакеты не добавляются.

## Package Legitimacy Audit

> Фаза не устанавливает внешних пакетов. Все используемые модули — встроенные в Node.js (`node:test`, `node:assert`, `node:crypto`, `fetch`) или уже присутствуют в `package.json` с момента Phase 1.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | Фаза не ставит пакетов |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram (текущий поток step-texts)

```
POST /lines/:id/steps/02-texts/regenerate
        │
        ▼
  api/index.js: handleRegenerate
        │  item? [item] : SIZES  → messages[5] = { article, size, attempt:1, force }
        ▼
  queueUrl присутствует? ──нет(локально)──► runLocally('02-texts', messages)
        │ да                                       │
        ▼                                          ▼ (fire-and-forget, последовательно)
   sendBatch→YMQ                           for msg of messages:
   (вне scope)                                 await step-texts.handler({ body: JSON.stringify(msg) })
                                                     │
                                                     ▼
                            ┌──────── step-texts/index.js: exports.handler ────────┐
                            │ 1. parseMessage → { article, size, attempt, feedback}│
                            │ 2. getManifest → master-data.json → find sizeRecord  │
                            │ 3. cache check (attempt===1 && !force)               │
                            │ 4. generateTexts(sizeRecord, feedback)  [LLM/stub]   │
                            │ 5. runCritic(generated) → { ok, issues }             │
                            │                                                      │
                            │ 6a. ok || attempt>=MAX → putArtifact {size}_texts.json│
                            │     + updateManifest(article, '02-texts', {history})  │
                            │ 6b. !ok && attempt<MAX → ★ВМЕСТО enqueueRetry★:       │
                            │     return exports.handler({...msg, attempt+1,        │
                            │            feedback: criticVerdict.issues})  ◄─рекурсия│
                            └──────────────────────────────────────────────────────┘
```

### Recommended Project Structure
Без изменений. Затрагиваемые файлы:
```
functions/step-texts/index.js          # ★ главные правки (рекурсия, substitution, моменты ниже)
layers/shared/config/prompts.texts.json # + {{topic}} {{purpose}}; {{moldSize}} уже есть
layers/shared/config/prompts.critic-texts.json # + topicKeywordCheck, noUnresolvedPlaceholders
test/step-texts.test.js                 # ★ НОВЫЙ unit-тест (Wave 0 gap)
```

### Pattern 1: Рекурсивный локальный retry (DEC-01)
**What:** Заменить блок «critic rejected → enqueueRetry → respond(202)» на прямой рекурсивный вызов.
**When to use:** `!criticVerdict.ok && attempt < MAX_ATTEMPTS`.
**Example:**
```js
// Source: codebase — step-texts/index.js:89-91 (current), runLocally pattern api/index.js:56-73
// CURRENT (no-op locally):
//   await enqueueRetry({ article, size, attempt: attempt + 1, feedback: criticVerdict.issues, force });
//   return respond(202, { queued: true, ... });

// REPLACEMENT:
if (!criticVerdict.ok && attempt < MAX_ATTEMPTS) {
  // Direct recursion — no YMQ. Pass accumulated feedback.
  return exports.handler({
    body: JSON.stringify({
      article, size,
      attempt: attempt + 1,
      feedback: criticVerdict.issues,
      force,           // keep force so cache check on attempt>1 is bypassed (it already is: cache only on attempt===1)
    }),
  });
}
```
**Важно:** `exports.handler` принимает *event* (`{ body }`), не голое сообщение. `parseMessage` ожидает `event.body` (string) либо `event.messages`. Передавать `{ body: JSON.stringify(msg) }`, как делает `runLocally`. Передача голого объекта-сообщения сломает `parseMessage` (вернёт `null` → respond(400)).

### Pattern 2: Substitution chain fix (DEC-02 + BUG-01)
**What:** В `generateTexts` убрать `{{faceSize}}` (поля нет в sizeRecord), добавить `{{moldSize}}`, `{{topic}}`, `{{purpose}}`.
**Example:**
```js
// Source: codebase — step-texts/index.js:106-115, sizeRecord fields from templateEngine.js:117-135
const userPrompt = promptsTmpl.generate.user
  .replace('{{moldName}}',      sizeRecord.moldName)
  .replace('{{theme}}',         sizeRecord.theme)
  .replace('{{moldSize}}',      sizeRecord.moldSize)   // ★ was {{faceSize}}/sizeRecord.faceSize (undefined)
  .replace('{{moldLength}}',    sizeRecord.moldLength)
  .replace('{{moldWidth}}',     sizeRecord.moldWidth)
  .replace('{{moldHeight}}',    sizeRecord.moldHeight)
  .replace('{{color}}',         sizeRecord.color)
  .replace('{{brand}}',         sizeRecord.brand)
  .replace('{{topic}}',         sizeRecord.topic)      // ★ new
  .replace('{{purpose}}',       sizeRecord.purpose)    // ★ new
  .replace('{{feedbackBlock}}', feedbackBlock);
```
**Подтверждённые поля `sizeRecord`** (templateEngine.js:117-135): `size, moldSize, moldLength, moldWidth, moldHeight, moldWeight` (из physicalRow), `moldName, article, brand, theme, color, priceBaseM, moldType, weightPacked, priceBase, priceDiscount, toyFrom, toyTo, titleShort, titleFull, annotation`, все `static` поля, и `topic`, `purpose`. **`faceSize` отсутствует** — текущий код подставляет `undefined`.

### Pattern 3: Динамический topicKeywordCheck в критике (DEC-03)
**What:** Критик должен получить `sizeRecord.topic` (или сам `sizeRecord`), чтобы проверить пересечение слов с `titleFull`. Текущий `runCritic(texts)` принимает только тексты — сигнатуру нужно расширить.
**Example:**
```js
// Source: codebase — step-texts/index.js:191-215 (current runCritic)
// Caller (handler) must pass topic: runCritic(generated, sizeRecord.topic)
function runCritic(texts, topic) {
  const issues = [];
  // ... existing length / requiredSubstrings / bannedPhrases checks unchanged ...

  // DEC-03 rule 1: topicKeywordCheck (dynamic)
  const tk = criticRules.topicKeywordCheck;
  if (tk?.enabled && topic) {
    const topicWords = topic.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 4);
    const fieldVal = (texts[tk.field] ?? '').toLowerCase();
    const hit = topicWords.some(w => fieldVal.includes(w));
    if (!hit) issues.push(tk.message);
  }

  // DEC-03 rule 2: noUnresolvedPlaceholders
  const np = criticRules.noUnresolvedPlaceholders;
  if (np?.enabled) {
    const re = new RegExp(np.pattern);
    if (re.test(texts[np.field] ?? '')) issues.push(np.message);
  }

  return { ok: issues.length === 0, issues };
}
```
**Дискреция (Claude's Discretion):** порог длины слова (`>= 4`) и сплит по `[\s,]+` — на усмотрение планировщика. Цель — не падать на коротких служебных словах ("для", "и").

### Anti-Patterns to Avoid
- **Передача голого message-объекта в `exports.handler`:** хендлер ждёт `event` с `body`-строкой. Всегда оборачивать: `{ body: JSON.stringify(msg) }`.
- **Использование dotted-path patch `{ ['steps.02-texts...']: true }`:** versionStore `updateManifest(article, stepId, patch)` делает `deepMerge(existing, patch)` внутри `manifest.steps[stepId]` — patch это объект полей стэп-меты, НЕ dotted-путь от корня. Черновик DEC-01 здесь неточен.
- **Перезапись `attempts[]` вместо накопления:** `deepMerge` заменяет массивы целиком (versionStore.js:254). `buildAttemptsLog` уже корректно читает предыдущие attempts и конкатенирует — использовать его, не писать `attempts` напрямую без накопления.
- **Создание per-moldType JSON-файлов промптов:** прямо запрещено DEC-02 scope fence.
- **Трогать `step-images`/`step-video` faceSize-баги:** вне scope (Phase 3 / v2), хотя они есть (см. State of the Art).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Накопление attempts-лога | Ручная конкатенация в хендлере | `buildAttemptsLog(stepMeta, attempt, criticVerdict)` (step-texts:260-263) | Уже читает prev attempts из последней history-записи и конкатенирует |
| Read-merge-write манифеста | Прямое чтение/запись manifest.json | `store.updateManifest(article, stepId, patch)` | deepMerge + адаптерный fallback бесплатно |
| Подстановка `{{token}}` | Регулярка в хендлере | Существующая `.replace()` chain (точечная) ИЛИ `renderText` из templateEngine | Цепочка `.replace` — текущая конвенция step-texts; не вводить новый механизм без нужды |
| Fallback при отсутствии LLM-ключей | Свой stub | Существующий `templateTexts(sizeRecord)` + `USE_STUB=true` | Детерминированный путь для тестов уже есть |

**Key insight:** Phase 2 — это «доделать скелет», а не строить новое. Почти весь требуемый код уже написан в виде заглушек или существующих хелперов; задача — соединить их правильно.

## Runtime State Inventory

> Эта фаза — bugfix хендлера + конфиги, не rename/migration. Но затрагивает данные, читаемые из существующего хранилища — фиксирую явно.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `master-data.json` в `output/{article}/01-normalize/v{N}/` — содержит `topic`/`purpose` (записаны Phase 1). step-texts читает их. | None — данные уже корректны. Если статья создавалась ДО Phase 1, перегенерировать 01-normalize. |
| Stored data | `output/{article}/02-texts/v{N}/{size}_texts.json` — старые версии с нераскрытым `{{faceSize}}` могут существовать. | None обязательного — новые версии перезапишут (version bump). Можно очистить `test/tmp-output/` для чистых тестов. |
| Live service config | None — локальный режим, без внешних сервисов в scope. | None |
| OS-registered state | None. | None — verified: нет cron/scheduler/pm2 в проекте. |
| Secrets/env vars | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (LLM), `USE_STUB`, `YMQ_TEXTS_QUEUE_URL` (читается, но в локали отсутствует → рекурсия). Имена не меняются. | None — только чтение существующих имён. |
| Build artifacts | None — нет компиляции/egg-info. | None |

**Канонический вопрос:** после правки хендлера, какие runtime-системы держат старое поведение? — Только старые `{size}_texts.json` артефакты, которые перезапишутся новой версией при следующем запуске. Persistent retry-state отсутствует (локально рекурсия синхронна в одном процессе).

## Common Pitfalls

### Pitfall 1: Version collision при fan-out на 5 размеров
**What goes wrong:** `runLocally` запускает 5 хендлеров **последовательно** (`for...of` с `await`), но каждый вычисляет `nextVersion = (stepMeta?.currentVersion ?? 0) + 1` из манифеста, прочитанного в начале своего вызова. Поскольку вызовы последовательны и каждый делает `updateManifest`, второй size прочитает обновлённый `currentVersion` — версии должны инкрементироваться 1,2,3,4,5. Но **все 5 `{size}_texts.json` окажутся в РАЗНЫХ версиях-папках** (`v1/XS_texts.json`, `v2/S_texts.json`...), а не вместе.
**Why it happens:** version bump на каждый size, а не на «прогон шага». `handleGetArtifact` это учитывает (ищет version из history по `{size}_texts.json`), так что чтение работает. Но Success Criterion 2 («все 5 получают файлы в output/») выполняется — просто разнесено по версиям.
**How to avoid:** Не «чинить» это в Phase 2 (вне scope, текущее поведение консистентно с `handleGetArtifact`). Тест проверять через `listArtifacts` по правильной версии каждого size ИЛИ через факт существования файла в любой версии. НЕ ассертить, что все 5 в одной папке.
**Warning signs:** Тест ищет `v1/XL_texts.json` и не находит — потому что XL в `v5/`.

### Pitfall 2: `runLocally` — fire-and-forget, await не доходит до теста
**What goes wrong:** `runLocally` запускает IIFE и НЕ возвращает её промис (`(async()=>{...})().catch()`), а `handleRegenerate` сразу отвечает 202. В unit-тесте через API нельзя дождаться завершения генерации.
**Why it happens:** Дизайн async-шагов (fire-and-forget, прогресс через манифест).
**How to avoid:** Тестировать **`step-texts.handler` напрямую**, не через `api`/`runLocally`. Вызвать `await handler({ body: JSON.stringify({ article, size, attempt:1 }) })` — он синхронно-await'ится. Это и есть рекомендуемый паттерн unit-теста.
**Warning signs:** Флэйки-тест, манифест пустой сразу после 202.

### Pitfall 3: `updateManifest` сигнатура — 3 аргумента, не dotted-path
**What goes wrong:** Черновик DEC-01 показывает `store.updateManifest(article, { ['steps.02-texts.sizes.${size}.needsReview']: true })` — это **двух-аргументный** вызов с dotted-ключом. Реальный API: `updateManifest(article, stepId, patch)`, где `patch` мержится в `manifest.steps[stepId]`. Двух-арг вызов положит `patch` как `stepId` (строка) → бросит/исказит.
**Why it happens:** Черновик контекста писался по памяти, не по сигнатуре.
**How to avoid:** Использовать настоящую сигнатуру. needsReview уже пишется внутри `historyEntry` (step-texts:77) и в payload артефакта (step-texts:65) при исчерпании попыток — отдельный updateManifest для needsReview **не нужен**, текущий код при `attempt >= MAX_ATTEMPTS` уже сохраняет `needsReview: true`. Планировщик должен убедиться, что рекурсия НЕ ломает существующую save-ветку (она срабатывает когда `attempt >= MAX`).
**Warning signs:** `TypeError`/искажённый манифест; `needsReview` не появляется.

### Pitfall 4: feedback не накапливается между попытками
**What goes wrong:** При рекурсии передаётся `feedback: criticVerdict.issues` — это issues **только последней** попытки, что корректно для промпта. Но `attempts[]` должен хранить verdict **каждой** попытки.
**Why it happens:** `attempts` пишется только в финальной save-ветке (`ok || attempt>=MAX`). На промежуточных (rejected) попытках artifact/manifest НЕ пишутся — значит attempts промежуточных попыток теряются, если `buildAttemptsLog` читает из `stepMeta.history` (которая не обновлялась между рекурсиями).
**How to avoid:** Передавать накопленный лог попыток через message ИЛИ собирать attempts по ходу рекурсии. Простейшее: добавить в message поле `attemptsLog` и аккумулировать его при каждом рекурсивном вызове, затем писать в финальной ветке. **Это ключевой момент для Success Criterion 4** («манифест содержит attempts[] с verdict каждой попытки»). Текущий `buildAttemptsLog` читает только `stepMeta.history.slice(-1)` — между рекурсиями history не меняется, поэтому без аккумуляции в манифест попадёт только 1 attempt.
**Warning signs:** После 3 отклонённых попыток `attempts[]` в манифесте содержит 1 запись, а не 3.

### Pitfall 5: cache check на attempt=1 может пропустить регенерацию
**What goes wrong:** При `attempt===1 && !force` и совпадении inputHash хендлер вернёт `skipped:true` без генерации. Но `inputHash = sha256({ sizeRecord, promptsTmpl })` — после изменения `prompts.texts.json` хеш изменится, кэш инвалидируется автоматически.
**How to avoid:** Тесты вызывать с `force: true` или на чистом `tmp-output`, чтобы избежать ложного skip. `handleRegenerate` дефолтит `force = body.force ?? true`, так что через API force включён.
**Warning signs:** Тест видит `{ skipped: true }` вместо текстов.

## Code Examples

### Тест хендлера с детерминированным stub (рекомендуемый Wave 0 паттерн)
```js
// Source: codebase test convention — test/create-line.smoke.test.js:1-11
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
process.env.USE_STUB = 'true';   // deterministic: templateTexts(sizeRecord), no network

// 1) create line via api so master-data.json exists (or putArtifact directly)
// 2) call step-texts handler directly:
const { handler } = require('../functions/step-texts/index.js');
const r = await handler({ body: JSON.stringify({ article: 'TXT01', size: 'M', attempt: 1, force: true }) });
const body = JSON.parse(r.body);
assert.strictEqual(r.statusCode, 200);
// assert texts present, no '{{' placeholders, manifest attempts length, etc.
```

### prompts.texts.json — добавление контекста типа (DEC-02)
```jsonc
// Source: codebase — layers/shared/config/prompts.texts.json:4 (user block)
// добавить в "Данные товара" две строки:
"- Тема товара: {{topic}}\n- Назначение: {{purpose}}\n"
// {{moldSize}} УЖЕ присутствует в шаблоне (line 4: "Характерный размер молда: {{moldSize}} см")
// — баг был в КОДЕ (replace '{{faceSize}}'), не в шаблоне.
```

### prompts.critic-texts.json — новые правила (DEC-03)
```json
{
  "rules": [ /* ... unchanged length rules ... */ ],
  "requiredSubstrings": { /* unchanged */ },
  "bannedPhrases": [ /* unchanged */ ],
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
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `{{faceSize}}` плейсхолдер (face-only модель) | `{{moldSize}}` (universal mold) | Phase 1 (template.master.json уже на moldSize) | step-texts код отстал от template/schema — BUG-01 |
| `enqueueRetry` → YMQ | Локальный рекурсивный вызов | Phase 2 (эта фаза) | retry реально работает локально |
| Статичный critic | + динамический topicKeyword + placeholder-guard | Phase 2 | критик ловит type-несоответствие косвенно |

**Deprecated/outdated (НЕ трогать в Phase 2 — для справки):**
- `step-images/index.js:113` и `step-video/index.js:263` всё ещё используют `{{faceSize}}`/`sizeRecord.faceSize` (тот же баг). Phase 3 / v2 scope — оставить как есть.
- `prompts.images.json` использует `{{faceSize}}` в 3 местах — Phase 3.
- `enqueueRetry` в `step-images` так же no-ops без YMQ — STATE.md фиксирует фикс «в Phase 2», но CONTEXT DEC-01 scope fence явно говорит **не трогать step-images** в этой фазе. Следовать CONTEXT (приоритетнее STATE).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `runLocally` гарантирует последовательность версий 1..5 для 5 размеров (await в for-of) | Pitfall 1 | LOW — даже при разнесённых версиях Success Criterion 2 («файлы существуют») выполняется; чтение через handleGetArtifact работает |
| A2 | needsReview уже корректно пишется при `attempt>=MAX` без отдельного updateManifest | Pitfall 3 | MEDIUM — если планировщик добавит лишний updateManifest по черновику DEC-01, сломает манифест. Митигировано явным указанием сигнатуры |
| A3 | Порог длины слова `>=4` и сплит `[\s,]+` для topicKeywordCheck — разумны для русского | Pattern 3 | LOW — Claude's Discretion; подстраивается тестом |

**Все остальные claims — VERIFIED против кодовой базы (grep/read в этой сессии).**

## Open Questions

1. **Аккумуляция attempts[] через рекурсию**
   - What we know: финальная save-ветка пишет attempts через `buildAttemptsLog`, который читает `stepMeta.history.slice(-1)`.
   - What's unclear: между рекурсивными вызовами history НЕ обновляется (artifact/manifest пишутся только в финале) → промежуточные verdict'ы потеряются, если их не пробросить.
   - Recommendation: добавить поле `attemptsLog` (или `prevAttempts`) в message, аккумулировать при каждом рекурсивном вызове, передать в финальную запись. Это прямое требование Success Criterion 4 — планировщик ОБЯЗАН решить это явно. (Альтернатива: писать промежуточный manifest-патч на каждой попытке — но это больше I/O.)

2. **Нужен ли `theme` ИЛИ `topic` в промпте (оба похожи)?**
   - What we know: `sizeRecord` имеет и `theme` (из опросника, напр. "Тест") и `topic` (из moldType, напр. "Руки куклы"). Текущий шаблон использует `{{theme}}`.
   - What's unclear: не дублируют ли они смысл для LLM.
   - Recommendation: оставить оба (DEC-02 явно добавляет topic/purpose). Они разные: theme=персонаж, topic=тип молда. Не убирать theme.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | весь хендлер + тесты | ✓ | v22.22.1 | — |
| `node:test` glob | unit-тесты | ✓ | builtin | — |
| ANTHROPIC_API_KEY | реальный LLM-вызов | ✗ (локально, не в репо) | — | `USE_STUB=true` → `templateTexts` (детерминированно) |
| OPENAI_API_KEY | fallback LLM | ✗ | — | stub |
| YMQ_TEXTS_QUEUE_URL | облачный retry | ✗ (by design) | — | **рекурсия (эта фаза)** |

**Missing dependencies with no fallback:** none — фаза проектируется работать со stub.
**Missing dependencies with fallback:** LLM-ключи → `USE_STUB=true`; YMQ → локальная рекурсия (и есть цель фазы).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin, Node 22.22.1) + `node:assert` |
| Config file | none — конвенция в `test/*.test.js`, env выставляется в начале каждого файла |
| Quick run command | `node --test 'test/step-texts.test.js'` |
| Full suite command | `npm test` (= `node --test 'test/**/*.test.js'`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TXT-02 | `moldType=hands` → texts без «лицо»/«личико»; `{{topic}}`/`{{purpose}}` раскрыты, нет `{{...}}` | unit | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 |
| TXT-01 | Все 5 размеров → `{size}_texts.json` существует (в своей версии) | unit | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 |
| TXT-03 | Critic `ok:false` → рекурсивный вызов, до 3 попыток; затем `needsReview:true` | unit (форсировать reject через banned phrase/short topic) | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 |
| TXT-03 | Манифест `history[].attempts[]` содержит запись на каждую попытку с criticVerdict | unit | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 |
| (regression) | Существующие A/B (templateEngine) и C (create-line) тесты остаются GREEN | unit | `npm test` | ✅ существуют |

**Как форсировать reject критика в тесте:** проще всего — временно подсунуть topic, которого нет в titleFull (topicKeywordCheck), или сгенерировать текст с banned phrase. Со stub'ом `templateTexts` возвращает шаблонные тексты — нужно либо мокнуть `runCritic`, либо подобрать вход, где `titleFull` не содержит слов topic. **Рекомендация:** написать узкий тест на `runCritic` (чистая функция) отдельно для правил DEC-03, и отдельный тест на рекурсию с инъекцией всегда-fail критика (например, через временный banned phrase, совпадающий со stub-текстом).

### Sampling Rate
- **Per task commit:** `node --test 'test/step-texts.test.js'`
- **Per wave merge:** `npm test` (полный набор — регрессия A/B/C)
- **Phase gate:** `npm test` зелёный перед `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/step-texts.test.js` — покрывает TXT-01/02/03 (рекурсия, substitution, attempts, 5 размеров)
- [ ] (опционально) узкий тест на `runCritic` как чистую функцию для DEC-03 правил
- [ ] Очистка `test/tmp-output/` между прогонами (или уникальные article-ID на тест) во избежание cache-skip
- [ ] Framework install: не требуется (`node:test` builtin)

## Security Domain

> `security_enforcement: true`, ASVS level 1. Фаза — внутренний bugfix без новых точек входа.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Инструмент для одной команды, auth вне scope (Out of Scope) |
| V3 Session Management | no | Нет сессий |
| V4 Access Control | no | Нет |
| V5 Input Validation | yes | `article` валидируется в api (`/^[a-zA-Z0-9_-]{1,64}$/`); `size` приходит из контролируемого `SIZES`; message парсится try/catch → 400 |
| V6 Cryptography | no | `sha256` только для cache-хеша (не секрет) |

### Known Threat Patterns for Node.js step handler

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Бесконечная рекурсия (DoS) | Denial of Service | Жёсткий guard `attempt < MAX_ATTEMPTS` (=3); рекурсия завершается финальной save-веткой. **Критично проверить тестом** что рекурсия терминируется. |
| Prompt injection через questionnaire-поля (moldName/theme) | Tampering | LOW риск (внутренний инструмент, один пользователь). Не вводить новых санитайзеров — вне scope. |
| LLM-ответ не-JSON | Tampering/availability | Уже обработано: `match(/\{[\s\S]*\}/)` + try/catch → fallback на stub |
| Unhandled exception в рекурсии роняет fire-and-forget | DoS | `runLocally` оборачивает в try/catch (api:65-71); хендлер — top-level try в generate. Сохранить инвариант. |

**Главный security-момент фазы:** гарантировать терминацию рекурсии (guard `attempt < MAX_ATTEMPTS`). Тест на «после 3 попыток — стоп, needsReview:true» закрывает и функциональное требование, и DoS-вектор.

## Sources

### Primary (HIGH confidence)
- `functions/step-texts/index.js` (read full) — хендлер, enqueueRetry, runCritic, buildAttemptsLog, substitution chain
- `functions/api/index.js` (read full) — runLocally, handleRegenerate fan-out, STEP_QUEUES
- `layers/shared/versionStore.js` (read full) — updateManifest(article, stepId, patch) signature, deepMerge (arrays replaced)
- `layers/shared/templateEngine.js` (read full) — sizeRecord fields incl. topic/purpose; нет faceSize
- `layers/shared/config/template.master.json` — moldTypes.{face,hands,shoes,other}.topic/purpose
- `layers/shared/config/prompts.texts.json` / `prompts.critic-texts.json` — текущие шаблоны/правила
- `test/create-line.smoke.test.js`, `test/templateEngine.test.js` — тест-конвенция (node:test, env setup)
- `input/questionnaire.schema.json` — поля moldType/theme/color/brand/sizes
- `.planning/config.json` — nyquist_validation:true, security_enforcement:true (ASVS L1)
- grep `faceSize` — подтверждён баг в step-texts/images/video + column-maps
- `node --version` → v22.22.1

### Secondary (MEDIUM confidence)
- none (фаза целиком grounded в кодовой базе)

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — нет новых пакетов, всё builtin/существующее
- Architecture: HIGH — все потоки прочитаны напрямую в коде
- Pitfalls: HIGH — выведены из реальных сигнатур (updateManifest, runLocally, buildAttemptsLog, deepMerge)
- attempts[] аккумуляция: MEDIUM — требует решения планировщика (Open Question 1)

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (стабильная кодовая база, без внешних быстро-меняющихся зависимостей)
