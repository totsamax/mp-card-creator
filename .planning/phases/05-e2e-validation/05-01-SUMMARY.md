---
phase: 05-e2e-validation
plan: 01
subsystem: testing
tags: [e2e, node-test, pipeline, openai, integration]
requires:
  - infra/local-server.js (spawned live server, multipart parsing)
  - functions/api/index.js (POST /lines, regenerate, manifest endpoints)
  - layers/shared/versionStore.js (local adapter, isolated OUTPUT_DIR)
provides:
  - test/e2e.test.js (E2E orchestrator gated behind RUN_E2E)
  - test/fixtures/e2e-face-questionnaire.json (face-mold questionnaire fixture)
  - npm script test:e2e
affects:
  - package.json (added test:e2e script)
tech-stack:
  added: []
  patterns:
    - "spawn live local-server.js as child process with isolated env (PORT 3101, STORE_ADAPTER=local, OUTPUT_DIR=test/e2e-output)"
    - "poll async steps by artifact-count and steps[stepId].error — NOT by a nonexistent status field"
    - "skip-guard via RUN_E2E env flag — file visible in npm test but paid run only with RUN_E2E=1"
    - "preflight checks OPENAI_API_KEY presence + photo fixture size before any spawn"
key-files:
  created:
    - test/e2e.test.js
    - test/fixtures/e2e-face-questionnaire.json
  modified:
    - package.json
decisions:
  - "Universal questionnaire schema (moldType + sizes[5]) is sufficient for face molds — confirmed against template.master.json moldTypes.face which only consumes moldName/moldLength/moldWidth/moldHeight/brand; no faceSize/poraType/faceOval fields required (resolves RESEARCH A1/Open Q2)"
  - "E2E uses port 3101 (not 3001) to avoid dev-server clash; E2E_BASE_URL env fallback reuses an already-running server (D-07)"
  - "PNG validation requires size > 1000 bytes to reject the 1×1 stub fallback (Pitfall 2); needsReview logged as warning, not failure"
  - "Artifacts kept in test/e2e-output/ for human inspection by default; cleanup only via optional RUN_E2E_CLEAN"
metrics:
  duration: ~2 min
  completed: 2026-06-23
---

# Phase 5 Plan 01: E2E Validation Orchestrator Summary

Один автоматизированный `node:test` сценарий (`test/e2e.test.js`), который через живой HTTP-сервер прогоняет реальный опросник лицевого молда + фото через шаги 01→02→03→05→06 с настоящими вызовами OpenAI, поллит async-шаги по artifact-count и валидирует полный пакет артефактов в изолированном `OUTPUT_DIR`. Платный прогон изолирован за флагом `RUN_E2E` — обычный `npm test` его пропускает.

## What Was Built

**Task 1 — Фикстура + npm-скрипт + skip-guard скелет** (commit `61e9a9e`)
- `test/fixtures/e2e-face-questionnaire.json` — шаблон опросника лицевого молда (`moldType: "face"`, 5 размеров XS–XL, осмысленные русские значения «Василиса»/«ТопМолд»/«Кукольное лицо», `photos: []` заполняется сервером, `article` подставляется в рантайме).
- `package.json` — добавлен `scripts.test:e2e: "node --test test/e2e.test.js"`, существующий `test` не тронут.
- `test/e2e.test.js` — `'use strict'`, requires встроенных модулей + exceljs, skip-guard `if (!process.env.RUN_E2E)` регистрирует один skipped placeholder и НЕ регистрирует реальный тест. Никаких хардкоженных секретов.

**Task 2 — E2E-оркестратор** (commit `0707da9`)
- `startServer()` спавнит `infra/local-server.js` с env `PORT=3101`, `STORE_ADAPTER=local`, изолированным `OUTPUT_DIR=test/e2e-output`, `SHARED_LAYER_PATH`. Наследует реальный `OPENAI_API_KEY` из окружения. Фолбэк `E2E_BASE_URL` — использовать уже запущенный сервер.
- `waitForPort()` — `net.createConnection` с ретраями каждые 200мс до дедлайна.
- `preflight()` — падает с понятным сообщением при отсутствии `OPENAI_API_KEY` или отсутствии/малом (<1000б) фото-фикстуре.
- `pollStep()` — проверяет `steps[stepId].error` ПЕРЕД artifact-count (Pitfall 3), готовность = `(step.artifacts||[]).length >= expect`, пауза 5с, без поля `status`.
- Прогон D-08: POST /lines (multipart, ассерт 200 + `stepId === '01-normalize'`) → 02-texts regenerate (202 → poll expect:5, 5мин) → 03-images regenerate (202 → poll expect:5, 10мин) → 05-excel (200) → 06-assemble (200).
- Валидация D-02: master-data.json (5 записей), 5×`{size}_texts.json` без `{{}}`, 5×`{size}_infographic.png` >1000б, оба xlsx через `ExcelJS.xlsx.readFile`, `assemble-report.json` с `completedSteps`. Версии берутся из `manifest.steps[stepId].currentVersion`, не хардкодятся.
- Гарантированный teardown через `t.after()` — `server.kill('SIGTERM')` только после всех проверок.

## Verification Results

- `RUN_E2E= node --test test/e2e.test.js` → skipped, exit 0, без сетевых вызовов. PASS
- `npm test` (вся unit-suite) → 20 pass, 1 skipped (E2E placeholder), 0 fail. PASS
- Task 1 grep-гейт: фикстура парсится, `moldType: face`, sizes.length === 5, `test:e2e` присутствует, нет литерала `sk-`. PASS
- Task 2 структурный гейт: содержит `pollStep`, `spawn`, `waitForPort`, `xlsx.readFile`, `03-images`, `steps[`, `currentVersion`; нет `status === 'done'`; images `expect: 5`. PASS

**Phase gate (платный, human-check, ОДИН раз перед /gsd-verify-work):** пользователь кладёт реальное фото в `test/fixtures/e2e-face-mold.png`, экспортирует `OPENAI_API_KEY` (через `.env.local`), запускает `RUN_E2E=1 npm run test:e2e`. Ожидаемо: exit 0 + полный пакет в `test/e2e-output/{article}/`. НЕ выполнено в автономном прогоне (требует реального ключа и фото — D-01/D-04).

## Deviations from Plan

None — план выполнен точно как написано. Оба таска были закоммичены атомарно с корректными conventional-commit сообщениями и scope `(05-01)`.

Примечание: на момент запуска этого executor-агента оба таска уже были закоммичены предыдущим прогоном (`61e9a9e`, `0707da9`), а SUMMARY/state не были созданы. Агент верифицировал корректность обоих коммитов (файлы, сообщения, достижимость от HEAD, прохождение всех гейтов) и завершил недостающие шаги: SUMMARY.md, обновление STATE/ROADMAP/REQUIREMENTS, финальный docs-коммит.

## Git Add Note (gitignore)

`.gitignore` содержит запись `test/`, но `test/e2e.test.js` и `test/fixtures/e2e-face-questionnaire.json` УЖЕ отслеживаются git (как и существующие тест-файлы, добавленные ранее через `git add -f`) — для уже отслеживаемых путей правило ignore не применяется, `git check-ignore` для них возвращает пусто. `test/e2e-output/` (артефакты прогона) и `test/fixtures/e2e-face-mold.png` (большой бинарь / возможные секреты) НЕ коммитятся.

## Known Stubs

None — E2E-оркестратор полностью реализован. `test/fixtures/e2e-face-mold.png` (реальное фото) предоставляет пользователь перед платным прогоном (D-04); это внешняя зависимость прогона, не стаб кода.

## Requirements Closed

- **REL-02** — реальный опросник + фото проходит шаги 01–05(06) без ручного вмешательства одним npm-скриптом (структурно реализовано; финальное доказательство — платный phase gate).

## Self-Check: PASSED

- FOUND: test/e2e.test.js
- FOUND: test/fixtures/e2e-face-questionnaire.json
- FOUND: .planning/phases/05-e2e-validation/05-01-SUMMARY.md
- FOUND: test:e2e script in package.json
- FOUND: commit 61e9a9e (Task 1)
- FOUND: commit 0707da9 (Task 2)
