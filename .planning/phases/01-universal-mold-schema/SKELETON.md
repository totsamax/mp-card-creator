# Walking Skeleton — mp-card-creator

**Phase:** 1
**Generated:** 2026-06-15

## Capability Proven End-to-End

Пользователь открывает форму опросника в браузере, выбирает тип молда (любой из face/hands/shoes/other), прикладывает ≥1 фото и нажимает «Сохранить» — фронтенд отправляет `multipart/form-data` на `POST /lines`, сервер сохраняет фото в хранилище, вычисляет мастер-данные на 5 размеров с учётом типа молда и создаёт карточку. Это первая capability, которая прогоняет весь стек целиком: React-форма → HTTP-адаптер (multipart) → API-handler → templateEngine → versionStore (диск/Object Storage).

> Замечание: проект brownfield (скелет 6 шагов уже существует), но E2E ни разу не прогонялся. Phase 1 — первый реально работающий сквозной путь «ввод → сохранённая карточка». Архитектурные решения ниже уже зафиксированы кодовой базой и CLAUDE.md; этот файл их кодифицирует как контракт для фаз 2–5.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend runtime / язык | Node.js 22 (нативный fetch/streams), CommonJS, без TypeScript | Зафиксировано CLAUDE.md «не менять»; serverless-совместимые handlers `exports.handler` |
| Web-слой | `node:http` напрямую в `infra/local-server.js`, без фреймворка | Адаптер транслирует HTTP → формат события YC API Gateway; парсинг multipart — в адаптере (handler остаётся serverless-чистым) |
| Multipart-парсинг | `busboy@^1.6.0` (стрим в память, buffer) | Де-факто стандарт; zero runtime deps; буфер отдаётся в `putArtifact` без временных файлов на диске |
| Хранилище | `versionStore` 3 режима: `cloud-with-fallback` (дефолт) / `yandex-cloud` / `local`; YDB + Object Storage с фолбэком на диск | Зафиксировано; фото грузятся через `putArtifact` (адаптер выбирает диск vs S3, фолбэк per-call бесплатно) |
| Вычисления | `templateEngine` — чистые функции; формулы и шаблоны как данные в `template.master.json` | Тип молда — параметр (`moldTypes[type]`), не отдельный шаблон-файл (CONTEXT D-4, INP-03) |
| Фронтенд | React 18 + Vite 5, один SPA-компонент `PipelineApp.jsx`; форма отправляет `FormData` без ручного `Content-Type` | Браузер сам ставит boundary; apiFetch (JSON) не используется для формы с файлами |
| Тест-раннер | встроенный `node:test` (Node 22), без новых зависимостей | В проекте не было раннера; node:test покрывает unit (templateEngine) + integration smoke (handler) |
| Артефакты / layout | `output/{article}/{step}/v{N}/{artifact}`; фото — псевдо-step `photos`, всегда `v1` | Вписывается в существующую схему версионирования |

## Stack Touched in Phase 1

- [x] Project scaffold — тест-раннер (`node --test`), зависимость busboy (план 01)
- [x] Routing — реальный маршрут `POST /lines` принимает multipart (планы 03)
- [x] Database/Storage — реальная запись: фото + master-data.json через `versionStore.putArtifact` (план 03)
- [x] UI — интерактивная форма (select типа, file-input фото) проводная к API через FormData (план 04)
- [x] Deployment — локальный full-stack запуск задокументирован: `npm run dev` (API :3001 + Vite :5173)

## Out of Scope (Deferred to Later Slices)

- Генерация текстов с учётом moldType и рабочий critic-loop локально — Phase 2 (TXT-01/02/03)
- Генерация изображений, фото как reference в промпте, отображение в UI — Phase 3 (IMG-01..04)
- Убрать хардкод LINES/TEXTS/IMAGES из PipelineApp.jsx, статусы шагов, отображение ошибок — Phase 4 (UI-01..03, REL-01)
- Полный E2E прогон шагов 01–06 без ручного вмешательства — Phase 5 (REL-02)
- Серверная JSON-Schema валидация опросника (enum/required на сервере) — опционально, не блокирует Phase 1 (CONTEXT)
- Presigned URL для фото в cloud-режиме — для Phase 1 достаточно artifact-пути (RESEARCH A2)
- Видео (Kling.ai), атомарность манифеста, пагинация, YMQ-эмулятор — v2 scope

## Subsequent Slice Plan

Каждая последующая фаза добавляет один вертикальный слайс поверх скелета, не меняя архитектурных решений выше:

- Phase 2: тексты для всех 5 размеров генерируются с учётом moldType; critic-loop повторяет попытки локально через прямой вызов handler (без YMQ)
- Phase 3: кнопка в UI запускает 03-images; слайды генерируются с фото-reference, сохраняются и видны в UI
- Phase 4: UI показывает реальные данные из API (хардкод убран), статусы шагов и ошибки из манифеста
- Phase 5: реальный опросник + фото проходит шаги 01–06 end-to-end и даёт готовый пакет артефактов
