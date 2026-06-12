# Пайплайн "Молд → Карточка маркетплейса"

Агентный пайплайн генерации карточек товаров (силиконовые молды для ватных
игрушек/куколок) для Ozon и Wildberries. На входе — минимальный опросник +
рендеры молда, на выходе — полный набор артефактов для загрузки на
маркетплейс: мастер-данные по линейке (5 размеров), тексты, изображения,
видео, Excel-выгрузки.

Стек: **Node.js** (оркестратор), **React** (фронтенд, готовый прототип уже
есть — см. `PipelineApp.jsx`), **Yandex Cloud** (бэкенд — серверлес-функции,
объектное хранилище, очередь для асинхронных шагов).

---

## 1. Идея и опорный пример

Эталон шаблона — линейка молдов «Василиса» (артикул 0553), 5 размеров
XS–XL, где все физические параметры, цены и тексты выводятся формулами от
одного значения — **размера личика (см)**:

| Параметр | Формула от `faceSize` |
|---|---|
| Длина молда, см | `faceSize × 1.5` |
| Ширина молда, см | `faceSize × 0.625` |
| Высота молда, см | `faceSize × 1.25` |
| Вес молда, г | ~`60 × (faceSize/4)^3`, округление до 5 |
| Вес с упаковкой, г | `вес молда + 40` |
| Цена базовая, ₽ | ~`1000 × (faceSize/4)`, округление |
| Цена со скидкой, ₽ | `цена базовая × 0.75` |
| Игрушка от/до, см | `faceSize × 4` / `faceSize × 8` |

Тексты (название короткое/полное, аннотация) собираются из шаблонных строк
с подстановкой имени молда, размеров и `faceSize`. Характеристики, SEO,
хэштеги — одинаковые для всей линейки, задаются один раз.

Референс: `linejka_moldov_5_razmerov.xlsx` (лист «Линейка молдов
«Василиса»»).

---

## 2. Опросник (минимальный вход)

Минимум полей, всё остальное считается по шаблону:

- **Имя молда** (например, «Василиса»)
- **Артикульная серия** (например, «0553»)
- **Бренд**
- **Базовый размер личика (M), см** — главный параметр расчётов
- **Базовая цена за M, ₽**
- **Тема/персонаж** (свободный текст — для генерации картинок и текстов)
- **Цвет силикона**
- **Рендеры молда** (1–3 изображения, разные ракурсы)
- **Какие артефакты собирать**: изображения / видео / Excel Ozon / Excel WB

---

## 3. Шаблон (template-driven)

`config/template.master.json` — JSON-версия логики из xlsx:

```json
{
  "sizes": ["XS", "S", "M", "L", "XL"],
  "baseField": "faceSize",
  "baseSizeKey": "M",
  "faceSizeBySize": { "XS": -2, "S": -1, "M": 0, "L": 1, "XL": 2 },
  "fields": {
    "moldLength":   "faceSize * 1.5",
    "moldWidth":    "faceSize * 0.625",
    "moldHeight":   "faceSize * 1.25",
    "moldWeight":   "round(60 * (faceSize/4)^3, 5)",
    "weightPacked": "moldWeight + 40",
    "priceBase":    "round(1000 * (faceSize/4) * (priceBaseM/1000), -1)",
    "priceDiscount":"priceBase * 0.75",
    "toyFrom":      "faceSize * 4",
    "toyTo":        "faceSize * 8",
    "titleShort":   "Молд «{{moldName}}» {{faceSize}}см #{{brand}}",
    "titleFull":    "Молд силиконовый для ватной игрушки «{{moldName}}», форма для личика куклы, {{moldLength}}x{{moldWidth}}x{{moldHeight}} см, {{brand}}",
    "annotation":   "Авторский силиконовый молд для отливки личика ватной игрушки или куклы. Глаза без зрачков — расписывайте сами и создавайте разные образы. Личико {{faceSize}} см."
  },
  "static": {
    "type": "Молд силиконовый",
    "purpose": "Для кукол, ватных игрушек, рукоделия",
    "topic": "Личико малыша, лицо ребёнка",
    "material": "Силикон",
    "heatResistance": "от -20 до +200",
    "reusable": "Да",
    "foodSafe": "Нет",
    "country": "Россия",
    "ageLimit": "14+",
    "packaging": "Крафтовая коробка",
    "set": "1 молд + 1 пробная отливка",
    "categoryOzon": "Хобби и творчество → Лепка → Молды и формы"
  }
}
```

Также нужны:
- `config/ozon.column-map.json`, `config/wb.column-map.json` — маппинг полей
  мастер-данных на колонки выгрузки конкретного маркетплейса (структуры
  разные).
- `config/prompts.images.json` — шаблоны промптов для ChatGPT image API по
  типам карточек: главное фото, инфографика с размерами, фото с игрушкой для
  масштаба, лайфстайл.
- `config/prompts.video.json` — шаблоны промптов для kling.ai (например,
  "силиконовый молд медленно поворачивается, крупный план рельефа").

---

## 4. Этапы пайплайна

| Шаг | Код | Что делает |
|---|---|---|
| Нормализация | `01-normalize` | опросник → мастер-данные (5 размеров по формулам шаблона) |
| Тексты | `02-texts` | LLM генерирует/уточняет описания, аннотации, SEO в рамках шаблона |
| Изображения | `03-images` | промпты + рендер молда (как референс) → ChatGPT image API |
| Видео | `04-video` | изображения + промпт → kling.ai |
| Excel-выгрузка | `05-excel` | мастер-данные → xlsx по шаблону Ozon/WB |
| Сборка пакета | `06-assemble` | сборка готовой папки артефактов по артикулу |

Каждый шаг — отдельная Cloud Function с сигнатурой:
```js
exports.handler = async (event) => { /* читает masterData из YDB/Object Storage, обновляет, сохраняет */ }
```

Вызов цепочки шагов — асинхронный, через **Yandex Message Queue**: функция
`api` кладёт сообщение `{ article, step, version }` в очередь, триггер YMQ
вызывает соответствующую `step-*` функцию. Так шаги 03/04 (изображения,
видео — могут идти минутами) не блокируют запрос пользователя и не упираются
в лимит времени выполнения функции. По завершении шаг обновляет манифест в
YDB и (опционально) кладёт сообщение для запуска следующего шага.

Точечный запуск/перегенерация одного шага или одного артефакта — отдельное
сообщение в очередь с указанием `article`, `step`, опционально `item`
(например, `{ size: "M", type: "infographic" }`).

---

## 5. Хранение результатов и версионирование

```
output/
└── 0553/
    ├── manifest.json          # история версий всех шагов
    ├── master-data/v1.json, v2.json, ...
    ├── texts/v1/, v2/...
    ├── images/v1/, v2/...      # + overrides на отдельные файлы
    ├── video/v1/...
    ├── excel/v1/0553_ozon.xlsx, 0553_wb.xlsx
    └── current/                # указатели на актуальные версии каждого шага
```

`manifest.json`:
```json
{
  "article": "0553",
  "steps": {
    "01-normalize": { "currentVersion": 2, "history": [
      { "version": 1, "createdAt": "...", "inputHash": "abc123" },
      { "version": 2, "createdAt": "...", "inputHash": "def456", "note": "поправили базовую цену" }
    ]},
    "03-images": { "currentVersion": 2, "history": [...],
      "overrides": { "M_infographic.png": "v2", "M_main.png": "v1" } }
  }
}
```

Принципы:
- **Каждый шаг — отдельная версия**, не перезаписывает предыдущую.
- **Точечная перегенерация одного артефакта** через `overrides` (например,
  пересоздать только инфографику для размера M, остальное — из старой
  версии).
- **Кэш по input-хэшу**: перед перегенерацией шаг сравнивает хэш входных
  данных + конфига промпта с последней версией; если не изменился — шаг
  пропускается (флаг `--force` для принудительного запуска). Особенно важно
  для шагов 03/04 — они стоят денег за каждый вызов API.
- **Откат**: `--revert=03-images:v1` переключает `current` на нужную версию.

В Yandex Cloud эта структура — не локальная папка, а ключи в **Object
Storage** (бакет, например `mold-pipeline-output`), где префикс
`0553/images/v2/M_infographic.png` и есть путь объекта. Сам `manifest.json`
из-за конкурентных регенераций и инкрементов версий лучше хранить не как
объект в Object Storage (риск гонок при read-modify-write), а как запись в
**Yandex Database (YDB, серверлес, document/row API)** — атомарные апдейты
полей `currentVersion`/`history`/`overrides` на уровне БД. Подробнее в
разделе 9.

---

## 6. Структура проекта (Yandex Cloud, серверлес)

Вместо одного Express-сервера и долгоживущего процесса — набор отдельных
**Cloud Functions** (Node.js runtime), общий код подключается как **слой
(layer)**, асинхронная цепочка шагов — через **Yandex Message Queue (YMQ)**.

```
mold-card-pipeline/
├── layers/
│   └── shared/                   # общий код, подключается как Cloud Functions Layer
│       ├── templateEngine.js     # формулы из template.master.json
│       ├── versionStore.js       # YDB (манифест) + Object Storage (артефакты)
│       ├── excelWriter.js        # exceljs
│       └── config/               # template.master.json, column-map'ы, prompts.*.json
├── functions/
│   ├── api/                       # роутер для API Gateway (CRUD, манифест, триггеры регенерации)
│   │   └── index.js
│   ├── step-normalize/index.js
│   ├── step-texts/index.js
│   ├── step-images/index.js       # OpenAI Images API
│   ├── step-video/index.js        # kling.ai
│   ├── step-excel/index.js
│   └── step-assemble/index.js
├── infra/
│   ├── api-gateway.yaml            # OpenAPI-спека для API Gateway
│   └── deploy.sh / terraform/      # развёртывание через yc CLI или Terraform
├── frontend/
│   └── PipelineApp.jsx             # хостится в Object Storage (статический сайт) + CDN
└── input/
    └── questionnaire.schema.json   # схема для формы (валидация)
```

Ключевые библиотеки: `exceljs`, `zod`, встроенный `fetch` для OpenAI
Images API и kling.ai, YDB Node.js SDK (`ydb-sdk`), AWS SDK v3
(совместим с Object Storage API Yandex Cloud, `@aws-sdk/client-s3`).

---

## 7. Frontend (готовый прототип)

`PipelineApp.jsx` — React-компонент, реализует:

- сайдбар со списком линеек (иконка-«лесенка» из 5 размеров + статус)
- вкладка **«Опросник»** — форма со всеми полями из раздела 2
- вкладка **«Результаты»** — степпер по 6 шагам пайплайна, выбор версии
  каждого шага, точечная перегенерация отдельных артефактов (изображение,
  видео), просмотр: таблицы мастер-данных, текстов, сетки изображений,
  видео-плейсхолдеров, карточек Excel-выгрузки, дерева папки результата

Сейчас работает на моках (`MASTER_DATA`, `TEXTS`, `IMAGES`, `VIDEO`,
`VERSIONS`, `ASSEMBLE_TREE`). Для интеграции — заменить эти константы на
запросы к API Gateway (маршруты ведут на функцию `api`, которая читает
манифест из YDB и при необходимости отдаёт presigned URL на объект в Object
Storage):

```
GET  /lines
GET  /lines/:id/steps/:step?version=N      -> данные шага + presigned URL'ы на файлы
POST /lines/:id/steps/:step/regenerate     -> кладёт сообщение в YMQ
POST /lines/:id/steps/:step/items/:item/regenerate
GET  /lines/:id/manifest
POST /lines                                 -> создание линейки из опросника
```

Сам `PipelineApp.jsx` хостится как статика в Object Storage (bucket со
статическим веб-сайтом) + Yandex Cloud CDN перед ним; обращается к API
Gateway по CORS.

Зависимости фронтенда: React, `lucide-react`, Tailwind (core utility
classes), шрифты Fraunces / Inter / IBM Plex Mono (Google Fonts).

---

## 8. Развёртывание: Yandex Cloud (серверлес)

Компоненты:

| Компонент | Назначение |
|---|---|
| **Cloud Functions** | по одной функции на каждый шаг пайплайна (`step-*`) + функция `api` для роутера API Gateway |
| **API Gateway** | публичный HTTP-вход для фронтенда, маршрутизация на функции, CORS |
| **Object Storage** | бинарные артефакты: изображения, видео, xlsx, json-снапшоты версий; также хостинг статики фронтенда |
| **Yandex Database (YDB)** | манифест по каждому артикулу — `currentVersion`/`history`/`overrides`, атомарные обновления при конкурентных регенерациях |
| **Message Queue (YMQ)** | асинхронная цепочка шагов и точечные регенерации; триггеры на `step-*` функции |
| **Lockbox** | секреты — ключи OpenAI Images API и kling.ai, доступ функциям через переменные окружения с секретами |
| **Cloud CDN** | перед бакетом со статикой фронтенда (опционально) |

Локальная разработка: каждая `functions/step-*` и `functions/api` —
самостоятельный модуль с собственным `package.json`, тестируется локально
обычным вызовом `handler(event)` с мок-`event`; для эмуляции YDB/Object
Storage на этапе разработки можно временно подставлять локальный
файл/память через тот же интерфейс `versionStore` (один интерфейс — два
адаптера: `local` и `yandex-cloud`).

Развёртывание — через `yc CLI` (`yc serverless function version create`,
`yc serverless api-gateway create` из `infra/api-gateway.yaml`) или
Terraform-провайдер `yandex-cloud/yandex`.

---

## 9. Текущий статус / следующие шаги

- [x] Архитектура пайплайна и оркестратора
- [x] Схема версионирования результатов (адаптирована под YDB + Object Storage)
- [x] Прототип фронтенда (`PipelineApp.jsx`)
- [ ] `template.master.json` — перенести формулы линейки «Василиса»
- [ ] `versionStore.js` — интерфейс + адаптеры `local` / `yandex-cloud` (YDB + Object Storage)
- [ ] Функция `api` + `infra/api-gateway.yaml`
- [ ] Функции `step-*` (нормализация, тексты, изображения, видео, excel, сборка)
- [ ] Адаптеры `openaiImages.js` / `klingVideo.js` (ключи через Lockbox)
- [ ] `excelWriter.js` + column-map для Ozon/WB
- [ ] Настройка YMQ-триггеров между шагами
- [ ] Хостинг фронтенда в Object Storage + CDN
- [ ] Подключить `PipelineApp.jsx` к API Gateway вместо моков
