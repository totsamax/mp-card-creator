# Phase 5: E2E Validation - Research

**Researched:** 2026-06-23
**Domain:** Node.js E2E integration testing (node:test), HTTP pipeline orchestration, polling async steps with real OpenAI calls
**Confidence:** HIGH (codebase is fully read; external API contracts cross-checked)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** E2E прогон использует настоящий `OPENAI_API_KEY` — реальные вызовы к OpenAI API. НЕ `USE_STUB=true`.
- **D-02:** Проверяем структуру + контент: файлы существуют + PNG ненулевого размера + тексты не содержат нераскрытых `{{}}` шаблонов + xlsx открывается без ошибок (exceljs readFile).
- **D-03:** Тип молда: `face` (лицевой). Опросник под `template.master.json` с полями faceSize/poraType/faceOval.
- **D-04:** Фото молда: реальное фото, загружается через API как часть POST /lines (multipart). Фото предоставляет пользователь перед запуском E2E.
- **D-05:** Статья для E2E: новая уникальная статья (например `e2e-test-YYYYMMDD`) — НЕ перезаписывать 0553.
- **D-06:** node:test E2E-скрипт в `test/e2e.test.js`. Запускается через `npm test` вместе с unit-тестами (или отдельным `npm run test:e2e`).
- **D-07:** Скрипт поднимает API-сервер (`infra/local-server.js`) перед тестом и убивает после. Или предполагает, что сервер уже запущен (проще).
- **D-08:** Happy path: POST /lines → 200 → POST .../02-texts/regenerate → 202 → (poll до done, таймаут 5 мин) → POST .../03-images/regenerate → 202 → (poll, таймаут 10 мин) → POST .../05-excel/regenerate → 200 → POST .../06-assemble/regenerate → 200 → проверить output/.

### Claude's Discretion
- Таймауты polling (02-texts до 3 мин/шаг, 03-images до 5 мин).
- Структура проверок: точный список файлов в output/{article}/ после assemble.
- Отдельный `npm run test:e2e` vs. включить в основной `npm test`.
- Очистка output/ после теста vs. оставить для осмотра.

### Deferred Ideas (OUT OF SCOPE)
- step-video / kling.ai (VID-01/VID-02) — v2.
- Error recovery E2E-сценарий (сломать ключ → ✘ → Повторить) — отдельная задача после Phase 5.
- Yandex Cloud smoke-test (`STORE_ADAPTER=yandex-cloud`) — после настройки prod-окружения.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REL-02 | E2E прогон: реальный опросник + фото проходит шаги 01–05 без ручного вмешательства | Полный поток endpoint'ов задокументирован ниже («Pipeline Contract»). Poll-семантика и точные имена артефактов известны. Скрипт `test/e2e.test.js` оркестрирует шаги последовательно через живой HTTP-сервер. |
</phase_requirements>

## Summary

Phase 5 — это **тест, а не фича**. Цель: один автоматизированный `node:test` сценарий, который через живой HTTP API (`infra/local-server.js`, порт 3001) прогоняет реальный опросник лицевого молда + реальное фото через шаги 01→02→03→05→06 с настоящими вызовами OpenAI и проверяет, что в `output/` (точнее — в `OUTPUT_DIR`) появился полный набор артефактов. Всё необходимое уже существует в коде: API-роутер, все хэндлеры, локальный fire-and-forget раннер, паттерны тестов с multipart-загрузкой. Новый код — только оркестрирующий скрипт и хелперы polling/проверки.

**Главное архитектурное открытие, влияющее на план:** в манифесте **НЕТ поля `status`** (`running`/`done`/`error` как явного enum). Шаги пишут только `currentVersion`, `history[]` и при падении — `{ error, failedAt }`. Соответственно «шаг готов» определяется так же, как это делает фронтенд в `computeStepStatus` (`frontend/PipelineApp.jsx:414`): для async-шагов **готово = число различных артефактов в последней версии равно ожидаемому (5 для текстов, 5 для картинок)**; «упал» = присутствует `steps[stepId].error`. Любая poll-логика E2E ДОЛЖНА опираться на это, а не на несуществующий `status`.

**Второе открытие:** `06-assemble` **не копирует файлы** в единую папку — он пишет `assemble-report.json`, который ссылается на артефакты в их step-папках (`functions/step-assemble/index.js:30-65`). Поэтому Success Criterion 2 («в output/ полный пакет») выполняется наличием артефактов по step-папкам + корректным `assemble-report.json`, а НЕ плоской выгрузкой. Проверки в тесте должны идти по step-папкам.

**Primary recommendation:** Написать `test/e2e.test.js` на `node:test` + встроенный `fetch`, который (1) спавнит `infra/local-server.js` как дочерний процесс с `STORE_ADAPTER=local` и изолированным `OUTPUT_DIR`, (2) ждёт готовности порта, (3) последовательно дёргает endpoint'ы по D-08, (4) для async-шагов поллит манифест по «artifact-count == 5 И нет error», (5) валидирует артефакты по D-02, (6) убивает сервер. Таймауты: 02-texts = 5 мин, 03-images = 10 мин. Изолировать через отдельный `npm run test:e2e`, чтобы реальные OpenAI-вызовы не запускались на каждом `npm test`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Запуск/остановка API под тест | Test harness (child_process) | — | E2E поднимает реальный сервер; не лезет в хэндлеры напрямую (в отличие от unit-тестов) [VERIFIED: infra/local-server.js] |
| Оркестрация шагов | Test script (HTTP client) | API router | Тест дёргает REST-эндпоинты ровно как UI; API сам диспатчит на хэндлеры [VERIFIED: functions/api/index.js] |
| Запуск async-шагов локально | API `runLocally` (fire-and-forget) | step handlers | В local-режиме (нет YMQ URL) `handleRegenerate` зовёт `runLocally`, возвращает 202, шаги идут в фоне [VERIFIED: functions/api/index.js:404] |
| Сигнал «готово» | Manifest (`currentVersion` + `history[]`) | versionStore artifacts | Нет поля status; готовность = N артефактов в последней версии [VERIFIED: PipelineApp.jsx:414, step-texts/images] |
| Хранение артефактов | versionStore `local` adapter | filesystem `OUTPUT_DIR` | E2E использует `STORE_ADAPTER=local` для изоляции [CITED: CLAUDE.md] |
| Реальная генерация | step-texts / step-images → OpenAI | OpenAI Images Edits API | D-01: настоящий ключ, реальные вызовы [VERIFIED: step-images/index.js:217] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | встроен (Node 22.22.1) | Тест-раннер для E2E | Уже используется во всех тестах проекта; нулевые зависимости [VERIFIED: package.json `node --test`] |
| `node:assert` | встроен | Ассерты | Используется во всех существующих тестах [VERIFIED: test/*.test.js] |
| `fetch` (global) | встроен (Node 18+) | HTTP-клиент к живому серверу | Используется в smoke-тесте и хэндлерах [VERIFIED: создание линии через fetch] |
| `node:child_process` `spawn` | встроен | Поднять `infra/local-server.js` как процесс | Реализация D-07; стандарт для E2E живого сервера |
| `exceljs` | `^4.4.0` | `Workbook.xlsx.readFile()` для проверки xlsx (D-02) | Уже зависимость; нужен для валидации, что xlsx открывается без ошибок [VERIFIED: package.json] |
| `FormData` / `Blob` (global) | встроен (Node 18+) | multipart-загрузка фото в POST /lines | Тот же путь, что в браузере; `local-server.js` парсит через busboy [VERIFIED: infra/local-server.js:63] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs` | встроен | Проверка наличия/размера артефактов на диске | Для прямой проверки `OUTPUT_DIR/{article}/{step}/v{N}/...` |
| `node:path` | встроен | Сборка путей к артефактам | Везде |
| `node:net` (`createConnection`) | встроен | Проверка готовности порта 3001 перед тестом | Wait-for-port перед первым запросом |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Спавн сервера child_process | Импорт `handler` напрямую (как unit-тесты) | Проще, без сети — НО не покрывает multipart-парсинг в `local-server.js` и не доказывает «через UI». D-07 допускает оба; спавн ближе к REL-02 «без ручного вмешательства через UI». Рекомендую спавн, с фолбэком «сервер уже запущен» через env-флаг. |
| `fetch` к живому серверу | `supertest` | Лишняя зависимость; `fetch` встроен и уже используется. Не добавлять. |
| Polling манифеста через `GET /manifest` | Чтение `manifest.json` с диска | HTTP-poll честнее (тот же путь, что UI). Чтение с диска — фолбэк для отладки. Рекомендую HTTP. |

**Installation:**
```bash
# Никаких новых пакетов. Всё встроено или уже есть в package.json.
```

**Version verification:** `node --version` → v22.22.1 (поддерживает `node:test`, glob-паттерны, `fetch`, `FormData`). `exceljs ^4.4.0` присутствует в `package.json`. [VERIFIED: bash node --version + package.json]

## Package Legitimacy Audit

> Фаза НЕ устанавливает новых внешних пакетов — использует только встроенные модули Node и уже присутствующий `exceljs`. Аудит не требуется.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                       npm run test:e2e
                              │
                              ▼
                   ┌──────────────────────┐
                   │  test/e2e.test.js     │  (node:test)
                   │  - spawn server       │
                   │  - wait-for-port 3001 │
                   └──────────┬────────────┘
                              │ spawn (child_process)
                              ▼
              ┌────────────────────────────────┐
              │ infra/local-server.js  :3001    │
              │ STORE_ADAPTER=local             │
              │ OUTPUT_DIR=./test/e2e-output    │
              │ OPENAI_API_KEY=<real>           │
              └──────────────┬─────────────────┘
                             │ HTTP (fetch)
        ┌────────────────────┼──────────────────────────┐
        │                    │                           │
   POST /lines          POST .../02-texts/regenerate   GET .../manifest
   (multipart:          (202, fire-and-forget)         (poll loop)
    photo + JSON)             │                           ▲
        │                     ▼                           │
        ▼              ┌──────────────┐    poll: artifact-count==5
   01-normalize        │ runLocally   │───────────────────┘
   (sync, 200)         │ (background) │
        │              └──────┬───────┘
        │                     │ real OpenAI calls (D-01)
        ▼                     ▼
   master-data.json     {size}_texts.json ×5
                        {size}_infographic.png ×5
                             │
        POST .../05-excel/regenerate (sync 200)
                             ▼
                   {article}_ozon.xlsx, {article}_wb.xlsx
                             │
        POST .../06-assemble/regenerate (sync 200)
                             ▼
                   assemble-report.json  (references, NOT copies)
                             │
                             ▼
              ┌──────────────────────────────┐
              │ Validation (D-02):           │
              │ - files exist                │
              │ - PNG size > 0               │
              │ - no {{ }} in texts          │
              │ - exceljs readFile xlsx OK   │
              └──────────────────────────────┘
```

### Recommended Project Structure
```
test/
├── e2e.test.js                 # новый: E2E-оркестратор (this phase)
├── fixtures/
│   ├── e2e-face-mold.png       # новый: реальное фото лицевого молда (D-04, юзер кладёт)
│   └── e2e-face-questionnaire.json  # опционально: тело опросника как фикстура (D-03)
├── e2e-output/                 # новый: изолированный OUTPUT_DIR для E2E (в .gitignore)
└── (существующие unit-тесты без изменений)
```

### Pattern 1: Спавн живого сервера + wait-for-port
**What:** Запустить `infra/local-server.js` дочерним процессом с переопределённым окружением, дождаться, пока порт примет соединение, и гарантированно убить в `after()`.
**When to use:** Реализация D-07 (вариант «скрипт сам поднимает сервер»).
**Example:**
```javascript
// Source: pattern derived from infra/local-server.js (PORT, STORE_ADAPTER, OUTPUT_DIR env)
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const PORT = 3101; // отдельный порт, чтобы не конфликтовать с dev-сервером на 3001
const OUTPUT_DIR = path.join(__dirname, 'e2e-output');

let server;
function startServer() {
  server = spawn('node', [path.resolve(__dirname, '../infra/local-server.js')], {
    env: {
      ...process.env,                 // наследует реальный OPENAI_API_KEY (D-01)
      PORT: String(PORT),
      STORE_ADAPTER: 'local',
      OUTPUT_DIR,
      SHARED_LAYER_PATH: path.resolve(__dirname, '../layers/shared'),
    },
    stdio: 'inherit', // прогресс шагов виден в выводе теста (specifics: stdout-прогресс)
  });
}

function waitForPort(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function attempt() {
      const sock = net.createConnection(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) return reject(new Error('server did not start'));
        setTimeout(attempt, 200);
      });
    })();
  });
}
// after(): server.kill('SIGTERM')
```

### Pattern 2: Poll по artifact-count (НЕ по status)
**What:** Async-шаг «готов», когда в последней версии лежат все ожидаемые артефакты (5 размеров). Падение = `manifest.steps[stepId].error` непустой.
**When to use:** После каждого 202-ответа (02-texts, 03-images).
**Example:**
```javascript
// Source: mirrors frontend computeStepStatus (frontend/PipelineApp.jsx:414-444)
// и логику записи в step-texts/index.js:87, step-images/index.js:107
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

async function pollStep(baseUrl, article, stepId, { expect, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/lines/${article}/manifest`);
    const manifest = await res.json();
    const meta = manifest.steps?.[stepId];

    if (meta?.error) {
      throw new Error(`step ${stepId} failed: ${meta.error} @ ${meta.failedAt}`);
    }
    if (meta?.currentVersion) {
      // считаем различные артефакты последней версии через GET /steps/:step
      const stepRes = await fetch(`${baseUrl}/lines/${article}/steps/${stepId}`);
      const step = await stepRes.json();
      const artifacts = step.artifacts || [];
      console.log(`[e2e] ${stepId}: ${artifacts.length}/${expect} артефактов...`);
      if (artifacts.length >= expect) return manifest;
    }
    await new Promise(r => setTimeout(r, 5000)); // poll каждые 5 с (как UI: setInterval 5s)
  }
  throw new Error(`step ${stepId} timed out after ${timeoutMs}ms`);
}
// 02-texts: pollStep(..., { expect: 5, timeoutMs: 5*60*1000 })
// 03-images: pollStep(..., { expect: 5, timeoutMs: 10*60*1000 })
```

### Pattern 3: multipart POST /lines (фото + опросник)
**What:** Загрузка фото как `image/*` + JSON-поле `questionnaire`. Точно тот же формат, что шлёт браузер.
**When to use:** Создание линии (первый шаг D-08).
**Example:**
```javascript
// Source: infra/local-server.js:63 (busboy fields+files), api/index.js:195 (event.files path)
const fs = require('node:fs');
const photo = fs.readFileSync(path.join(__dirname, 'fixtures/e2e-face-mold.png'));
const fd = new FormData();
fd.append('questionnaire', JSON.stringify(questionnaire)); // string field
fd.append('photo', new Blob([photo], { type: 'image/png' }), 'e2e-face-mold.png');
// БЕЗ ручного Content-Type — fetch/undici сам выставит boundary (см. CLAUDE.md, step-images)
const res = await fetch(`${baseUrl}/lines`, { method: 'POST', body: fd });
// ожидаем 200 + body.stepId === '01-normalize' (api/index.js:284)
```

### Anti-Patterns to Avoid
- **Polling по `manifest.steps[stepId].status`:** такого поля НЕТ. Будет вечное ожидание/`undefined`. Используй artifact-count.
- **Ожидание плоской папки после assemble:** `06-assemble` не копирует файлы — пишет `assemble-report.json` со ссылками. Проверяй артефакты по step-папкам.
- **Запуск E2E на каждом `npm test`:** реальные OpenAI-вызовы стоят денег и медленные. Изолируй в `npm run test:e2e` (см. Open Questions).
- **`USE_STUB=true` или отсутствие `OPENAI_API_KEY`:** нарушает D-01 и обходит реальную генерацию. Сервер должен наследовать реальный ключ. ВАЖНО: в `step-images` без `OPENAI_API_KEY` генерится 1×1 заглушка, а при ошибке Edits API — тоже заглушка с `needsReview:true` (`step-images/index.js:225`). Тест должен явно проверять, что картинка НЕ 1×1-заглушка (размер > ~100 байт), иначе «зелёный» тест скроет нерабочую генерацию.
- **Жёсткий порт 3001:** конфликт с dev-сервером. Используй отдельный порт (напр. 3101) или env-override.
- **Параллельные размеры с одним article:** `02-texts` пиннит `runVersion` именно чтобы все 5 размеров легли в одну версию (`api/index.js:382`). Не дёргай per-item regenerate параллельно — используй полный regenerate шага.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Парсинг multipart на сервере | Свой парсер | `infra/local-server.js` (busboy) уже это делает | Сервер принимает FormData как есть |
| Запуск шагов в фоне | Свой воркер/очередь | `runLocally` в `handleRegenerate` (202 + fire-and-forget) | Уже реализовано для local-режима |
| Проверка xlsx | Ручной разбор zip/xml | `new ExcelJS.Workbook().xlsx.readFile(path)` | D-02; exceljs уже зависимость |
| Определение «готово» | Свой статус-enum | Логика `computeStepStatus` (artifact-count) | Единый источник истины с UI |
| HTTP-клиент | axios/got/supertest | global `fetch` | Встроен, уже используется |

**Key insight:** Phase 5 почти целиком — переиспользование. Новый код = тонкий оркестратор. Любая «новая инфраструктура» (очередь, статусы, парсеры) — признак того, что план игнорирует существующие паттерны.

## Common Pitfalls

### Pitfall 1: Polling по несуществующему `status`
**What goes wrong:** Тест ждёт `status === 'done'`, которого нет → таймаут даже при успешной генерации.
**Why it happens:** CONTEXT D-08 и Success Criterion формулируют «статус готов/упал» по-человечески, но в данных это `currentVersion`+артефакты / `error`.
**How to avoid:** Реализовать `pollStep` по artifact-count (Pattern 2). «Упал» = `meta.error`.
**Warning signs:** Тест висит ровно до таймаута; в манифесте при этом 5 артефактов есть.

### Pitfall 2: Заглушка вместо реальной картинки проходит как «успех»
**What goes wrong:** Если `OPENAI_API_KEY` не пробросился ИЛИ Edits API вернул ошибку, `step-images` сохраняет 1×1-PNG-заглушку (~70 байт) с `needsReview:true` и `currentVersion` всё равно растёт (`step-images/index.js:90,225`). Тест по «5 артефактов» зеленеет, хотя генерация не работала.
**Why it happens:** Грейсфул-фолбэк в step-images маскирует сбой как «успех с needsReview».
**How to avoid:** D-02 проверка «PNG ненулевого размера» недостаточна — проверяй размер > порога (напр. > 1000 байт) ИЛИ что `needsReview === false` в `history`. Также залогировать предупреждение, если любой размер вернул `needsReview:true`.
**Warning signs:** Все PNG ровно ~70 байт; `history[].needsReview === true` у всех.

### Pitfall 3: Фоновый шаг падает, но POST уже вернул 202
**What goes wrong:** `runLocally` — fire-and-forget; ошибка генерации не возвращается в HTTP-ответ, а пишется в манифест (`api/index.js:73`). Тест, не поллящий `error`, считает шаг «ещё идёт» до таймаута.
**Why it happens:** Async-дизайн: 202 = «принято», не «успешно».
**How to avoid:** В `pollStep` проверять `meta.error` ПЕРЕД проверкой артефактов и кидать сразу (Pattern 2).
**Warning signs:** Лог сервера показывает `[local] 02-texts error: ...`, а тест продолжает поллить.

### Pitfall 4: Background-задачи переживают убийство сервера / висят после теста
**What goes wrong:** `02-texts`/`03-images` идут в фоне внутри процесса сервера. Если убить сервер до их завершения — артефакты не допишутся; если не убить — процесс висит, `node:test` не выходит.
**Why it happens:** fire-and-forget не привязан к HTTP-запросу.
**How to avoid:** Дождаться `pollStep` ПЕРЕД переходом к следующему шагу (последовательность D-08 это гарантирует). Сервер убивать только в `after()` после всех проверок. `server.kill('SIGTERM')` + `unref`/обработка в harness.
**Warning signs:** `npm run test:e2e` не завершается; orphan node-процесс на порту.

### Pitfall 5: Кэш по input-hash пропускает шаг при повторном прогоне
**What goes wrong:** Повторный E2E с тем же article+опросником вернёт `skipped: true` (cache hit) и не сгенерит заново — артефакты от прошлого прогона, тест может «пройти» вхолостую.
**Why it happens:** Все шаги сравнивают inputHash и при совпадении пропускают (`api/index.js:259`, `step-texts:50`, и т.д.).
**How to avoid:** D-05 — уникальный article на прогон (`e2e-test-YYYYMMDD-HHMMSS`) ИЛИ слать `force:true` в теле regenerate (regenerate уже дефолтит `force=true` — `api/index.js:367`, но POST /lines дефолтит `force=false`). Для POST /lines использовать уникальный article. Это снимает проблему.
**Warning signs:** В ответе `skipped:true`; время прогона подозрительно мало.

### Pitfall 6: Фото-фикстура отсутствует / не реальная
**What goes wrong:** `test/fixtures/test-mold.png` — 1×1 заглушка. Для реальной генерации (D-01/D-04) нужно настоящее фото лицевого молда, иначе Images Edits API получит мусорный reference.
**Why it happens:** Существующие фикстуры — для unit-тестов с заглушками.
**How to avoid:** D-04 — юзер кладёт реальное фото в `test/fixtures/e2e-face-mold.png` ПЕРЕД прогоном. План должен включить чек «фикстура существует и > N байт», иначе понятный skip/fail с инструкцией.
**Warning signs:** Фото ровно 69 байт (как `test-mold.png`).

### Pitfall 7: Background-шаг бросает синхронно raw-ошибку в `runLocally` без записи в манифест
**What goes wrong:** `runLocally` ловит throw и пишет error в манифест (`api/index.js:72`), НО если падение происходит ДО входа в try/catch хэндлера (напр. неверный message) — поведение зависит от обёртки. В целом покрыто, но edge-case.
**How to avoid:** Полагаться на `meta.error`; при таймауте читать `logs/api.log` (сервер всё логирует туда) для диагностики.
**Warning signs:** Таймаут без `error` в манифесте — смотри `logs/api.log`.

## Code Examples

### Сборка валидного опросника для лицевого молда (D-03)
```javascript
// Source: input/questionnaire.schema.json (required fields) + create-line.smoke.test.js
// ВНИМАНИЕ: schema требует поля artifacts; smoke-тест его НЕ слал и прошёл —
// значит computeMasterData терпим к отсутствию. Но для чистоты E2E включаем artifacts.
const questionnaire = {
  article: `e2e-test-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`, // D-05 уникальная
  moldType: 'face',                         // D-03
  moldName: 'Василиса',
  brand: 'ТопМолд',
  theme: 'Кукольное лицо',
  color: 'Телесный',
  priceBaseM: 1200,
  sizes: [
    { size: 'XS', moldSize: 50,  moldLength: 5.0, moldWidth: 4.0, moldHeight: 1.5, moldWeight: 80  },
    { size: 'S',  moldSize: 65,  moldLength: 6.5, moldWidth: 5.2, moldHeight: 1.8, moldWeight: 110 },
    { size: 'M',  moldSize: 80,  moldLength: 8.0, moldWidth: 6.3, moldHeight: 2.0, moldWeight: 145 },
    { size: 'L',  moldSize: 95,  moldLength: 9.5, moldWidth: 7.4, moldHeight: 2.2, moldWeight: 185 },
    { size: 'XL', moldSize: 110, moldLength: 11,  moldWidth: 8.5, moldHeight: 2.5, moldWeight: 230 },
  ],
  photos: [],                               // заполняется сервером после multipart-загрузки
  artifacts: ['images', 'excel-ozon', 'excel-wb'],
};
```
> ⚠️ [ASSUMED] CONTEXT упоминает поля `faceSize`/`poraType`/`faceOval` в template.master.json для face-молда. Текущая `questionnaire.schema.json` их НЕ содержит (схема универсальная: `moldType` + `sizes[]`). Планировщик/discuss должен подтвердить, нужны ли доп. поля для face, или универсальной схемы достаточно. Smoke-тест с `moldType:'hands'` и без face-полей прошёл — вероятно универсальной схемы хватает.

### Валидация артефактов (D-02)
```javascript
// Source: D-02 + exceljs API + step output names
const fs = require('node:fs');
const ExcelJS = require('exceljs');

function artifactPath(stepId, version, name) {
  return path.join(OUTPUT_DIR, article, stepId, `v${version}`, name);
}

// 1. master-data.json существует и парсится в 5 записей
// 2. {size}_texts.json ×5 — нет нераскрытых {{...}}
for (const size of SIZES) {
  const txt = JSON.parse(fs.readFileSync(artifactPath('02-texts', txtVer, `${size}_texts.json`)));
  const blob = JSON.stringify(txt);
  assert.ok(!/\{\{.*?\}\}/.test(blob), `${size}: нераскрытый плейсхолдер в текстах`);
}
// 3. {size}_infographic.png ×5 — размер > порога (не 1×1-заглушка, Pitfall 2)
for (const size of SIZES) {
  const st = fs.statSync(artifactPath('03-images', imgVer, `${size}_infographic.png`));
  assert.ok(st.size > 1000, `${size}: PNG слишком мал (вероятно заглушка): ${st.size}b`);
}
// 4. xlsx открывается без ошибок
for (const f of [`${article}_ozon.xlsx`, `${article}_wb.xlsx`]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(artifactPath('05-excel', xlsxVer, f)); // throws if corrupt
  assert.ok(wb.worksheets.length > 0, `${f}: нет листов`);
}
// 5. assemble-report.json существует и перечисляет completedSteps
```
> Версии (`txtVer`, `imgVer`, `xlsxVer`) брать из `manifest.steps[stepId].currentVersion` после polling, не хардкодить.

### npm scripts
```json
// package.json — добавить test:e2e, оставить test для unit (Open Question Q1)
{
  "scripts": {
    "test": "node --test 'test/**/*.test.js'",
    "test:e2e": "node --test test/e2e.test.js"
  }
}
```
> ⚠️ Если E2E файл назван `*.test.js` в `test/`, он попадёт под glob основного `npm test`. Чтобы реальные OpenAI-вызовы НЕ шли на каждом `npm test`, либо (a) назвать файл `test/e2e.js` и запускать только через `test:e2e`, либо (b) добавить guard `if (!process.env.RUN_E2E) test.skip(...)`. Рекомендую (b): файл `test/e2e.test.js` со skip-guard — виден, но не запускается без флага. [ASSUMED — planner/discuss решает финальный механизм; D-06 оставляет на усмотрение]

## Runtime State Inventory

> Не rename/refactor фаза. Однако E2E пишет на диск и спавнит процесс — релевантное состояние ниже.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | E2E пишет `OUTPUT_DIR/{article}/...` (изолированный `test/e2e-output/`, НЕ production `./output/` и НЕ `test/tmp-output/` unit-тестов) | Добавить `test/e2e-output/` в `.gitignore`; решить про cleanup (Open Q3) |
| Live service config | Спавнится `infra/local-server.js` на отдельном порту (не 3001, чтобы не конфликтовать с dev) | Гарантированный kill в `after()`; wait-for-port перед стартом |
| OS-registered state | Нет | None — verified: тест не регистрирует ничего на уровне ОС |
| Secrets/env vars | `OPENAI_API_KEY` (обязателен, D-01), опц. `ANTHROPIC_API_KEY` (критик картинок; без него критик=ok-заглушка). Наследуются child-процессом из окружения / `.env.local` | Тест должен проверить наличие `OPENAI_API_KEY` и понятно фейлиться/скипаться при отсутствии |
| Build artifacts | `logs/api.log` пишется сервером (`local-server.js:15`) — растёт при прогоне | None обязательного; полезно для диагностики таймаутов |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Весь тест | ✓ | v22.22.1 | — |
| `node:test` / `fetch` / `FormData` | Тест-раннер + HTTP | ✓ | встроено (Node 22) | — |
| `exceljs` | Валидация xlsx (D-02) | ✓ | ^4.4.0 | — |
| `busboy` | multipart на сервере | ✓ (require в local-server.js) | — | — |
| `OPENAI_API_KEY` | Реальная генерация текстов+картинок (D-01) | ✗ не проверено в сессии (секрет) | — | НЕТ — блокирует E2E. Тест должен явно фейлиться с понятным сообщением, если не задан |
| `ANTHROPIC_API_KEY` | Критик картинок (опц.) | ✗ не проверено | — | Без него критик возвращает `{ok:true}` (`step-images:241`) — генерация всё равно идёт |
| Реальное фото лицевого молда | reference для Images Edits (D-04) | ✗ юзер кладёт перед прогоном | — | НЕТ — тест должен проверить наличие фикстуры |
| `layers/shared/templates/infographic.png` | фон для Images Edits | ✓ но это 1×1 заглушка (70 байт) | — | ⚠️ Реальный фон желателен для осмысленного результата; с 1×1 фоном Edits API отработает, но картинка будет бессмысленной |

**Missing dependencies with no fallback (блокируют E2E):**
- `OPENAI_API_KEY` (реальный) — D-01.
- Реальное фото лицевого молда `test/fixtures/e2e-face-mold.png` — D-04.

**Missing dependencies with fallback:**
- `ANTHROPIC_API_KEY` — без него критик картинок пропускает (ok); генерация продолжается.
- Реальный `infographic.png` фон — 1×1 заглушки достаточно для технического прохождения E2E (но не для качества).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (встроен, Node 22.22.1) + `node:assert` |
| Config file | none — glob в `package.json` script |
| Quick run command | `npm run test:e2e` (новый — этот скрипт) |
| Full suite command | `npm test` (unit-тесты; E2E под guard/отдельным script) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-02 | Полный pipeline 01→06 без ручного вмешательства, реальные ключи | e2e | `npm run test:e2e` | ❌ Wave 0 — `test/e2e.test.js` |
| SC-1 (criterion 1) | POST /lines + последовательный запуск шагов автоматом | e2e | внутри `test/e2e.test.js` | ❌ Wave 0 |
| SC-2 (criterion 2) | После 06 в output: master-data.json, тексты, слайды, ozon.xlsx, wb.xlsx | e2e (fs+exceljs) | внутри `test/e2e.test.js` | ❌ Wave 0 |
| SC-3 (criterion 3) | Каждый шаг завершается «готов» или «упал», не висит | e2e (poll + timeout) | внутри `test/e2e.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (unit-тесты — быстрые, без сети). E2E НЕ гонять на каждом коммите (стоит денег/медленный).
- **Per wave merge:** `npm test` зелёный.
- **Phase gate:** `npm run test:e2e` зелёный ОДИН раз с реальными ключами + реальным фото перед `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `test/e2e.test.js` — оркестратор pipeline (covers REL-02, SC-1/2/3)
- [ ] `test/fixtures/e2e-face-mold.png` — реальное фото (предоставляет юзер, D-04)
- [ ] `test/fixtures/e2e-face-questionnaire.json` — опц. фикстура опросника (D-03)
- [ ] `.gitignore` — добавить `test/e2e-output/`
- [ ] `package.json` — добавить `test:e2e` script
- [ ] Helper: wait-for-port + spawn server (Pattern 1)
- [ ] Helper: `pollStep` по artifact-count (Pattern 2)

## Security Domain

> `security_enforcement: true`, ASVS level 1. Фаза — тест, не вводит новых поверхностей атаки, но затрагивает секреты и загрузку файлов.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Инструмент без auth (Out of Scope в REQUIREMENTS) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | API уже валидирует: article-regex, magic-bytes изображения, sanitize filename (`api/index.js:206,217,221`). E2E НЕ должен обходить эти проверки — слать валидное фото и article. |
| V6 Cryptography | no | Только sha256 для inputHash (не секьюрити-функция) |
| V7/V14 (секреты в конфиге) | yes | `OPENAI_API_KEY` НЕ хардкодить в тесте/фикстурах. Наследовать из окружения/`.env.local` (в `.gitignore`). НЕ логировать ключ. |

### Known Threat Patterns for {Node E2E + file upload}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Секрет в коммите (API key в тесте) | Information Disclosure | Читать `OPENAI_API_KEY` из env; `test/e2e-output/` и `.env.local` в `.gitignore`; не печатать ключ в stdout/`logs/api.log` |
| Path traversal через имя фото | Tampering | Уже митигировано в `api/index.js:221` (basename + sanitize); E2E использует безопасное имя |
| Orphan-процесс сервера держит порт | DoS (local) | Гарантированный `kill` в `after()` + wait-for-port |
| Реальные платные вызовы из CI на каждом push | (стоимость/abuse) | E2E под отдельным script/guard — не в дефолтном `npm test` |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DALL·E 2 edits | `gpt-image-1` Images Edits API с `image[]` multipart, ответ `b64_json` | gpt-image-1 GA 2025 | Код уже на `gpt-image-1` (`step-images:9`); контракт подтверждён актуальной докой [CITED: developers.openai.com images edit] |
| Внешние тест-фреймворки (jest/mocha) | Встроенный `node:test` | Node 18+ stable | Проект уже на `node:test`; новых зависимостей не нужно |

**Deprecated/outdated:** ничего релевантного для этой фазы.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Универсальной `questionnaire.schema.json` (moldType + sizes) достаточно для face-молда; доп. поля faceSize/poraType/faceOval НЕ требуются | Code Examples / D-03 | Если template.master.json реально требует face-поля для осмысленных текстов/картинок — опросник неполный, тексты получатся generic. Discuss/planner должен свериться с `template.master.json`. Митигировано: smoke-тест без этих полей прошёл. |
| A2 | Файл `test/e2e.test.js` со skip-guard (env-флаг) — оптимальный способ не запускать платный E2E на каждом `npm test` | Code Examples / npm scripts | Если выбран другой механизм (отдельный файл вне glob), нужно поправить именование. Низкий риск — D-06 оставляет на усмотрение. |
| A3 | 1×1 `infographic.png` фон достаточен для технического прохождения Edits API | Environment Availability | Если Edits API отвергает 1×1 фон → step-images уйдёт в stub-фолбэк (needsReview), Pitfall 2 поймает. Реальный фон желателен. |
| A4 | `runLocally` фоновые задачи завершаются в пределах процесса сервера до polling-таймаута (5/10 мин) | Patterns / Pitfalls | 5 размеров × до 3 ретраев OpenAI могут превысить таймаут при медленном API. Митигировать запасом таймаута; критик-ретраи текстов rule-based (быстрые), картинок — до 3 попыток с Vision (медленно, если ANTHROPIC задан). |

## Open Questions

1. **Запускать E2E в основном `npm test` или отдельно?**
   - Что знаем: D-06 допускает оба; реальные OpenAI-вызовы платные/медленные.
   - Что неясно: предпочтение по CI.
   - Рекомендация: `test/e2e.test.js` со skip-guard `if (!process.env.RUN_E2E) { test.skip(...) }` — виден в наборе, но не гонится без `RUN_E2E=1 npm run test:e2e`. Защищает от случайных трат.

2. **Нужны ли face-специфичные поля в опроснике (faceSize/poraType/faceOval)?**
   - Что знаем: CONTEXT упоминает их; текущая схема — нет; smoke прошёл без них.
   - Что неясно: влияют ли они на качество текстов/картинок для face.
   - Рекомендация: planner сверяется с `template.master.json` (`moldTypes.face`); если поля влияют на topic/purpose — добавить в фикстуру, иначе универсального опросника достаточно.

3. **Cleanup `test/e2e-output/` после теста?**
   - Что знаем: D (discretion) — на усмотрение.
   - Рекомендация: НЕ чистить автоматически (оставить для осмотра артефактов человеком — это и есть «получил готовый пакет»); добавить в `.gitignore`. Очистка — опциональный `RUN_E2E_CLEAN=1`.

4. **Спавнить сервер или предполагать запущенный?**
   - Что знаем: D-07 допускает оба.
   - Рекомендация: спавнить (надёжнее для CI/REL-02 «без ручного вмешательства») с фолбэком `E2E_BASE_URL` — если задан, использовать существующий сервер, иначе спавнить свой на отдельном порту.

## Sources

### Primary (HIGH confidence)
- Codebase (прямое чтение): `functions/api/index.js`, `functions/step-texts/index.js`, `functions/step-images/index.js`, `functions/step-excel/index.js`, `functions/step-assemble/index.js`, `infra/local-server.js`, `frontend/PipelineApp.jsx` (computeStepStatus), `test/create-line.smoke.test.js`, `test/step-error-capture.test.js`, `input/questionnaire.schema.json`, `package.json`, `.planning/config.json`
- `node --version` → v22.22.1; `file` на PNG-фикстурах (1×1) — VERIFIED
- CLAUDE.md — конвенции, STORE_ADAPTER, multipart-паттерн

### Secondary (MEDIUM confidence)
- OpenAI Images Edits API контракт (`image[]` multipart, `b64_json`, `gpt-image-1`) — [CITED: developers.openai.com/api/reference images edit; platform.openai.com/docs/guides/image-generation]

### Tertiary (LOW confidence)
- Предположения A1–A4 (см. Assumptions Log) — требуют подтверждения planner/discuss.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — всё встроено/присутствует, версии проверены.
- Architecture (poll-семантика, assemble-поведение): HIGH — прочитано в коде напрямую.
- Pitfalls: HIGH — выведены из реального кода (stub-фолбэки, fire-and-forget, кэш).
- Face-опросник (A1): MEDIUM — схема универсальная, но CONTEXT упоминает доп. поля.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (стабильный домен; OpenAI image API контракт может меняться — перепроверить при сбоях генерации)
