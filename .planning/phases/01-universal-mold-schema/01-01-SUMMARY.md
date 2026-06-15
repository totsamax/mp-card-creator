---
phase: 01-universal-mold-schema
plan: "01"
subsystem: test-infrastructure
tags: [busboy, node-test, tdd, walking-skeleton, multipart, red-tests]
dependency_graph:
  requires: []
  provides: [test-runner, busboy-dep, red-contract-tests]
  affects: [package.json, test/templateEngine.test.js, test/create-line.smoke.test.js]
tech_stack:
  added: [busboy@^1.6.0, node:test (built-in)]
  patterns: [TDD RED phase, node:test glob runner]
key_files:
  created:
    - test/templateEngine.test.js
    - test/create-line.smoke.test.js
    - test/fixtures/test-mold.png
  modified:
    - package.json
decisions:
  - "node --test with glob pattern 'test/**/*.test.js' required (directory arg fails in Node v22)"
  - "RED tests use moldSize (not faceSize) and event.files to document the target API contract"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-15T20:20:51Z"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 5
---

# Phase 01 Plan 01: Walking Skeleton — TDD Foundation Summary

**One-liner:** node:test runner + busboy installed + 3 RED contract tests (A/B/C) for moldType+moldSize+multipart Phase 1 API

## What Was Built

Plan 01-01 установил фундамент валидации для Phase 1:

1. **busboy@^1.6.0** добавлен в `dependencies` — multipart-парсер для фото молда (легитимность подтверждена человеком перед установкой)
2. **node:test runner** подключён через `scripts.test = "node --test 'test/**/*.test.js'"` — встроенный в Node.js 22, без дополнительных зависимостей
3. **PNG-фикстура** `test/fixtures/test-mold.png` — минимальный валидный 1×1 PNG (69 байт) для smoke-теста multipart-загрузки
4. **Два RED-теста** описывают целевой контракт всей фазы:
   - `test/templateEngine.test.js` — тесты A/B: `computeMasterData` с полем `moldSize` (не `faceSize`) и параметром `moldType`, без строки «личико» для рук
   - `test/create-line.smoke.test.js` — тест C: `POST /lines` с `event.files`+`event.formFields.questionnaire`, ожидает `statusCode 200` и непустой `questionnaire.photos[]`

## Task Results

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install busboy@^1.6.0 (legitimacy verified) | bf0fcd6 | package.json, package-lock.json |
| 2 | Add node:test runner and PNG fixture | a89949e | package.json, test/fixtures/test-mold.png |
| 3 | Write RED tests A/B/C (TDD contract) | 36bf19d | test/templateEngine.test.js, test/create-line.smoke.test.js |

## TDD Gate Compliance

- **RED gate:** Commit `36bf19d` — `test(01-01): write RED tests A/B/C`
- GREEN gate: not applicable (this plan is RED-only; GREEN delivered by plans 02/03/04)
- All 3 tests fail as expected (RED confirmed): `# fail 3`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed node:test directory argument**
- **Found during:** Task 2 verification
- **Issue:** `node --test test/` fails with `Cannot find module` on Node.js v22 when passed a directory without test files. The `--test` flag requires explicit file paths or a glob pattern.
- **Fix:** Changed `scripts.test` from `node --test test/` to `node --test 'test/**/*.test.js'`
- **Files modified:** package.json
- **Commit:** 36bf19d (bundled with Task 3 commit since the fix was discovered during Task 3 verification)

None of the production code was modified (templateEngine.js, api/index.js, template.master.json, questionnaire.schema.json all unchanged).

## Why Tests Are RED (Contract Documentation)

**Test A/B (templateEngine.test.js):** Uses `moldSize` field in `sizes[]` instead of `faceSize`. Current `template.master.json` has `computedFields.priceBase = "round(priceBaseM * (faceSize / faceSizeM), 10)"` — references `faceSize`, which is undefined when questionnaire uses `moldSize`. Error: `moldWeight is not defined` (also uses `weight` not `moldWeight`).

**Test C (create-line.smoke.test.js):** Passes `event.files` and `event.formFields` instead of `event.body`. Current `handleCreateLine` reads `event.body` and JSON-parses it — returns `400 Invalid JSON body` since `event.body = ''`.

Plans 02/03/04 will make these tests GREEN by:
- Plan 02: Adding `moldType` + `moldSize` support to `template.master.json` and `templateEngine.js`
- Plan 03: Adding multipart parsing to `handleCreateLine` (reading `event.files`/`event.formFields`)

## Known Stubs

None — this plan creates test infrastructure only, no production stubs introduced.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. busboy installed after human legitimacy verification (T-01-SC threat mitigated).

## Self-Check: PASSED

- test/templateEngine.test.js: FOUND
- test/create-line.smoke.test.js: FOUND
- test/fixtures/test-mold.png: FOUND
- Commits bf0fcd6, a89949e, 36bf19d: FOUND in git log
- npm test exits with fail (RED confirmed): VERIFIED
