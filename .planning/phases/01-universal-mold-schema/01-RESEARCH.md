# Phase 1: Universal Mold Schema — Research

**Researched:** 2026-06-15
**Domain:** Multipart upload (Node `node:http`), универсализация data-схемы (rename + параметризация), React modal-форма
**Confidence:** HIGH (весь предмет исследования — собственный код проекта, прочитан напрямую; внешняя зависимость одна — `busboy`, верифицирована на npm)

## Summary

Phase 1 — чисто внутренняя доработка: ни одного нового домена технологий, кроме одной зависимости для парсинга `multipart/form-data`. Три типа работ: (1) механический rename `faceSize → moldSize` и `renders → photos` через несколько файлов; (2) добавление `moldType` как параметра в schema + `template.master.json` + `templateEngine.js`; (3) приём `multipart/form-data` в `POST /lines` с загрузкой фото в хранилище и форма создания карточки во фронтенде.

Главная техническая развилка — multipart. Сейчас `infra/local-server.js` буферизует тело запроса в строку и `handleCreateLine` делает `JSON.parse`. Для файлов это не работает: бинарь ломается при `Buffer.concat(chunks).toString()`. Нужен либо парсер (`busboy`), либо раздельный endpoint `POST /lines/upload-photos`. CONTEXT.md называет multipart основным путём, раздельный endpoint — фолбэком. Рекомендация: **busboy** — это де-факто стандарт (на нём построены `multer` и `@fastify/multipart`), zero-runtime-dependency, без TypeScript, совместим с CommonJS. Парсинг делается на уровне `local-server.js` (он владеет `req`-потоком), результат кладётся в `event` в новом поле (например `event.files` + `event.formFields`), чтобы handler оставался serverless-совместимым.

Вторая развилка — загрузка фото в local-режиме. `versionStore` уже умеет `putArtifact(article, stepId, version, name, buffer)` для обоих адаптеров (local пишет на диск, yandex-cloud — в Object Storage через `@aws-sdk/client-s3`). Фото — это просто ещё один артефакт. Рекомендация: **не плодить отдельный код загрузки в S3** — переиспользовать `putArtifact` с псевдо-step `'00-photos'` (или `'photos'`), тогда оба адаптера и фолбэк работают бесплатно. Возвращаемый «URL» в local-режиме — это путь к артефакту, который фронтенд достаёт через существующий `GET /lines/:id/steps/:step/artifacts/:name`.

**Primary recommendation:** Добавить `busboy@^1.6.0` в корневой `package.json`; парсить multipart в `infra/local-server.js`, прокидывать файлы в `event`; в `handleCreateLine` сохранять фото через `store.putArtifact(article, 'photos', 1, filename, buffer)` и подставлять ссылки в `questionnaire.photos[]`; rename `faceSize→moldSize` и `renders→photos` механически; `moldType` читать в `templateEngine.js` через `template.moldTypes[q.moldType] ?? template.static` с fallback.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Парсинг multipart/form-data | local-server (HTTP-адаптер) | — | Только этот слой владеет сырым `req`-потоком; handler получает уже распарсенные поля/файлы (serverless-совместимость) |
| Загрузка фото в хранилище | api/handleCreateLine | versionStore | api оркестрирует, versionStore абстрагирует local vs Object Storage |
| Вычисление мастер-данных по moldType | templateEngine (pure) | template.master.json (data) | Чистая функция читает параметры из JSON-конфига — без I/O |
| Валидация полей формы | frontend (PipelineApp) | — (schema опционально на сервере) | UX-валидация на клиенте; server-side JSON Schema — out of scope для Phase 1 (CONTEXT) |
| Форма создания карточки | frontend (PipelineApp) | — | Чисто UI-слой |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `busboy` | `^1.6.0` | Стриминговый парсер `multipart/form-data` для Node | Де-факто стандарт; на нём построены `multer` и `@fastify/multipart`; zero runtime deps; CommonJS; работает поверх `node:http` без фреймворка |

### Supporting (уже в проекте — переиспользовать, не добавлять)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aws-sdk/client-s3` | `^3.1067.0` | Загрузка фото в Yandex Object Storage | Уже инкапсулировано в `versionStore.putArtifact` — вызывать его, не S3 напрямую |
| встроенный `crypto` | — | SHA-256 для inputHash-кэша | `handleCreateLine` уже хэширует questionnaire; фото войдут в хэш автоматически |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `busboy` | `formidable@^3.5.4` | formidable пишет файлы во временную директорию на диск по умолчанию (нужен потом cleanup), удобнее для «сохранить файл», но для «получить buffer и отдать в putArtifact» busboy чище (стрим в память) |
| `busboy` | Самописный парсер границ multipart | Парсинг multipart-границ, кодировок, имён файлов — классический «don't hand-roll»; легко ошибиться на edge-кейсах (CRLF, base64, кириллица в filename) |
| multipart на сервере | Раздельный `POST /lines/upload-photos` → URLs → `POST /lines` (JSON) | Два запроса, больше состояния на клиенте; но не нужен парсер на сервере. CONTEXT помечает как фолбэк «если сервер не умеет multipart». С busboy фолбэк не нужен |

**Installation:**
```bash
npm install busboy@^1.6.0
```

**Version verification (выполнено 2026-06-15):**
- `busboy` — `npm view busboy version` → **1.6.0** (опубликована/модифицирована 2026-04-24); `scripts.postinstall` пуст (нет postinstall-скрипта)
- `formidable` (альтернатива) — `npm view formidable version` → **3.5.4**
- `@aws-sdk/lib-storage` (не требуется) → 3.1069.0 — упомянуто только чтобы зафиксировать: для одиночной загрузки фото достаточно `PutObjectCommand`, который уже есть в `versionStore`

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `busboy` | npm | зрелый пакет (1.x line многолетняя), последняя версия 2026-04-24 | очень высокие (транзитивная зависимость `multer`/express-экосистемы) | github.com/mscdex/busboy | OK | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

`busboy` подтверждён через `npm view` (версия 1.6.0, нет `postinstall`-скрипта). Это известный пакет автора `mscdex` (тот же автор `dicer`), на котором стоит `multer`. Тег легитимности — высокая уверенность, но имя пакета изначально известно из training data → планировщику рекомендуется один лёгкий `checkpoint:human-verify` перед `npm install` (стандартная предосторожность для любой новой зависимости), затем считать `[VERIFIED: npm registry]`.

## Architecture Patterns

### System Architecture Diagram (поток создания карточки в Phase 1)

```
[Frontend: QuestionnaireForm modal]
   | FormData: questionnaire(JSON-строка) + photos(File[])
   v
POST /lines  (Content-Type: multipart/form-data)
   |
   v
[infra/local-server.js]
   |  если Content-Type начинается с "multipart/form-data":
   |     busboy парсит поток req →
   |       поля формы  → event.formFields  (в т.ч. questionnaire = JSON-строка)
   |       файлы       → event.files = [{ filename, mimeType, buffer }]
   |  иначе (JSON): как сейчас — event.body = rawBody
   v
[functions/api/index.js → handleCreateLine(event)]
   |  1. если event.files есть:
   |       questionnaire = JSON.parse(event.formFields.questionnaire)
   |       для каждого файла: store.putArtifact(article, 'photos', 1, filename, buffer)
   |       questionnaire.photos = [ ссылки на сохранённые фото ]
   |     иначе: как сейчас — questionnaire = JSON.parse(event.body)
   |  2. computeMasterData(questionnaire, template)   ← без изменений логики
   |  3. store.putArtifact(article,'01-normalize',v,'master-data.json',...)
   |  4. store.updateManifest(...)
   v
[versionStore]  local → ./output/{article}/photos/v1/{file}
                cloud → s3://bucket/{article}/photos/v1/{file}
   v
200 { article, stepId:'01-normalize', version, masterData }
```

Замечание по порядку: фото нужно сохранить **до** `computeMasterData`, потому что `questionnaire.photos` (ссылки) должны попасть и в inputHash, и в `historyEntry.questionnaire` (она сохраняется в манифест и переиспользуется при regenerate — см. `api/index.js:354`).

### Recommended Project Structure (без новых директорий)
```
infra/local-server.js          # + ветка multipart-парсинга (busboy)
functions/api/index.js         # handleCreateLine: + обработка event.files
layers/shared/templateEngine.js   # + чтение moldTypes[moldType] с fallback
layers/shared/config/template.master.json  # + moldTypes секция, rename в формулах
input/questionnaire.schema.json    # rename + moldType + photos required
frontend/PipelineApp.jsx       # QuestionnaireForm: + moldType select, + FormData submit
output/{article}/photos/v1/{file}  # новое место хранения фото (псевдо-step 'photos')
```

### Pattern 1: Парсинг multipart на уровне HTTP-адаптера, не handler
**What:** `local-server.js` распознаёт `multipart/form-data` по заголовку `Content-Type` и парсит поток через busboy ДО вызова handler. Handler получает уже готовые `event.files` / `event.formFields`. JSON-путь остаётся нетронутым.
**When to use:** Всегда, когда endpoint может принять файлы. Сохраняет handler serverless-совместимым (в облаке API Gateway сам отдаст `event.body` base64; там парсинг нужно будет повторить внутри handler — но для Phase 1 целевой запуск локальный).
**Example:**
```js
// Source: busboy README (github.com/mscdex/busboy) — адаптировано под node:http
// в infra/local-server.js, ВМЕСТО безусловного "for await (const chunk of req)"
const Busboy = require('busboy');
const ct = req.headers['content-type'] || '';

let event;
if (ct.startsWith('multipart/form-data')) {
  const { fields, files } = await new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
    const fields = {}; const files = [];
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => files.push({
        field: name, filename: info.filename, mimeType: info.mimeType,
        buffer: Buffer.concat(chunks),
      }));
    });
    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
  event = { httpMethod: req.method, path: url.pathname, queryStringParameters: {...}, headers: req.headers, formFields: fields, files, isBase64Encoded: false };
} else {
  // существующий JSON-путь
}
```

### Pattern 2: Фото как артефакт через versionStore (don't re-implement S3)
**What:** Загрузка фото = `store.putArtifact(article, 'photos', 1, filename, buffer)`. Адаптер сам выбирает диск или Object Storage, фолбэк работает бесплатно.
**When to use:** В `handleCreateLine` после парсинга файлов.
**Example:**
```js
// в functions/api/index.js → handleCreateLine
const photoRefs = [];
for (const f of (event.files || [])) {
  await store.putArtifact(article, 'photos', 1, f.filename, f.buffer);
  photoRefs.push(`/lines/${article}/steps/photos/artifacts/${f.filename}`); // local-доступный URL
}
questionnaire.photos = photoRefs;
```
Замечание: в cloud-режиме ссылка может быть s3-ключом или presigned URL — для Phase 1 (локальный прогон) достаточно artifact-пути, который отдаёт существующий `handleGetArtifact`.

### Pattern 3: moldType как параметр с fallback на static
**What:** В `templateEngine.computeMasterData` брать `topic/purpose/titleFull/annotation` из `template.moldTypes[q.moldType]`, а при отсутствии — из `template.static` / `template.textTemplates`.
**When to use:** При вычислении текстовых полей в `computeMasterData`.
**Example:**
```js
// в templateEngine.js (псевдокод по CONTEXT решению №4)
const typeCfg = (template.moldTypes && questionnaire.moldType)
  ? template.moldTypes[questionnaire.moldType]
  : null;
const titleFullTmpl  = typeCfg?.titleFull  ?? template.textTemplates.titleFull;
const annotationTmpl = typeCfg?.annotation ?? template.textTemplates.annotation;
const topic   = typeCfg?.topic   ?? template.static.topic;
const purpose = typeCfg?.purpose ?? template.static.purpose;
// topic/purpose кладём в ctx и/или в выходную запись, titleFull/annotation рендерим через renderText
```

### Anti-Patterns to Avoid
- **Парсить multipart внутри `handleCreateLine` из `event.body.toString()`:** бинарь портится при `.toString()` (текущий `local-server.js:59`). Парсить надо из сырого потока в адаптере.
- **Писать отдельный код загрузки в S3 в api/index.js:** дублирует `versionStore`, ломает фолбэк. Использовать `putArtifact`.
- **Хардкодить `moldSize` в формулах JS:** формулы читаются из `template.master.json` через `evalExpr` — менять JSON, не код движка. Единственное место с хардкодом имени поля — `templateEngine.js:58` (`const faceSizeM = baseRow.faceSize`) и `:73` (ctx-ключ `faceSizeM`). Эти два места + ключ в ctx надо переименовать вручную.
- **Оставить `renders` в schema рядом с `photos`:** schema имеет `additionalProperties: false` (строка 7) — лишнее поле `renders` в теле приведёт к провалу серверной валидации, если её добавят. Удалить `renders`, заменить на `photos`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Парсинг `multipart/form-data` | Самописный разбор boundary/CRLF/кодировок | `busboy` | Edge-кейсы: кириллица в filename, разные кодировки, потоковость, лимиты размера |
| Загрузка фото в Object Storage | Прямой `new S3Client()` в api | `store.putArtifact` | Уже инкапсулировано + фолбэк на диск |
| Подстановка значений в шаблоны текста | Свой replace по типам молда | `renderText` (`templateEngine.js:36`) + `moldTypes` data | Движок уже умеет `{{token}}`; разница только в источнике шаблона |
| Вычисление цен/toyFrom по размеру | Хардкод формул в JS | `evalExpr` + `computedFields` в JSON | Формулы — данные, не код |

**Key insight:** Phase 1 почти не пишет новой бизнес-логики — это rename + одна зависимость + переиспользование существующих абстракций (`putArtifact`, `renderText`, `evalExpr`). Чем меньше нового кода, тем меньше риск сломать ещё ни разу не прогнанный E2E.

## Runtime State Inventory

> Rename-фаза (`faceSize→moldSize`, `renders→photos`). Grep находит файлы; ниже — что НЕ находит grep.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None для faceSize** — E2E ни разу не запускался, в `./output/` нет реальных манифестов с `faceSize` (есть только моки во фронтенде, строки 73–190 — это JS-константы, не данные хранилища). Проверено: STATE.md фиксирует «E2E прогон ни разу не выполнялся». | Нет миграции данных. Чисто code-edit. |
| Live service config | **None.** Нет внешних сервисов с конфигом, содержащим `faceSize`/`renders`. YDB/Object Storage пусты (E2E не запускался). | None |
| OS-registered state | **None.** Нет Task Scheduler/launchd/pm2 с этими строками. Запуск только через `npm run dev`. | None |
| Secrets/env vars | **None.** `.env.local`/`.env.example` не содержат `faceSize`/`renders` (это поля данных, не env-vars). Новых секретов Phase 1 не вводит (busboy ключей не требует). | None |
| Build artifacts | **None блокирующих.** `busboy` добавит запись в `package-lock.json` — это ожидаемо. Фронтенд: Vite пересоберёт при `npm run dev`. | `npm install` после правки package.json |

**Канонический вопрос — что останется со старой строкой после правки всех файлов репо:** ничего в рантайме. Единственный «скрытый» хардкод имени `faceSize` в КОДЕ (не в data-JSON): `templateEngine.js:58` и `:73`, и во фронтенде моки `MASTER_DATA`/`SIZE_DEFAULTS`/`SIZE_FIELDS`/`NORMALIZE_FIELDS` (строки 85, 285–294, 594–608). Моки фронтенда удаляются в Phase 4 (UI-01), но в Phase 1 форма (`SIZE_DEFAULTS`/`SIZE_FIELDS`, строки 594–608) использует ключ `faceSize` — его нужно переименовать в `moldSize`, иначе отправляемый questionnaire не пройдёт обновлённую schema.

**Полный список вхождений `faceSize` (по прочитанным файлам):**
- `input/questionnaire.schema.json`: строки 46, 53, 56 (required + properties + description)
- `layers/shared/config/template.master.json`: строки 7, 9, 10, 14, 16 (computedFields + textTemplates)
- `layers/shared/templateEngine.js`: строки 58, 73 (`baseRow.faceSize`, ctx-ключ `faceSizeM`)
- `layers/shared/config/prompts.texts.json`: строка 4 (`{{faceSize}}` в user-промпте) — CONTEXT не упоминает, но это Phase 2 (тексты); **в Phase 1 безопаснее переименовать сразу**, чтобы промпт совпадал с новыми мастер-данными
- `frontend/PipelineApp.jsx`: строки 85 (mock), 285–286, 595–608 (форма — обязательно к правке)

**Полный список вхождений `renders`:**
- `input/questionnaire.schema.json`: строки 81–90 (определение `renders`)
- Во фронтенде `renders` не передаётся (форма собирает `artifacts`, но не `renders` — см. `buildQuestionnaire`, строки 625–639). Фото сейчас только показываются по имени (строка 719), не отправляются.

## Common Pitfalls

### Pitfall 1: `.toString()` на бинарном теле ломает фото
**What goes wrong:** Текущий `local-server.js:59` делает `Buffer.concat(chunks).toString()` — это разрушает байты изображения.
**Why it happens:** Сервер написан под JSON-only.
**How to avoid:** Ветвление по `Content-Type`; для multipart — busboy на сыром потоке, не `.toString()`.
**Warning signs:** Битые/нулевого размера файлы в `output/{article}/photos/`.

### Pitfall 2: schema `additionalProperties: false` отвергнет смешанные поля
**What goes wrong:** Если оставить и `renders`, и `photos`, или забыть убрать `renders` из required, валидация (когда её включат) упадёт.
**Why it happens:** Строка 7 schema запрещает лишние поля.
**How to avoid:** Полная замена `renders`→`photos` и в properties, и в required.
**Warning signs:** 400 «additionalProperties» или «required photos» при отправке формы.

### Pitfall 3: `moldType` не в `required`, но в `enum` — тихий пропуск
**What goes wrong:** Если `moldType` не обязателен, форма может отправить пустую строку — `template.moldTypes[""]` = undefined → fallback на static (face-шаблон) → молд для рук получит текст «личико куклы».
**Why it happens:** Fallback на `static` маскирует отсутствие типа.
**How to avoid:** `moldType` в `required` (CONTEXT решение №2); в форме — селект без пустого значения (дефолт `face` или принудительный выбор).
**Warning signs:** Тексты про «личико» для не-лицевых молдов (это прямо нарушает будущий TXT-02).

### Pitfall 4: фото не входит в inputHash → кэш не инвалидируется
**What goes wrong:** `handleCreateLine` (строки 196–208) пропускает шаг при совпадении inputHash. Если `photos` не попадут в `questionnaire` до хэширования — смена фото не пересоздаст карточку.
**Why it happens:** Хэш считается от `questionnaire`.
**How to avoid:** Подставить `questionnaire.photos = photoRefs` ДО вычисления `inputHash`.
**Warning signs:** `{ skipped: true }` при загрузке новых фото.

### Pitfall 5: CORS preflight для multipart
**What goes wrong:** Браузер шлёт OPTIONS перед multipart-POST; текущий `Access-Control-Allow-Headers: Content-Type` (строка 101) достаточен для FormData (браузер сам ставит `multipart/form-data; boundary=...`), но если фронтенд вручную выставит `Content-Type` в `apiFetch`, boundary потеряется.
**Why it happens:** `apiFetch` (PipelineApp:11–18) жёстко ставит `headers: { 'Content-Type': 'application/json' }`.
**How to avoid:** Для FormData НЕ ставить `Content-Type` вручную — браузер добавит boundary сам. Нужна ветка в `apiFetch` или отдельный `fetch` для формы.
**Warning signs:** Сервер видит пустые поля/файлы; busboy кидает «Missing Content-Type boundary».

## Code Examples

### Отправка FormData из React (фронтенд)
```js
// Source: MDN FormData + текущий apiFetch (PipelineApp.jsx:11) — НЕ ставить Content-Type вручную
async function submitWithPhotos(questionnaire, files) {
  const fd = new FormData();
  fd.append('questionnaire', JSON.stringify(questionnaire));
  for (const file of files) fd.append('photos', file, file.name);
  const res = await fetch(`${API_BASE}/lines`, { method: 'POST', body: fd }); // без headers!
  if (!res.ok) throw new Error(`POST /lines → ${res.status}`);
  return res.json();
}
```
Замечание: текущая форма хранит только `file.name` (`setFiles(... .map(f => f.name))`, строка 719). Нужно хранить сами `File`-объекты, чтобы приложить их в FormData.

### Загрузка фото и подстановка ссылок (сервер)
```js
// в handleCreateLine, после получения article и до inputHash
let questionnaire;
if (event.files && event.files.length) {
  questionnaire = JSON.parse(event.formFields.questionnaire);
  const refs = [];
  for (const f of event.files) {
    await store.putArtifact(questionnaire.article, 'photos', 1, f.filename, f.buffer);
    refs.push(`/lines/${questionnaire.article}/steps/photos/artifacts/${f.filename}`);
  }
  questionnaire.photos = refs;
} else {
  const raw = event.isBase64Encoded ? Buffer.from(event.body,'base64').toString('utf8') : event.body;
  questionnaire = JSON.parse(raw);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `faceSize` (только лицевые молды) | `moldSize` (любой тип) | Phase 1 | Универсализация — формула цены та же |
| `renders` (опционально) | `photos` (обязательно, ≥1) | Phase 1 | INP-01: фото — часть опросника |
| Один шаблон текста (лицо) | `moldTypes[type]` + LLM-адаптация | Phase 1 | INP-03: тип — параметр, не отдельный файл |
| `POST /lines` принимает JSON | `POST /lines` принимает multipart | Phase 1 | Нужен парсер на сервере |

**Deprecated/outdated:** ничего внешнего. Внутри проекта `renders`/`faceSize` удаляются без backward-compat (STATE: «старых данных нет»).

## Project Constraints (from CLAUDE.md)

| Directive | Влияние на план |
|-----------|------------------|
| Node.js / CommonJS, без TypeScript — не менять | `busboy` подключать через `require`; никакого TS. Подтверждено: busboy — CommonJS |
| Каждая функция — `exports.handler = async (event) => {}`, stateless | Парсинг multipart НЕ внутри handler-состояния; файлы прокидывать через `event` |
| `templateEngine.js` — только чистые функции, без I/O | Загрузку фото делать в api, не в templateEngine |
| Storage — через `versionStore`, три режима, фолбэк per-call | Фото грузить через `putArtifact`, не через прямой S3 |
| Ошибки бросать, не глотать | Ошибки busboy/загрузки фото → 400/500, не молчать |
| Именование: конфиги kebab-case.json, JS camelCase.js | Новых файлов нет; правки в существующих |
| Артефакты: `output/{article}/{step}/v{N}/{artifact}` | Фото: `output/{article}/photos/v1/{filename}` — вписывается в схему |
| GSD Workflow: правки только через GSD-команды | Это research-фаза, правок кода нет |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `busboy` — корректное имя и зрелый пакет; имя пришло из training data, версия подтверждена `npm view` | Standard Stack | Низкий: версия и отсутствие postinstall проверены; планировщику добавить `checkpoint:human-verify` перед install |
| A2 | В local-режиме artifact-путь годится как «URL фото» в `questionnaire.photos[]` для Phase 1 | Pattern 2 | Средний: если Phase 2/3 ожидают абсолютный/presigned URL, формат ссылки придётся уточнить. Для Phase 1 success criteria (создание без ошибки) — достаточно |
| A3 | `prompts.texts.json` `{{faceSize}}` стоит переименовать уже в Phase 1 | Runtime State Inventory | Низкий: CONTEXT относит промпты к решению №4 частично; если не переименовать — рассинхрон с мастер-данными проявится в Phase 2, не в Phase 1 |
| A4 | Псевдо-step для фото назвать `'photos'` (не `'00-photos'`) | Patterns | Низкий: косметика; влияет только на путь артефакта. Уточнить при планировании |
| A5 | `moldType` дефолт в форме — `face` | Pitfall 3 | Низкий: UX-выбор; CONTEXT не фиксирует дефолт |

## Open Questions

1. **Формат ссылки на фото в `questionnaire.photos[]` (local vs cloud)**
   - Что знаем: local отдаёт через `GET .../artifacts/:name`; cloud — s3-ключ.
   - Что неясно: нужен ли presigned URL для cloud уже в Phase 1.
   - Рекомендация: для Phase 1 (локальный E2E) — artifact-путь; presigned отложить.

2. **`artifacts` поле — оставить обязательным?** (CONTEXT open question №3)
   - Что знаем: schema требует `artifacts` (строка 6); форма его собирает (строки 633–638).
   - Что неясно: выводить ли из `moldType` автоматически.
   - Рекомендация: оставить как есть в Phase 1 (форма уже шлёт), не трогать — меньше изменений.

3. **Псевдо-step фото: `'photos'` vs версионирование**
   - Что знаем: артефакты версионируются (`v{N}`).
   - Что неясно: нужно ли версионировать фото или всегда `v1`.
   - Рекомендация: `v1` фиксированно для Phase 1 — перезагрузка фото = новая карточка/regenerate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (нативный fetch, streams) | весь backend | ✓ | v22.22.1 | — |
| npm | установка busboy | ✓ | (с Node 22) | — |
| `busboy` | парсинг multipart | ✗ (надо установить) | целевая ^1.6.0 | Раздельный upload-endpoint (CONTEXT фолбэк) |
| `@aws-sdk/client-s3` | загрузка фото (cloud) | ✓ (в deps) | ^3.1067.0 | local-адаптер на диск |
| Yandex Object Storage / YDB | cloud-путь | ✗ (нет ключей локально) | — | `cloud-with-fallback` → local диск (штатно) |
| Cloudflare proxy (`proxy/`) | AI-вызовы | n/a для Phase 1 | — | Не нужен в Phase 1 (тексты/картинки — Phase 2/3) |

**Missing dependencies with no fallback:** нет.
**Missing dependencies with fallback:**
- `busboy` не установлен — установить (фолбэк: раздельный endpoint, но не рекомендуется).
- Yandex Cloud ключей локально нет — штатный `cloud-with-fallback` пишет на диск; для Phase 1 E2E это ожидаемый режим.

## Validation Architecture

> `.planning/config.json` не проверялся через seam в этой сессии; тестового раннера в проекте нет (`npm test` → exit 1). Раздел включён как Wave 0-руководство.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | нет (package.json: `"test": "echo ... && exit 1"`) |
| Config file | none — см. Wave 0 |
| Quick run command | n/a (нет раннера) |
| Full suite command | n/a |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INP-03 | `computeMasterData` принимает `moldType`, считает 5 размеров независимо от типа; `moldSize` вместо `faceSize` | unit (чистая функция, без моков) | `node -e` скрипт или добавить `node:test` | ❌ Wave 0 |
| INP-03 | `moldTypes[type]` fallback на `static` при неизвестном типе | unit | как выше | ❌ Wave 0 |
| INP-01/02 | `POST /lines` с multipart (`moldType`+`photos`) создаёт карточку без ошибки | integration (curl/`node:test` + `fetch`) | `curl -F questionnaire=... -F photos=@... localhost:3001/lines` | ❌ Wave 0 |
| INP-01 | фото сохранено в `output/{article}/photos/v1/` и `questionnaire.photos[]` непусто | integration | проверка файла + ответа | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** запуск unit-теста `templateEngine` (быстрый, без I/O).
- **Per wave merge:** integration — `npm run api` + curl multipart.
- **Phase gate:** ручной E2E — отправить форму с фото через UI, увидеть карточку в списке.

### Wave 0 Gaps
- [ ] Минимальный тест-раннер: встроенный `node:test` (без новых зависимостей, Node 22 поддерживает) — covers INP-03.
- [ ] `test/templateEngine.test.js` — `moldType` параметризация + `moldSize` rename.
- [ ] Integration smoke: скрипт/curl для multipart `POST /lines` — covers INP-01/02.
- [ ] Если раннер не добавляют: фиксировать manual-only с обоснованием (проект пока без тестов).

## Security Domain

> `security_enforcement` не читался из config в этой сессии; раздел включён как baseline для загрузки файлов.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Инструмент для одной команды, auth out of scope (REQUIREMENTS) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | busboy `limits` (fileSize, files); валидация `moldType` через enum; sanitize filename перед putArtifact |
| V6 Cryptography | no | хэш только для кэша (не security); ничего не катать вручную |

### Known Threat Patterns для загрузки файлов

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal в filename (`../../etc`) | Tampering | Sanitize `info.filename` (basename, whitelist символов) перед `putArtifact` — artifactPath строит путь из имени |
| Загрузка гигантских файлов (DoS) | Denial of Service | busboy `limits: { fileSize, files }` + проверка превышения |
| Неизображения под видом фото | Tampering | Проверять `mimeType`/расширение (image/*); фронтенд уже `accept="image/*"` (CONTEXT) — продублировать на сервере |
| `moldType` вне enum | Tampering | Валидировать против `["face","hands","shoes","other"]` |

**Замечание по path traversal:** `versionStore.artifactPath` (`local`) делает `path.join(articleDir, stepId, vN, name)` — `name`-filename с `../` может выйти за пределы. Перед `putArtifact` обязательно `path.basename(filename)` + фильтр.

## Sources

### Primary (HIGH confidence)
- Прямое чтение исходников проекта: `infra/local-server.js`, `functions/api/index.js`, `layers/shared/templateEngine.js`, `layers/shared/versionStore.js`, `input/questionnaire.schema.json`, `layers/shared/config/template.master.json`, `layers/shared/config/prompts.texts.json`, `functions/step-texts/index.js`, `frontend/PipelineApp.jsx`, `frontend/vite.config.js`, `proxy/index.js`, `package.json`
- `.planning/phases/01-universal-mold-schema/CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`
- `npm view busboy version` → 1.6.0; `npm view busboy scripts.postinstall` → пусто; `npm view busboy time.modified` → 2026-04-24
- `node --version` → v22.22.1

### Secondary (MEDIUM confidence)
- Имя/назначение `busboy`, `formidable`, `@aws-sdk/lib-storage` — training knowledge, версии подтверждены npm

### Tertiary (LOW confidence)
- нет

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — одна зависимость, версия и postinstall проверены на npm
- Architecture: HIGH — весь поток выведен из прочитанного кода проекта
- Pitfalls: HIGH — все основаны на конкретных строках текущего кода
- Runtime State Inventory: HIGH — E2E не запускался, хранилища пусты (подтверждено STATE.md)

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (стабильный стек; busboy редко меняется)
