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

<!-- GSD:project-start source:PROJECT.md -->

## Project

**mp-card-creator**

Агентный пайплайн генерации карточек товаров для силиконовых молдов (Ozon и Wildberries). Вход: опросник + фото молда и отливки. Выход: тексты на 5 размеров (XS–XL), инфографические слайды для карточки товара, Excel-выгрузки под формат маркетплейса.

Скелет пайплайна построен, 6 шагов реализованы, но E2E прогон ни разу не выполнялся — система не работает как целое.

**Core Value:** Залил опросник + фото молда → получил готовый пакет для публикации на Ozon/WB.

### Constraints

- **Tech stack**: Node.js / CommonJS, React + Vite, без TypeScript — не менять
- **AI API**: OpenAI (тексты + изображения), Anthropic Claude Vision (критик), Kling.ai (видео)
- **Storage**: Yandex Cloud с локальным фолбэком — архитектура уже выбрана
- **Локальная разработка**: без YMQ — retry-циклы должны работать через прямой вызов хэндлера
- **Slide шаблон**: структура слайдов зафиксирована (есть примеры) — AI генерирует контент, не структуру

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- JavaScript (Node.js) — all backend logic in `functions/`, `layers/shared/`, `infra/`
- JSX (React) — frontend in `frontend/PipelineApp.jsx`
- Backend: CommonJS (`'use strict'; exports.handler = ...`) throughout all `functions/` and `layers/shared/`
- Frontend: ESM (Vite handles bundling)

## Runtime

- Node.js (version not pinned — no `.nvmrc` or `.node-version` present)
- Built-in `fetch` used for all HTTP calls (requires Node.js 18+)
- Built-in `crypto` used for SHA-256 hashing
- npm (root `package-lock.json` present)
- Separate npm workspace for frontend (`frontend/package-lock.json`)
- Lockfiles: present in both root and `frontend/`

## Frameworks

- No web framework — plain `node:http` server in `infra/local-server.js`
- Handler interface mimics Yandex Cloud API Gateway event format (`httpMethod`, `path`, `queryStringParameters`, `body`, `isBase64Encoded`)
- React `^18.3.1` — single SPA component at `frontend/PipelineApp.jsx`
- Vite `^5.4.2` — dev server (port 5173) + production bundler
- `@vitejs/plugin-react` `^4.3.1` — JSX transform
- Tailwind CSS (referenced in CLAUDE.md; no config file detected at root — may be CDN-loaded or inline)
- Fonts: Fraunces, Inter, IBM Plex Mono (referenced in CLAUDE.md)
- No test framework configured (`npm test` exits 1 with "no test specified")

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@aws-sdk/client-dynamodb` | `^3.1067.0` | YDB Serverless (DynamoDB-compatible) for manifests |
| `@aws-sdk/lib-dynamodb` | `^3.1067.0` | DynamoDBDocumentClient higher-level wrapper |
| `@aws-sdk/client-s3` | `^3.1067.0` | Yandex Object Storage (S3-compatible) for artifacts |
| `@aws-sdk/client-sqs` | `^3.1067.0` | SQS-compatible messaging (declared, usage TBD) |
| `exceljs` | `^4.4.0` | Generate `.xlsx` files for Ozon/WB export |
| `concurrently` | `^9.2.1` (dev) | Run API server + Vite in parallel via `npm run dev` |
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | `^18.3.1` | UI framework |
| `react-dom` | `^18.3.1` | DOM renderer |
| `lucide-react` | `^0.441.0` | Icon components |
| `vite` | `^5.4.2` (dev) | Build tool and dev server |
| `@vitejs/plugin-react` | `^4.3.1` (dev) | React JSX plugin for Vite |

## Build & Dev Tooling

- Dev proxy: `/lines` → `http://localhost:3001` (avoids CORS in development)
- Build output: `frontend/dist/`

## Environment & Config

- `infra/local-server.js` manually parses `.env.local` from project root on startup
- Does NOT override already-set environment variables
- Pattern: `KEY=VALUE` lines only (no comments, no `export` prefix)

# AI

# Storage adapter

# Local fallback

# Yandex Cloud (needed for cloud adapters)

# Optional

- `layers/shared/config/template.master.json` — size/pricing formulas
- `layers/shared/config/ozon.column-map.json` — Ozon Excel column mapping
- `layers/shared/config/wb.column-map.json` — Wildberries Excel column mapping
- `layers/shared/config/prompts.texts.json` — LLM prompts for text generation
- `layers/shared/config/prompts.critic-texts.json` — Rule-based critic config
- `layers/shared/config/prompts.images.json` — Image generation prompts
- `layers/shared/config/prompts.critic-images.json` — Claude Vision critic config
- `layers/shared/config/prompts.video.json` — Kling.ai video prompts + API config
- `input/questionnaire.schema.json` — Input validation schema

## Key Constraints

- Node.js 18+ required (uses native `fetch`, `fs.promises`, `for await...of`)
- All backend modules are CommonJS — do not use `import`/`export` syntax
- No TypeScript — plain JavaScript throughout
- No test runner configured — tests would need to be added
- Stateless function design: each handler reads from and writes to `versionStore`, no in-memory state between requests
- `SHARED_LAYER_PATH` env var controls shared module resolution; defaults to `../../layers/shared` relative to each function

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Module System

## Function/Handler Pattern

## Error Handling

## Logging

- `[api]` — `functions/api/index.js`
- `[local]` — local fire-and-forget runner inside `functions/api/index.js`
- `[versionStore]` — `layers/shared/versionStore.js`
- `[step-texts]` — `functions/step-texts/index.js`
- `console.error` — unhandled exceptions and fatal errors
- `console.warn` — degraded mode (cloud unavailable, LLM unavailable, fallback engaged)
- `console.log` — successful local step execution progress

## Async Patterns

## Naming Conventions

- Config/data files: `kebab-case.json` — e.g., `ozon.column-map.json`, `prompts.critic-texts.json`
- JS modules: `camelCase.js` — e.g., `templateEngine.js`, `versionStore.js`, `excelWriter.js`
- Step directories: `step-{name}/` with `index.js` entry point
- `camelCase` for all local variables, function names, object keys
- `UPPER_SNAKE_CASE` for module-level constants: `STEP_ID`, `MAX_ATTEMPTS`, `SIZES`, `IMAGE_TYPES`, `OUTPUT_DIR`, `YDB_TABLE`, `S3_BUCKET`
- Environment variable references always via `process.env.VAR_NAME`
- Path pattern: `output/{article}/{step}/v{N}/{artifact}` — e.g., `output/0553/03-images/v2/M_infographic.png`
- Artifact names: `{size}_{type}.{ext}` — e.g., `M_texts.json`, `XL_infographic.png`
- Numeric prefix + kebab name: `01-normalize`, `02-texts`, `03-images`, `04-video`, `05-excel`, `06-assemble`

## Comments and Documentation

- `// eslint-disable-next-line no-new-func` before dynamic `new Function()` usage
- `// Read-merge-write (YDB Document API has no native nested-field atomic update)`
- `// Local mode fallback: run step handlers directly (fire-and-forget)`

## Code Organization

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| local-server | HTTP adapter: translates Node.js `http.IncomingMessage` → YC API Gateway event format, loads `.env.local`, writes to `logs/api.log` | `infra/local-server.js` |
| api/index.js | REST router (CRUD + step orchestration), step cache check, runLocally vs YMQ dispatch | `functions/api/index.js` |
| step-normalize | Questionnaire → master data (5 sizes), stores `master-data.json` | `functions/step-normalize/index.js` (delegated to api for step 01) |
| step-texts | LLM text generation per size with generator-critic loop | `functions/step-texts/index.js` |
| step-images | OpenAI image generation per size/type with Claude Vision critic loop | `functions/step-images/index.js` |
| step-video | kling.ai video generation | `functions/step-video/index.js` |
| step-excel | Generates Ozon/WB xlsx from master data via column maps | `functions/step-excel/index.js` |
| step-assemble | Collects all artifacts into a packaged output folder | `functions/step-assemble/index.js` |
| templateEngine | Pure: questionnaire + template.master.json → SizeRecord[] (5 rows) | `layers/shared/templateEngine.js` |
| versionStore | Storage adapter (3 modes): manifest CRUD + artifact blob storage | `layers/shared/versionStore.js` |
| excelWriter | exceljs-based xlsx generation from master data + column map | `layers/shared/excelWriter.js` |
| PipelineApp | React UI: questionnaire form, pipeline stepper, artifact preview, version selector | `frontend/PipelineApp.jsx` |

## Data Flow

### Primary Request Path: Create a Product Line

### Async Step Trigger Path (steps 02, 03, 04)

### Artifact Retrieval Path

### State Management (Manifest)

- One `manifest.json` per article (keyed by `article` in YDB or as file on disk)
- Schema:
- Writes use read-merge-write pattern (no atomic partial updates in YDB Document API)
- `deepMerge` helper (`layers/shared/versionStore.js:250`) performs non-destructive patch

## Key Design Patterns

### Handler Pattern (Serverless-compatible)

### Storage Adapter Pattern

- `local`: filesystem at `OUTPUT_DIR`
- `yandex-cloud`: YDB (DynamoDB compat.) + Object Storage (S3 compat.)
- `cloud-with-fallback` (default): wraps every `yandex-cloud` call in try/catch, falls back to `local` per-call on any error

### Input Hash Cache

### Fire-and-Forget Async

### Dual Dispatch (Cloud / Local)

### Template-Driven Computation

## Pipeline Steps

| Step | ID | Sync/Async | Input | Output |
|------|----|-----------|-------|--------|
| Normalize | `01-normalize` | Sync | Questionnaire JSON | `master-data.json` (5 SizeRecords) |
| Texts | `02-texts` | Async (fire-and-forget) | master-data + prompts.texts.json | `{size}_texts.json` per size |
| Images | `03-images` | Async (fire-and-forget) | master-data + prompts.images.json | `{size}_{imageType}.png` (4 types × 5 sizes = 20 images) |
| Video | `04-video` | Async (fire-and-forget) | master-data + generated images | video files per size/type |
| Excel | `05-excel` | Sync | master-data + column maps | `ozon.xlsx`, `wb.xlsx` |
| Assemble | `06-assemble` | Sync | all step artifacts | packaged output folder |

## Generator-Critic Loops

### Shared Mechanics

```

```

### 02-texts Critic (`functions/step-texts/index.js:191`)

- Field length limits (e.g., `titleShort` ≤ 30 chars) from `config/prompts.critic-texts.json`
- Required substrings present in each field
- Banned phrases not present

### 03-images Critic (`functions/step-images/index.js:148`)

### Retry in Local Dev

### Generator Fallback Chain (02-texts)

## Error Handling

- Top-level `try/catch` in `exports.handler` → returns `{ statusCode: 500, error: err.message }`
- Store operations: cloud adapter errors → per-call fallback to local (logged as `console.warn`)
- Critic failures in 03-images → treated as `ok: true` to avoid blocking (explicitly noted in code)
- AI API failures → step returns 500 (caller can retry via regenerate endpoint)

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. No worker threads. Async steps run fire-and-forget in the same process in local mode.
- **Global state:** None. `versionStore` adapter is selected per-call via `getAdapter()`. No module-level mutable singletons.
- **Circular imports:** None detected. Dependency graph is strictly layered: `infra` → `functions/api` → `layers/shared`.
- **YDB atomic updates:** Not available for nested fields. `updateManifest` uses read-merge-write, creating a TOCTOU window under concurrent writes to the same article.
- **Local retry limitation:** Generator-critic retry loop requires YMQ. In local dev, only attempt 1 runs automatically. Subsequent attempts must be triggered manually.

## Anti-Patterns

### Writing step 01-normalize inline in api/index.js

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
