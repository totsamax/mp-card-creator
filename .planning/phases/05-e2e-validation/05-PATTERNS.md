# Phase 5: E2E Validation - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 5 (1 new test orchestrator + 2 fixtures + 2 config/ignore edits)
**Analogs found:** 5 / 5

## Файлы фазы

Phase 5 — это **тест, а не фича**. Новый код — единственный оркестрирующий `node:test`-скрипт плюс
фикстуры и две правки конфигов. Вся серверная логика переиспользуется как есть (read-only).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `test/e2e.test.js` (NEW) | test (e2e orchestrator) | request-response + polling | `test/step-error-capture.test.js` (manifest/store) + `test/create-line.smoke.test.js` (multipart) | role-match (HTTP вместо in-process handler) |
| `test/fixtures/e2e-face-mold.png` (NEW, user-supplied) | fixture | file-I/O | `test/fixtures/test-mold.png` | exact (но реальное фото, не 1×1) |
| `test/fixtures/e2e-face-questionnaire.json` (NEW, optional) | fixture | transform | `buildQuestionnaire()` в `test/step-error-capture.test.js:26` | exact |
| `package.json` (MODIFY) | config | — | существующий `scripts.test` | exact |
| `.gitignore` (MODIFY) | config | — | существующие записи (`output/`, `test/tmp-output/`) | exact |

## Pattern Assignments

### `test/e2e.test.js` (test, request-response + polling)

Главный новый файл. Гибридный аналог: структуру теста и работу с манифестом/store берём из
`step-error-capture.test.js`, паттерн multipart-загрузки — из `create-line.smoke.test.js`, но
взаимодействие идёт через **живой HTTP-сервер** (а не in-process `handler`), как требует D-07.

**КРИТИЧЕСКОЕ расхождение в коде, влияющее на план (poll-семантика для images):**
`functions/api/index.js:12` объявляет `IMAGE_TYPES = ['infographic']` (ОДИН тип), значит
`POST .../03-images/regenerate` порождает ровно **5 сообщений** (5 размеров × 1 тип) и пишет
**5 артефактов** `{size}_infographic.png`. Но фронтенд `computeStepStatus`
(`frontend/PipelineApp.jsx:440`) считает `total = lineSizes.length * 4` — это **легаси-хвост**
(когда-то было 4 типа). НЕ копировать множитель `*4`: для images «готово» = **5 различных
`{size}_infographic.png`**, не 20. Для texts «готово» = **5 `{size}_texts.json`**.

**Test setup pattern** (источник `test/step-error-capture.test.js:7-9`, `create-line.smoke.test.js:7-9`):
```javascript
// E2E пишет в ИЗОЛИРОВАННЫЙ OUTPUT_DIR — НЕ tmp-output (unit) и НЕ production ./output/
process.env.STORE_ADAPTER = 'local';
// OUTPUT_DIR/SHARED_LAYER_PATH/OPENAI_API_KEY наследуются дочерним сервером через spawn env
```
> Отличие от unit-тестов: здесь env прокидывается в **дочерний процесс** сервера (см. ниже),
> а не в `process.env` текущего процесса, потому что хэндлеры исполняются в spawned-сервере.

**Спавн живого сервера + wait-for-port** (источник `infra/local-server.js:45` PORT, `:150` listen):
```javascript
const { spawn } = require('node:child_process');
const net = require('node:net');
const server = spawn('node', [path.resolve(__dirname, '../infra/local-server.js')], {
  env: {
    ...process.env,                 // наследует реальный OPENAI_API_KEY (D-01)
    PORT: '3101',                   // отдельный порт — НЕ 3001 (конфликт с dev)
    STORE_ADAPTER: 'local',
    OUTPUT_DIR: path.join(__dirname, 'e2e-output'),
    SHARED_LAYER_PATH: path.resolve(__dirname, '../layers/shared'),
  },
  stdio: 'inherit',                 // прогресс шагов виден в выводе теста (specifics)
});
// wait-for-port: net.createConnection(3101) с ретраями до connect; гарантированный kill в after()
// Фолбэк D-07: если задан E2E_BASE_URL — использовать запущенный сервер, не спавнить.
```
> `infra/local-server.js:38` НЕ перезаписывает уже заданные env-переменные при чтении `.env.local`
> → переданный через spawn `PORT=3101`/`OUTPUT_DIR` имеют приоритет над `.env.local`. VERIFIED.

**Multipart POST /lines** (источник `create-line.smoke.test.js:14-50`, но через `fetch`+`FormData`):
```javascript
// Smoke-тест шлёт in-process event.files; E2E через HTTP шлёт настоящий FormData,
// который infra/local-server.js:63 распарсит busboy в event.files (тот же контракт).
const photo = fs.readFileSync(path.join(__dirname, 'fixtures/e2e-face-mold.png'));
const fd = new FormData();
fd.append('questionnaire', JSON.stringify(questionnaire));   // string field (api/index.js:198)
fd.append('photo', new Blob([photo], { type: 'image/png' }), 'e2e-face-mold.png');
// БЕЗ ручного Content-Type — undici выставит boundary сам (как step-images:216)
const res = await fetch(`${baseUrl}/lines`, { method: 'POST', body: fd });
// Ожидаем 200 (НЕ 201 — api/index.js:284 возвращает respond(200,...)) + body.stepId==='01-normalize'
```
> ⚠️ D-08 в CONTEXT упоминает «→ 201», но `api/index.js:284` возвращает **200**. Ассертить 200.
> Фото должно пройти magic-bytes guard (`api/index.js:217 isImageBuffer`) — реальный PNG проходит,
> 1×1 заглушка (69 байт) тоже проходит по байтам, но провалит проверку размера картинки (Pitfall 2).

**Запуск шагов** (источник `api/index.js:140-149` маршруты, `:367` force-дефолт):
```javascript
// POST /lines/:id/steps/:step/regenerate. Тело {} достаточно — force дефолтит true (api:367).
// Sync шаги (01-normalize не нужен — создан через POST /lines; 05-excel, 06-assemble) → 200.
// Async шаги (02-texts, 03-images) → 202 fire-and-forget, результат поллим.
await fetch(`${baseUrl}/lines/${article}/steps/02-texts/regenerate`, { method: 'POST' });   // 202
await fetch(`${baseUrl}/lines/${article}/steps/03-images/regenerate`, { method: 'POST' });  // 202
await fetch(`${baseUrl}/lines/${article}/steps/05-excel/regenerate`, { method: 'POST' });   // 200
await fetch(`${baseUrl}/lines/${article}/steps/06-assemble/regenerate`, { method: 'POST' });// 200
```

**Poll по artifact-count + error (НЕ по status)** (источник `frontend/PipelineApp.jsx:418-444`
computeStepStatus + `api/index.js:73` запись error + `:307` artifacts в GET /steps):
```javascript
// В манифесте НЕТ поля status. "Упал" = steps[stepId].error непустой (api/index.js:73).
// "Готово" = число артефактов последней версии == 5. ОШИБКУ проверять ПЕРЕД артефактами (Pitfall 3).
async function pollStep(baseUrl, article, stepId, { expect, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = await (await fetch(`${baseUrl}/lines/${article}/manifest`)).json();
    const meta = m.steps?.[stepId];
    if (meta?.error) throw new Error(`${stepId} failed: ${meta.error} @ ${meta.failedAt}`);
    if (meta?.currentVersion) {
      const step = await (await fetch(`${baseUrl}/lines/${article}/steps/${stepId}`)).json();
      const n = (step.artifacts || []).length;       // api/index.js:307 returns artifacts[]
      console.log(`[e2e] ${stepId}: ${n}/${expect} артефактов...`);
      if (n >= expect) return m;
    }
    await new Promise(r => setTimeout(r, 5000));      // 5s — как UI setInterval
  }
  throw new Error(`${stepId} timed out after ${timeoutMs}ms`);
}
// 02-texts: { expect: 5, timeoutMs: 5*60*1000 }
// 03-images: { expect: 5, timeoutMs: 10*60*1000 }   ← expect=5, НЕ 20 (IMAGE_TYPES=['infographic'])
```

**Валидация артефактов на диске** (источник D-02 + точные имена из шагов):
```javascript
// Версии брать из manifest.steps[stepId].currentVersion после polling — НЕ хардкодить.
// Имена артефактов VERIFIED из исходников шагов:
//   01-normalize: master-data.json                       (api/index.js:276)
//   02-texts:     {size}_texts.json   ×5                 (step-texts/index.js:73)
//   03-images:    {size}_infographic.png ×5              (step-images STEP_ID + IMAGE_TYPES)
//   05-excel:     {article}_ozon.xlsx, {article}_wb.xlsx (step-excel/index.js:16 FILE_NAMES)
//   06-assemble:  assemble-report.json                   (step-assemble/index.js:63)
function artifactPath(stepId, version, name) {
  return path.join(OUTPUT_DIR, article, stepId, `v${version}`, name);
}
// 1. texts: нет нераскрытых {{...}}
const blob = fs.readFileSync(artifactPath('02-texts', txtVer, `${size}_texts.json`), 'utf8');
assert.ok(!/\{\{.*?\}\}/.test(blob), `${size}: нераскрытый плейсхолдер`);
// 2. PNG > порога — НЕ 1×1-заглушка ~70 байт (Pitfall 2: stub маскирует сбой как успех)
assert.ok(fs.statSync(artifactPath('03-images', imgVer, `${size}_infographic.png`)).size > 1000);
// 3. xlsx открывается без ошибок
const wb = new (require('exceljs')).Workbook();
await wb.xlsx.readFile(artifactPath('05-excel', xlsxVer, `${article}_ozon.xlsx`));  // throws if corrupt
assert.ok(wb.worksheets.length > 0);
```
> ⚠️ `06-assemble` НЕ копирует файлы в плоскую папку — пишет `assemble-report.json` со ссылками
> (`step-assemble/index.js:50-64`). Проверять артефакты по step-папкам + наличие
> `completedSteps` в report, НЕ ожидать плоскую выгрузку.

**Error-meta семантика** (источник `test/step-error-capture.test.js:108-114`):
```javascript
// Точный shape ошибки в манифесте — скопировать ассерт-стиль из step-error-capture:
const stepMeta = manifest.steps['02-texts'];
// stepMeta.error: непустая строка; stepMeta.failedAt: ISO-таймстемп (ISO_RE на :77)
// Успех очищает их в null (step-error-capture:166-169) — done-шаг не имеет error.
```

---

### `test/fixtures/e2e-face-questionnaire.json` (fixture, transform)

**Analog:** `buildQuestionnaire()` в `test/step-error-capture.test.js:26-48` (и идентичный в smoke-тесте).

Скопировать форму опросника, поменяв `moldType: 'face'` (D-03) и уникальный `article` (D-05).
Уникальность article на каждый прогон критична — иначе cache-hit по inputHash вернёт `skipped:true`
(`api/index.js:259`, Pitfall 5). Генерировать `e2e-test-${YYYYMMDD-HHMMSS}` в рантайме либо хранить
шаблон в фикстуре и подставлять article в тесте.

```javascript
// VERIFIED required-форма из smoke + error-capture тестов (оба прошли):
{ article, moldType:'face', moldName, brand, theme, color, priceBaseM,
  sizes:[{size,moldSize,moldLength,moldWidth,moldHeight,moldWeight} ×5], photos:[] }
```
> ⚠️ [ASSUMED — RESEARCH A1] CONTEXT D-03 упоминает поля `faceSize/poraType/faceOval`, но
> `input/questionnaire.schema.json` их не содержит, а smoke-тест без них прошёл. Планировщик
> должен свериться с `layers/shared/config/template.master.json` (`moldTypes.face`): если поля
> влияют на тексты/картинки — добавить в фикстуру; иначе универсальной схемы достаточно.

---

### `test/fixtures/e2e-face-mold.png` (fixture, file-I/O) — user-supplied

**Analog:** `test/fixtures/test-mold.png` (69 байт, 1×1 — НЕ годится для реальной генерации).

D-04: пользователь кладёт **реальное фото** лицевого молда перед прогоном. План должен включить
preflight-чек «фикстура существует И размер > N байт (напр. > 1000)» с понятным fail-сообщением —
иначе Images Edits API получит мусорный reference (Pitfall 6).

---

### `package.json` (config) — добавить test:e2e script

**Analog:** существующий `"test": "node --test 'test/**/*.test.js'"`.

```json
{ "scripts": {
    "test":     "node --test 'test/**/*.test.js'",
    "test:e2e": "node --test test/e2e.test.js"
} }
```
> ⚠️ Glob `test/**/*.test.js` подхватит `e2e.test.js` и на обычном `npm test` — а это платные
> реальные OpenAI-вызовы (D-01). Защита (RESEARCH рекомендация, A2): skip-guard в начале файла —
> `if (!process.env.RUN_E2E) { test('e2e (skipped)', { skip: true }, () => {}); return; }` —
> виден в наборе, но не гонится без `RUN_E2E=1`. Финальный механизм — за планировщиком (D-06).

---

### `.gitignore` (config) — изолировать E2E-output и не коммитить секреты

**Analog:** существующие записи `output/`, `test/tmp-output/` (см. git status).

Добавить `test/e2e-output/`. Реальное фото-фикстуру и `.env.local` НЕ коммитить (секрет
`OPENAI_API_KEY` — V7/V14, Information Disclosure).

---

## Shared Patterns

### Изоляция хранилища (local adapter)
**Источник:** `test/step-error-capture.test.js:7-9`, CLAUDE.md (STORE_ADAPTER)
**Применить к:** всему E2E
```javascript
STORE_ADAPTER=local                       // без облака, без YDB/S3
OUTPUT_DIR=test/e2e-output                // изолировано от ./output/ и test/tmp-output/
```
Дочерний сервер наследует это через `spawn({ env })`. local-server.js:38 не перетирает заданные env.

### Имена артефактов (единый источник истины)
**Источник:** STEP_ID + FILE_NAMES в каждом шаге
**Применить к:** валидации
| Шаг | Папка | Артефакты | Кол-во |
|-----|-------|-----------|--------|
| 01-normalize | `01-normalize/v{N}/` | `master-data.json` | 1 |
| 02-texts | `02-texts/v{N}/` | `{size}_texts.json` | 5 |
| 03-images | `03-images/v{N}/` | `{size}_infographic.png` | 5 |
| 05-excel | `05-excel/v{N}/` | `{article}_ozon.xlsx`, `{article}_wb.xlsx` | 2 |
| 06-assemble | `06-assemble/v{N}/` | `assemble-report.json` | 1 |

### Готовность/падение async-шага (НЕТ status-поля)
**Источник:** `frontend/PipelineApp.jsx:418-444`, `api/index.js:73`
**Применить к:** обоим async-шагам
- Падение = `manifest.steps[stepId].error` непустой → бросить сразу (ПЕРЕД проверкой артефактов).
- Готово = artifact-count последней версии >= 5.
- `currentVersion` берётся из `manifest.steps[stepId].currentVersion` для путей валидации.

### Секреты
**Источник:** `infra/local-server.js:34-42` (.env.local), RESEARCH Security Domain
**Применить к:** всему E2E
`OPENAI_API_KEY` читать только из env/`.env.local`, НЕ хардкодить, НЕ логировать. Preflight-чек:
если ключ не задан — понятный fail/skip (D-01 требует реальный ключ, без него step-images уйдёт
в 1×1 stub — Pitfall 2).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (нет) | — | — | Все нужные паттерны существуют в кодовой базе. Спавн живого сервера child_process — новый для тестов проекта (unit-тесты зовут handler in-process), но строится на стандартном `node:child_process` + готовом `infra/local-server.js`. Аналог-источник env-контракта: `infra/local-server.js:45,150`. |

## Metadata

**Analog search scope:** `test/`, `functions/api/`, `functions/step-*/`, `infra/`, `frontend/`
**Files scanned:** 8 (create-line.smoke, step-error-capture, api/index, local-server, step-texts,
step-images, step-excel, step-assemble) + PipelineApp.jsx computeStepStatus
**Pattern extraction date:** 2026-06-23
