# CLAUDE.md — mp-card-creator

## Что это

Агентный пайплайн генерации карточек товаров (силиконовые молды) для Ozon и Wildberries. Вход: опросник + рендеры молда. Выход: мастер-данные по линейке 5 размеров (XS–XL), тексты, изображения, видео, Excel-выгрузки.

Подробная архитектура: [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

## Стек

- **Рантайм**: Node.js (локальный HTTP-сервер), React (Vite, фронтенд)
- **Хранилище (основное)**: Yandex Cloud — YDB Serverless (манифесты), Object Storage (артефакты)
- **Хранилище (фолбэк)**: локальная файловая система (`./output/`) — включается автоматически при недоступности облака
- **Ключевые библиотеки**: `exceljs`, `@aws-sdk/client-s3`, `@aws-sdk/client-dynamodb`, встроенный `fetch`, `concurrently`
- **AI API**: OpenAI (тексты + изображения), Anthropic Claude Vision (критик изображений), Kling.ai (видео)
- **Фронтенд**: React + `lucide-react` + Tailwind, шрифты Fraunces/Inter/IBM Plex Mono

## Структура проекта

```
layers/shared/          # общий код, подключается через SHARED_LAYER_PATH
  templateEngine.js     # формулы из template.master.json → мастер-данные
  versionStore.js       # хранилище артефактов: cloud-with-fallback / local / yandex-cloud
  excelWriter.js        # генерация xlsx через exceljs
  config/               # template.master.json, ozon.column-map.json, wb.column-map.json, prompts.*.json

functions/
  api/index.js          # HTTP-роутер (CRUD + запуск шагов)
  step-normalize/       # шаг 01: опросник → мастер-данные
  step-texts/           # шаг 02: LLM-генерация текстов
  step-images/          # шаг 03: OpenAI Images API
  step-video/           # шаг 04: kling.ai
  step-excel/           # шаг 05: xlsx Ozon/WB
  step-assemble/        # шаг 06: сборка пакета артефактов

infra/
  local-server.js       # тонкая HTTP-обёртка над functions/api, слушает :3001

frontend/
  PipelineApp.jsx       # React-приложение, подключено к API через apiFetch

input/
  questionnaire.schema.json

output/                 # создаётся автоматически, в .gitignore
  {article}/manifest.json
  {article}/{step}/v{N}/{artifact}
```

## Соглашения по коду

### Функции
Каждая функция — CommonJS-модуль с единственным экспортом:
```js
exports.handler = async (event) => { ... }
```

Функции stateless: читают данные из `versionStore`, пишут туда же. Никакого глобального состояния.

### versionStore — три режима

`STORE_ADAPTER` управляет поведением:

| Значение | Поведение |
|---|---|
| `cloud-with-fallback` **(дефолт)** | пишет и читает из YDB + Object Storage; при любой ошибке сети/авторизации прозрачно переключается на локальный диск |
| `yandex-cloud` | только облако, ошибки не глотает |
| `local` | только локальный диск (`OUTPUT_DIR`, дефолт `./output/`) |

**Логика фолбэка в `cloud-with-fallback`:**
- каждый вызов оборачивается в try/catch
- при ошибке — `console.warn('[versionStore] cloud unavailable, falling back to local:', err.message)` и повтор через local-адаптер
- фолбэк per-call, не sticky: следующий вызов снова пробует облако

Для работы с Yandex Cloud нужны переменные окружения (см. `.env.example`):
```
YDB_DOCUMENT_API_ENDPOINT=...
YDB_TABLE_NAME=mold-manifests
YC_BUCKET_NAME=mold-pipeline-output
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### templateEngine — только чистые функции
`templateEngine.js` — чистые функции без I/O. Принимает `questionnaire` + `template`, возвращает `masterData[]` для всех 5 размеров. Тестируется напрямую, без моков.

**Модель размеров:** физические параметры (длина/ширина/высота/вес/faceSize) задаются вручную таблицей `sizes[5]` в опроснике, не вычисляются по формулам. Формульными остаются только: `weightPacked`, `priceBase`, `priceDiscount`, `toyFrom`, `toyTo`, тексты (`titleShort`, `titleFull`, `annotation`).

### Именование файлов
- Конфиги: `kebab-case.json` (например, `ozon.column-map.json`)
- JS-модули: `camelCase.js`
- Артефакты: `output/{article}/{step}/v{N}/{artifact}` (например, `output/0553/03-images/v2/M_infographic.png`)

### Версионирование артефактов
- Каждый шаг пишет в новую версию, не перезаписывает предыдущую
- Манифест — `output/{article}/manifest.json`, обновляется атомарно (read-merge-write)
- Кэш по input-хэшу: шаг сравнивает хэш входных данных+конфига с последней версией, пропускает если не изменился
- `force: true` в теле запроса для принудительного перезапуска

### Generator-critic циклы (шаги 02-texts и 03-images)
Шаги генерации текстов и изображений работают в цикле генератор→критик (PROJECT_BRIEF §4.1):
- Сообщение: `{ article, size, attempt: N, feedback?: [...] }`
- Если критик вернул `ok: false` и `attempt < maxAttempts` (3) — handler рекурсивно вызывает себя с `attempt + 1` и `feedback`
- При исчерпании попыток: сохраняем результат с `needsReview: true` в манифесте
- Манифест хранит все попытки: `attempts: [{ attempt, criticVerdict }]`
- Конфиги: `prompts.critic-texts.json` (rule-based), `prompts.critic-images.json` (Claude Vision)

### Асинхронные шаги
Шаги 02-texts, 03-images, 04-video могут идти минутами и запускаются fire-and-forget:
- `api` вызывает `runLocally(stepId, messages)` — запускает handler в фоне, сразу отвечает 202
- Прогресс отслеживается через манифест: `GET /lines/:id/manifest`

### Ошибки и логирование
Ошибки бросаем, не глотаем молча. `console.error` пишет в stdout локального сервера.

### Запуск локально
```bash
npm run dev        # api :3001 + vite :5173 одновременно
npm run api        # только API-сервер
```

Переменные окружения — в `.env.local` (загружается `local-server.js` автоматически):
```
# AI
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
KLING_API_KEY=...

# Хранилище — облако с фолбэком на диск (дефолт)
STORE_ADAPTER=cloud-with-fallback
OUTPUT_DIR=./output            # куда пишет фолбэк

# Yandex Cloud (нужны для основного пути)
YDB_DOCUMENT_API_ENDPOINT=...
YDB_TABLE_NAME=mold-manifests
YC_BUCKET_NAME=mold-pipeline-output
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## Текущий статус

- [x] Архитектура и схема версионирования
- [x] `layers/shared/config/template.master.json`
- [x] `layers/shared/templateEngine.js`
- [x] `layers/shared/versionStore.js` (local + yandex-cloud + cloud-with-fallback адаптеры)
- [x] `layers/shared/excelWriter.js` + `ozon.column-map.json` + `wb.column-map.json`
- [x] `functions/api/index.js`
- [x] `functions/step-normalize`, `step-texts`, `step-images`, `step-excel`, `step-assemble`, `step-video`
- [x] `frontend/PipelineApp.jsx` подключён к API (`apiFetch`, `API_BASE`, таблица размеров)
- [x] Локальный dev-сервер (`infra/local-server.js`) + Vite setup (`frontend/`)
- [ ] E2E прогон: отправить реальный опросник, пройти все 6 шагов
- [ ] Зафиксировать весь код в git

## API — маршруты

```
GET  /lines
GET  /lines/:id/steps/:step?version=N
POST /lines/:id/steps/:step/regenerate
POST /lines/:id/steps/:step/items/:item/regenerate
GET  /lines/:id/manifest
POST /lines
```
