---
phase: 1
title: Universal Mold Schema
status: ready-to-plan
discussed: 2026-06-15
requirements: INP-01, INP-02, INP-03
---

# Phase 1 Context: Universal Mold Schema

## Phase Goal

Сделать схему данных универсальной — чтобы пайплайн работал не только с лицевыми молдами, но и с руками, обувью, любым другим типом. Три файла меняются: `questionnaire.schema.json`, `template.master.json`, `frontend/PipelineApp.jsx` (форма создания карточки).

---

## Locked Decisions

### 1. faceSize → moldSize (INP-02, INP-03)

**Решение:** переименовать `faceSize` в `moldSize` во всех файлах. Backward-compatibility не нужна — проект в разработке, старых данных нет.

**Затронутые места:**
- `input/questionnaire.schema.json` → в `sizes.items.properties`: поле `faceSize` → `moldSize`, описание "Характерный размер молда, см"
- `input/questionnaire.schema.json` → в `sizes.items.required`: заменить `faceSize` на `moldSize`
- `layers/shared/config/template.master.json` → `computedFields.priceBase`: `faceSize / faceSizeM` → `moldSize / moldSizeM`
- `layers/shared/config/template.master.json` → `computedFields.toyFrom/toyTo`: `faceSize * 4 / 8` → `moldSize * 4 / 8`
- `layers/shared/config/template.master.json` → `textTemplates`: все `{{faceSize}}` → `{{moldSize}}`
- `layers/shared/templateEngine.js` → проверить, нет ли хардкода `faceSize` в коде (формулы читаются из JSON, но проверить)

**Формула цены остаётся той же логикой:** `round(priceBaseM * (moldSize / moldSizeM), 10)`

---

### 2. moldType — новое поле опросника (INP-02)

**Решение:** добавить обязательное поле `moldType` в `questionnaire.schema.json`.

```json
"moldType": {
  "type": "string",
  "enum": ["face", "hands", "shoes", "other"],
  "description": "Тип молда — определяет шаблонные тексты и топик"
}
```

Добавить `"moldType"` в `required` массив схемы.

---

### 3. renders → photos, сделать обязательным (INP-01)

**Решение:** переименовать `renders` → `photos`, сделать обязательным, изменить описание.

```json
"photos": {
  "type": "array",
  "description": "URL фотографий молда в Object Storage (≥1, разные ракурсы)",
  "minItems": 1,
  "maxItems": 10,
  "items": { "type": "string", "minLength": 1 }
}
```

Добавить `"photos"` в `required` массив. Убрать `"artifacts"` из required (или оставить — уточнить при планировании).

**Загрузка фото:**
- `POST /lines` принимает `multipart/form-data` (не JSON)
- Поля формы: все поля опросника + файлы под ключом `photos[]`
- Сервер: сначала загружает каждый файл в Yandex Object Storage (`{article}/photos/{filename}`), получает URL, подставляет URL в `questionnaire.photos[]`
- После загрузки — обычный flow: `computeMasterData` → сохранить артефакт
- `infra/local-server.js` — нужен парсинг multipart (библиотека `busboy` или `formidable`, уже в node_modules?)
- В `functions/api/index.js` → `handleCreateLine` — принять multipart, загрузить файлы, собрать questionnaire

---

### 4. template.master.json — moldTypes секция + LLM для вариаций (INP-03)

**Решение:** добавить секцию `moldTypes` в `template.master.json`. Каждый тип даёт базовые значения для `topic`, `purpose`, и шаблоны текстов. LLM в `step-texts` использует эти значения как контекст и адаптирует под конкретный молд (тему, цвет, название).

**Структура добавляемой секции:**

```json
"moldTypes": {
  "face": {
    "topic":    "Личико малыша, лицо ребёнка",
    "purpose":  "Для кукол, ватных игрушек, рукоделия",
    "titleFull": "Молд силиконовый для ватной игрушки «{{moldName}}», форма для личика куклы, {{moldLength}}x{{moldWidth}}x{{moldHeight}} см, {{brand}}",
    "annotation": "Авторский силиконовый молд для отливки личика ватной игрушки или куклы."
  },
  "hands": {
    "topic":    "Руки куклы, кисти рук",
    "purpose":  "Для кукол, ватных игрушек, рукоделия",
    "titleFull": "Молд силиконовый «{{moldName}}», форма для рук куклы, {{moldLength}}x{{moldWidth}}x{{moldHeight}} см, {{brand}}",
    "annotation": "Авторский силиконовый молд для отливки рук ватной игрушки или куклы."
  },
  "shoes": {
    "topic":    "Обувь для куклы, ботиночки",
    "purpose":  "Для кукол, ватных игрушек, рукоделия",
    "titleFull": "Молд силиконовый «{{moldName}}», форма для обуви куклы, {{moldLength}}x{{moldWidth}}x{{moldHeight}} см, {{brand}}",
    "annotation": "Авторский силиконовый молд для отливки обуви ватной игрушки или куклы."
  },
  "other": {
    "topic":    "Молд для рукоделия",
    "purpose":  "Для кукол, ватных игрушек, рукоделия",
    "titleFull": "Молд силиконовый «{{moldName}}», {{moldLength}}x{{moldWidth}}x{{moldHeight}} см, {{brand}}",
    "annotation": "Авторский силиконовый молд для ватных игрушек и рукоделия."
  }
}
```

**Изменения в static:** `static.topic` и `static.purpose` оставить как дефолт для backward-compat, но в `templateEngine.js` логика должна брать значения из `moldTypes[questionnaire.moldType]` если поле есть, иначе fallback на `static`.

**Изменения в textTemplates:** `titleFull` и `annotation` — убрать хардкод про "личико куклы", заменить нейтральным placeholder-ом. Конкретные шаблоны теперь в `moldTypes[type].titleFull` / `annotation`.

**templateEngine.js:** при вычислении `titleFull` и `annotation` — взять шаблон из `template.moldTypes[q.moldType]` вместо `template.textTemplates`.

**step-texts промпты:** передавать `topic`, `purpose` из `moldTypes[moldType]` в LLM-промпт. LLM адаптирует их под конкретный молд (тема, имя, цвет). Конфиг `prompts.texts.json` должен иметь `{topic}` и `{purpose}` как placeholder-ы.

---

### 5. UI: форма создания карточки (INP-01, INP-02)

**Решение:** Modal / drawer поверх списка. Открывается по кнопке «Новая карточка».

**Поля формы:**
1. `moldName` — text input
2. `article` — text input
3. `brand` — text input
4. `moldType` — select: Лицо / Руки / Обувь / Другое (face/hands/shoes/other)
5. `theme` — text input (тема/персонаж)
6. `color` — text input (цвет силикона)
7. `priceBaseM` — number input (цена за размер M, ₽)
8. `photos` — file input, multiple, accept="image/*"
9. `sizes` — таблица 5 строк (XS/S/M/L/XL), колонки: moldSize (см), moldLength, moldWidth, moldHeight, moldWeight (г)

**Отправка:** `fetch('POST /lines', { body: FormData })` — multipart/form-data.
Поля JSON сериализуются отдельно: `formData.append('questionnaire', JSON.stringify({...}))` + файлы как `formData.append('photos', file)`.

**Альтернатива:** если сервер не умеет multipart — сначала `POST /lines/upload-photos` (файлы), получить URLs, затем `POST /lines` (JSON с URLs). Решить при планировании.

**После успешного создания:** запись появляется в списке без перезагрузки страницы (это Phase 4, но форма должна вернуть `article` для немедленного добавления).

---

## Files to Change in Phase 1

| File | Change |
|------|--------|
| `input/questionnaire.schema.json` | faceSize→moldSize, добавить moldType, renders→photos (required) |
| `layers/shared/config/template.master.json` | faceSize→moldSize в формулах, добавить moldTypes секцию, обновить textTemplates |
| `layers/shared/templateEngine.js` | Использовать moldTypes[moldType] для topic/purpose/titleFull/annotation |
| `functions/api/index.js` | Принять multipart/form-data в handleCreateLine, загрузить photos в Object Storage |
| `infra/local-server.js` | Добавить парсинг multipart (busboy/formidable) |
| `frontend/PipelineApp.jsx` | Добавить modal с формой создания карточки |

---

## Out of Scope for Phase 1

- Отдельные шаблоны по типам молда (face.master.json и т.д.) — один файл, moldType — параметр
- Backward-compat для старых данных с faceSize — нет
- UI-подключение к живому API (убрать хардкод LINES/TEXTS/IMAGES) — это Phase 4
- Генерация текстов/изображений — это Phase 2/3
- Валидация опросника через JSON Schema на сервере — можно добавить, но не блокирует Phase 1

---

## Open Questions (resolve at planning time)

1. **multipart парсинг:** есть ли `busboy` или `formidable` в node_modules? Или добавить?
2. **Загрузка фото при local-адаптере:** куда сохранять файлы локально? `./output/{article}/photos/`?
3. **artifacts поле:** оставить обязательным или выводить автоматически из типа молда?
