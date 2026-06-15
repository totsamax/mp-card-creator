# Phase 1: Universal Mold Schema — Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 6
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `input/questionnaire.schema.json` | config/schema | — | itself (edit, no analog needed) | self |
| `layers/shared/config/template.master.json` | config/data | — | itself (edit, no analog needed) | self |
| `layers/shared/templateEngine.js` | utility | transform | itself (edit existing pattern) | self |
| `functions/api/index.js` | controller | request-response | itself `handleCreateLine` (lines 181–231) | self |
| `infra/local-server.js` | middleware/adapter | request-response | itself (lines 47–95) | self |
| `frontend/PipelineApp.jsx` | component | request-response | itself `QuestionnaireForm` (lines 610–740) | self |

> Все 6 файлов — правки в существующих файлах. Новых файлов Phase 1 не создаёт. Аналог каждого — сам файл.

---

## Pattern Assignments

---

### `input/questionnaire.schema.json` (config, schema)

**Analog:** сам файл (`input/questionnaire.schema.json`)

**Текущий паттерн — структура schema** (строки 1–10):
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MoldQuestionnaire",
  "type": "object",
  "required": ["moldName", "article", "brand", "theme", "color", "priceBaseM", "sizes", "artifacts"],
  "additionalProperties": false,
  "properties": { ... }
}
```

**Текущий паттерн — свойство типа enum** (строки 49–52):
```json
"size": {
  "type": "string",
  "enum": ["XS", "S", "M", "L", "XL"]
}
```

**Текущий паттерн — числовое поле с ограничением** (строки 53–57):
```json
"faceSize": {
  "type": "number",
  "exclusiveMinimum": 0,
  "description": "Размер личика, см"
}
```

**Что менять:**
1. `sizes.items.required` строка 46: заменить `"faceSize"` → `"moldSize"`.
2. `sizes.items.properties`: переименовать ключ `faceSize` → `moldSize`, обновить `description` → `"Характерный размер молда, см"`.
3. Добавить поле `moldType` в `properties` (после `color`), скопировать паттерн enum-поля:
   ```json
   "moldType": {
     "type": "string",
     "enum": ["face", "hands", "shoes", "other"],
     "description": "Тип молда — определяет шаблонные тексты и топик"
   }
   ```
4. Добавить `"moldType"` в корневой `required` массив (строка 6).
5. Заменить блок `renders` (строки 81–90) → `photos` с `minItems: 1`, `maxItems: 10`.
6. Добавить `"photos"` в корневой `required` (убрать или оставить `"artifacts"` — решить при планировании, CONTEXT open question №3).

---

### `layers/shared/config/template.master.json` (config/data)

**Analog:** сам файл (`layers/shared/config/template.master.json`)

**Текущий паттерн — computedFields** (строки 5–11):
```json
"computedFields": {
  "weightPacked":  "moldWeight + 40",
  "priceBase":     "round(priceBaseM * (faceSize / faceSizeM), 10)",
  "priceDiscount": "priceBase * 0.75",
  "toyFrom":       "faceSize * 4",
  "toyTo":         "faceSize * 8"
}
```

**Что менять в computedFields:**
- `"priceBase"`: `faceSize / faceSizeM` → `moldSize / moldSizeM`
- `"toyFrom"`: `faceSize * 4` → `moldSize * 4`
- `"toyTo"`: `faceSize * 8` → `moldSize * 8`

**Текущий паттерн — textTemplates** (строки 13–17):
```json
"textTemplates": {
  "titleShort": "Молд «{{moldName}}» {{faceSize}}см #{{brand}}",
  "titleFull":  "Молд силиконовый для ватной игрушки «{{moldName}}», форма для личика куклы, ...",
  "annotation": "Авторский силиконовый молд для отливки личика ватной игрушки или куклы. ..."
}
```

**Что менять в textTemplates:**
- `titleShort`: `{{faceSize}}` → `{{moldSize}}`
- `titleFull` и `annotation`: заменить на нейтральные placeholder-ы (конкретные тексты переезжают в `moldTypes[type]`)

**Добавить новую секцию `moldTypes`** (после блока `static`), копируя структуру по образцу из CONTEXT.md §4:
```json
"moldTypes": {
  "face": {
    "topic":    "Личико малыша, лицо ребёнка",
    "purpose":  "Для кукол, ватных игрушек, рукоделия",
    "titleFull": "Молд силиконовый для ватной игрушки «{{moldName}}», форма для личика куклы, {{moldLength}}x{{moldWidth}}x{{moldHeight}} см, {{brand}}",
    "annotation": "Авторский силиконовый молд для отливки личика ватной игрушки или куклы."
  },
  "hands": { ... },
  "shoes": { ... },
  "other": { ... }
}
```

---

### `layers/shared/templateEngine.js` (utility, transform)

**Analog:** сам файл (`layers/shared/templateEngine.js`)

**Текущий паттерн — импорты и экспорт** (строки 1, 106):
```js
'use strict';
// ... pure functions ...
module.exports = { computeMasterData, round, evalExpr, renderText };
```

**Текущий паттерн — деструктуризация questionnaire + template** (строки 49–51):
```js
function computeMasterData(questionnaire, template) {
  const { moldName, article, brand, theme, color, priceBaseM, sizes: sizeRows } = questionnaire;
  const { baseSizeKey, computedFields, textTemplates, static: staticFields } = template;
```

**Текущий паттерн — базовый размер** (строки 56–58):
```js
const baseRow = sizeByKey[baseSizeKey];
if (!baseRow) throw new Error(`Base size "${baseSizeKey}" not found in questionnaire.sizes`);
const faceSizeM = baseRow.faceSize;   // ← ПЕРЕИМЕНОВАТЬ: faceSize → moldSize, faceSizeM → moldSizeM
```

**Текущий паттерн — контекст вычисления** (строки 64–74):
```js
const ctx = {
  ...physicalRow,
  moldName, article, brand, theme, color, priceBaseM,
  faceSizeM,   // ← ПЕРЕИМЕНОВАТЬ в moldSizeM
};
```

**Текущий паттерн — рендер текстов через renderText** (строки 82–85):
```js
for (const [field, tmpl] of Object.entries(textTemplates)) {
  texts[field] = renderText(tmpl, ctx);
}
```

**Что добавить — moldType fallback** (вставить после строки 51, перед строкой 56):
```js
// Выбрать конфиг типа молда (с fallback на static/textTemplates)
const typeCfg = (template.moldTypes && questionnaire.moldType)
  ? template.moldTypes[questionnaire.moldType]
  : null;

const titleFullTmpl  = typeCfg?.titleFull  ?? template.textTemplates.titleFull;
const annotationTmpl = typeCfg?.annotation ?? template.textTemplates.annotation;
const topic   = typeCfg?.topic   ?? template.static.topic;
const purpose = typeCfg?.purpose ?? template.static.purpose;
```

**Изменить рендер текстов** — для `titleFull` и `annotation` использовать `typeCfg`-шаблоны, для остальных — оригинальный цикл:
```js
// Рендер текстов — titleFull и annotation берём из moldTypes или textTemplates
for (const [field, tmpl] of Object.entries(template.textTemplates)) {
  const src = field === 'titleFull'   ? titleFullTmpl
            : field === 'annotation'  ? annotationTmpl
            : tmpl;
  texts[field] = renderText(src, ctx);
}
```

**Добавить `topic` и `purpose` в возвращаемую запись** (строки 87–103) — скопировать паттерн spread:
```js
return {
  ...physicalRow,
  moldName, article, brand, theme, color, priceBaseM,
  topic,    // ← новое
  purpose,  // ← новое
  weightPacked:  ctx.weightPacked,
  priceBase:     ctx.priceBase,
  priceDiscount: ctx.priceDiscount,
  toyFrom:       ctx.toyFrom,
  toyTo:         ctx.toyTo,
  ...texts,
  ...staticFields,
};
```

---

### `functions/api/index.js` → `handleCreateLine` (controller, request-response)

**Analog:** сам файл, функция `handleCreateLine` (строки 181–231)

**Текущий паттерн — парсинг тела запроса** (строки 182–190):
```js
async function handleCreateLine(event) {
  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }
```

**Что добавить — ветка multipart** (вставить В НАЧАЛО `handleCreateLine`, до текущего `let body`):
```js
// Ветка multipart/form-data (event.files проставляется local-server.js после busboy-парсинга)
let questionnaire, force;
if (event.files && event.files.length > 0) {
  try {
    questionnaire = JSON.parse(event.formFields?.questionnaire || '{}');
  } catch {
    return respond(400, { error: 'Invalid questionnaire JSON in form field' });
  }
  force = event.formFields?.force === 'true';

  // Сохранить фото через versionStore (путь: {article}/photos/v1/{filename})
  const photoRefs = [];
  for (const f of event.files) {
    const safeName = require('path').basename(f.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    await store.putArtifact(questionnaire.article, 'photos', 1, safeName, f.buffer);
    photoRefs.push(`/lines/${questionnaire.article}/steps/photos/artifacts/${safeName}`);
  }
  questionnaire.photos = photoRefs; // подставить ДО inputHash
} else {
  // Существующий JSON-путь
  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }
  ({ force = false, ...questionnaire } = body);
}
```

**Текущий паттерн — inputHash + кэш** (строки 196–208):
```js
const inputHash = crypto.createHash('sha256')
  .update(JSON.stringify({ questionnaire, templateVersion: template }))
  .digest('hex');
// ... cache check ...
```
> Фото должны быть в `questionnaire.photos` ДО этого кода — они автоматически войдут в хэш.

**Текущий паттерн — putArtifact + updateManifest** (строки 220–228):
```js
await store.putArtifact(
  article, '01-normalize', nextVersion,
  'master-data.json',
  Buffer.from(JSON.stringify(masterData, null, 2))
);
await store.updateManifest(article, '01-normalize', {
  currentVersion: nextVersion,
  history: [...(stepMeta?.history ?? []), historyEntry],
});
```
> Для фото тот же `putArtifact` с `stepId = 'photos'` — паттерн идентичен.

**Текущий паттерн — respond** (конец handleCreateLine):
```js
return respond(200, { article, stepId: '01-normalize', version: nextVersion, masterData });
```

---

### `infra/local-server.js` (middleware/adapter, request-response)

**Analog:** сам файл (`infra/local-server.js`)

**Текущий паттерн — обработчик запроса** (строки 47–95):
```js
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // Collect request body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString() || null;

  // Build event matching YC API Gateway format
  const event = {
    httpMethod:            req.method,
    url:                   url.pathname,
    path:                  url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers:               req.headers,
    body:                  rawBody,
    isBase64Encoded:       false,
  };
  // ...
}).listen(PORT, ...);
```

**Что добавить** — заменить блок "Collect request body" на ветвление по Content-Type:

```js
// Collect request body — с ветвлением на multipart
const ct = req.headers['content-type'] || '';
let event;

if (ct.startsWith('multipart/form-data')) {
  // busboy парсит поток в память; handler получает formFields + files
  const Busboy = require('busboy');
  const { fields, files } = await new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
    const fields = {}; const files = [];
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => files.push({
        field: name,
        filename: info.filename,
        mimeType: info.mimeType,
        buffer: Buffer.concat(chunks),
      }));
    });
    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
  event = {
    httpMethod:            req.method,
    url:                   url.pathname,
    path:                  url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers:               req.headers,
    formFields:            fields,   // ← новое поле
    files,                           // ← новое поле
    body:                  null,
    isBase64Encoded:       false,
  };
} else {
  // Существующий JSON-путь (строки 57–70 без изменений)
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString() || null;
  event = {
    httpMethod:            req.method,
    url:                   url.pathname,
    path:                  url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers:               req.headers,
    body:                  rawBody,
    isBase64Encoded:       false,
  };
}
```

**Паттерн require busboy** — в начале файла рядом с другими require (строки 10–12):
```js
const http = require('http');
const path = require('path');
const fs   = require('fs');
// busboy подключать lazy через require('busboy') внутри ветки, не на верхнем уровне
// (или добавить в верхние require после npm install)
```

---

### `frontend/PipelineApp.jsx` → `QuestionnaireForm` (component, request-response)

**Analog:** сам файл, компонент `QuestionnaireForm` (строки 610–740)

**Текущий паттерн — state формы** (строки 611–616):
```js
function QuestionnaireForm({ onSubmit, loading }) {
  const [form, setForm] = useState({
    moldName: '', article: '', brand: 'ТопМолд', theme: '', color: '', priceBaseM: 1000,
    sizes: ALL_SIZES.map(size => ({ size, ...SIZE_DEFAULTS[size] })),
    artifacts: { images: true, video: true, ozon: true, wb: true },
  });
  const [files, setFiles] = useState([]);
```

**Что добавить в начальный state:**
```js
const [form, setForm] = useState({
  moldName: '', article: '', brand: 'ТопМолд', theme: '', color: '', priceBaseM: 1000,
  moldType: 'face',   // ← новое поле с дефолтом
  sizes: ALL_SIZES.map(size => ({ size, ...SIZE_DEFAULTS[size] })),
  artifacts: { images: true, video: true, ozon: true, wb: true },
});
const [photoFiles, setPhotoFiles] = useState([]);  // хранить File-объекты, не имена
```

**Текущий паттерн — SIZE_DEFAULTS и SIZE_FIELDS** (строки 594–608):
```js
const SIZE_DEFAULTS = {
  XS: { faceSize: 2, moldLength: 3, ... },   // ← faceSize → moldSize
  ...
};
const SIZE_FIELDS = [
  { key: 'faceSize', label: 'Личико, см' },  // ← faceSize → moldSize, label → 'Размер, см'
  { key: 'moldLength', label: 'Длина, см' },
  ...
];
```

**Текущий паттерн — buildQuestionnaire** (строки 625–639):
```js
const buildQuestionnaire = () => ({
  moldName:   form.moldName,
  article:    form.article,
  brand:      form.brand,
  theme:      form.theme,
  color:      form.color,
  priceBaseM: Number(form.priceBaseM),
  sizes:      form.sizes,
  artifacts:  [...].filter(Boolean),
});
```

**Что добавить в buildQuestionnaire:**
```js
moldType: form.moldType,   // ← новое поле
// photos НЕ добавлять сюда — файлы идут отдельно в FormData
```

**Текущий паттерн — apiFetch** (строки 11–17):
```js
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  ...
}
```

**Паттерн отправки FormData — НЕ использовать apiFetch** (браузер сам выставит boundary):
```js
// Отдельная функция для multipart — без headers: { 'Content-Type': ... }
async function submitQuestionnaire(questionnaire, files) {
  const fd = new FormData();
  fd.append('questionnaire', JSON.stringify(questionnaire));
  for (const file of files) fd.append('photos', file, file.name);
  const res = await fetch(`${API_BASE}/lines`, { method: 'POST', body: fd });
  // НЕ ставить Content-Type вручную — браузер добавит boundary сам
  if (!res.ok) throw new Error(`POST /lines → ${res.status}`);
  return res.json();
}
```

**Текущий паттерн — input элемент формы** (строки 647–655):
```jsx
<div>
  <label className="pp-label">Имя молда</label>
  <input className="pp-input" placeholder="напр. Василиса"
    value={form.moldName} onChange={(e) => set('moldName', e.target.value)} />
</div>
```

**Паттерн для select (moldType)** — скопировать CSS-классы из существующей формы:
```jsx
<div>
  <label className="pp-label">Тип молда</label>
  <select className="pp-select" value={form.moldType}
    onChange={(e) => set('moldType', e.target.value)}>
    <option value="face">Лицо</option>
    <option value="hands">Руки</option>
    <option value="shoes">Обувь</option>
    <option value="other">Другое</option>
  </select>
</div>
```

**Паттерн для file input (photos):**
```jsx
<div>
  <label className="pp-label">Фото молда</label>
  <input type="file" multiple accept="image/*" className="pp-input"
    onChange={(e) => setPhotoFiles(Array.from(e.target.files))} />
  {photoFiles.length > 0 && (
    <span className="text-xs pp-muted">{photoFiles.length} файл(ов) выбрано</span>
  )}
</div>
```

---

## Shared Patterns

### CommonJS / 'use strict'
**Source:** `infra/local-server.js:1`, `functions/api/index.js:1`, `layers/shared/templateEngine.js:1`
**Apply to:** все backend-файлы
```js
'use strict';
// ...
module.exports = { ... };  // или exports.handler = ...
```

### Error handling pattern — respond(400/500)
**Source:** `functions/api/index.js:142–145` и `188–190`
**Apply to:** `handleCreateLine` при обработке multipart-ошибок
```js
try {
  // ...
} catch (err) {
  console.error('[api] unhandled error:', err);
  return respond(500, { error: err.message });
}
// или для клиентских ошибок:
return respond(400, { error: 'Invalid questionnaire JSON in form field' });
```

### putArtifact + updateManifest pattern
**Source:** `functions/api/index.js:220–228`
**Apply to:** сохранение фото в `handleCreateLine`
```js
await store.putArtifact(article, 'photos', 1, safeName, buffer);
// (updateManifest для photos не нужен — фото просто кладутся, ссылки в questionnaire)
```

### renderText + evalExpr — не менять движок
**Source:** `layers/shared/templateEngine.js:18–39`
**Apply to:** изменения в `computeMasterData` — только источник шаблона меняется, не сам вызов
```js
texts[field] = renderText(tmpl, ctx);  // вызов остаётся тем же
```

---

## No Analog Found

Все изменения Phase 1 — правки существующих файлов. Файлов без аналога нет.

---

## Critical Constraints Reminder (из CLAUDE.md)

| Constraint | Влияние на правки |
|------------|-------------------|
| CommonJS везде | `const Busboy = require('busboy')` — не `import` |
| `templateEngine.js` — только чистые функции, без I/O | Загрузку фото делать в `api/index.js`, не в `templateEngine` |
| Фото грузить через `store.putArtifact` | Не писать прямой S3-код в api |
| Ошибки бросать, не глотать | busboy-ошибки → `reject(err)` → 500 в обработчике |
| FormData из браузера — без `Content-Type` вручную | Отдельный `fetch` для формы, не через `apiFetch` |
| `path.basename(filename)` перед `putArtifact` | Защита от path traversal в именах файлов |

---

## Metadata

**Analog search scope:** `infra/`, `functions/api/`, `layers/shared/`, `input/`, `frontend/`
**Files read:** 7 (local-server.js, api/index.js ×2, templateEngine.js, versionStore.js ×1, questionnaire.schema.json, template.master.json, PipelineApp.jsx ×2)
**Pattern extraction date:** 2026-06-15
