# Technology Stack

**Analysis Date:** 2026-06-15

## Languages

**Primary:**
- JavaScript (Node.js) — all backend logic in `functions/`, `layers/shared/`, `infra/`
- JSX (React) — frontend in `frontend/PipelineApp.jsx`

**Module System:**
- Backend: CommonJS (`'use strict'; exports.handler = ...`) throughout all `functions/` and `layers/shared/`
- Frontend: ESM (Vite handles bundling)

## Runtime

**Environment:**
- Node.js (version not pinned — no `.nvmrc` or `.node-version` present)
- Built-in `fetch` used for all HTTP calls (requires Node.js 18+)
- Built-in `crypto` used for SHA-256 hashing

**Package Manager:**
- npm (root `package-lock.json` present)
- Separate npm workspace for frontend (`frontend/package-lock.json`)
- Lockfiles: present in both root and `frontend/`

## Frameworks

**Backend:**
- No web framework — plain `node:http` server in `infra/local-server.js`
- Handler interface mimics Yandex Cloud API Gateway event format (`httpMethod`, `path`, `queryStringParameters`, `body`, `isBase64Encoded`)

**Frontend:**
- React `^18.3.1` — single SPA component at `frontend/PipelineApp.jsx`
- Vite `^5.4.2` — dev server (port 5173) + production bundler
- `@vitejs/plugin-react` `^4.3.1` — JSX transform

**CSS:**
- Tailwind CSS (referenced in CLAUDE.md; no config file detected at root — may be CDN-loaded or inline)
- Fonts: Fraunces, Inter, IBM Plex Mono (referenced in CLAUDE.md)

**Testing:**
- No test framework configured (`npm test` exits 1 with "no test specified")

## Key Dependencies

**Root (`package.json`):**

| Package | Version | Purpose |
|---------|---------|---------|
| `@aws-sdk/client-dynamodb` | `^3.1067.0` | YDB Serverless (DynamoDB-compatible) for manifests |
| `@aws-sdk/lib-dynamodb` | `^3.1067.0` | DynamoDBDocumentClient higher-level wrapper |
| `@aws-sdk/client-s3` | `^3.1067.0` | Yandex Object Storage (S3-compatible) for artifacts |
| `@aws-sdk/client-sqs` | `^3.1067.0` | SQS-compatible messaging (declared, usage TBD) |
| `exceljs` | `^4.4.0` | Generate `.xlsx` files for Ozon/WB export |
| `concurrently` | `^9.2.1` (dev) | Run API server + Vite in parallel via `npm run dev` |

**Frontend (`frontend/package.json`):**

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | `^18.3.1` | UI framework |
| `react-dom` | `^18.3.1` | DOM renderer |
| `lucide-react` | `^0.441.0` | Icon components |
| `vite` | `^5.4.2` (dev) | Build tool and dev server |
| `@vitejs/plugin-react` | `^4.3.1` (dev) | React JSX plugin for Vite |

## Build & Dev Tooling

**Scripts (root):**
```bash
npm run dev    # concurrently: node infra/local-server.js + vite --port 5173
npm run api    # only API server: node infra/local-server.js
```

**Scripts (frontend):**
```bash
npm run dev      # vite --port 5173
npm run build    # vite build → frontend/dist/
npm run preview  # vite preview
```

**Vite config** (`frontend/vite.config.js`):
- Dev proxy: `/lines` → `http://localhost:3001` (avoids CORS in development)
- Build output: `frontend/dist/`

## Environment & Config

**Loading mechanism:**
- `infra/local-server.js` manually parses `.env.local` from project root on startup
- Does NOT override already-set environment variables
- Pattern: `KEY=VALUE` lines only (no comments, no `export` prefix)

**Required env vars:**
```
# AI
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
KLING_API_KEY=...

# Storage adapter
STORE_ADAPTER=cloud-with-fallback   # or: local | yandex-cloud

# Local fallback
OUTPUT_DIR=./output

# Yandex Cloud (needed for cloud adapters)
YDB_DOCUMENT_API_ENDPOINT=...
YDB_TABLE_NAME=mold-manifests
YC_BUCKET_NAME=mold-pipeline-output
YC_ENDPOINT=https://storage.yandexcloud.net  # optional, this is the default
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Optional
PORT=3001
SHARED_LAYER_PATH=...   # defaults to ../../layers/shared relative to each function
```

**Config files (not secrets):**
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

---

*Stack analysis: 2026-06-15*
