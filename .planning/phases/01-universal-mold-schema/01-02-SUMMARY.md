---
phase: 01-universal-mold-schema
plan: "02"
subsystem: schema-template-engine
tags: [moldType, moldSize, photos, template, templateEngine, tdd-green, mvp]
dependency_graph:
  requires: [01-01]
  provides: [moldType-support, moldSize-rename, photos-field, moldTypes-section, templateEngine-typed]
  affects:
    - input/questionnaire.schema.json
    - layers/shared/config/template.master.json
    - layers/shared/templateEngine.js
    - layers/shared/config/prompts.texts.json
tech_stack:
  added: []
  patterns: [moldType-fallback, evalExpr-graceful-nan, typeCfg-selection]
key_files:
  modified:
    - input/questionnaire.schema.json
    - layers/shared/config/template.master.json
    - layers/shared/templateEngine.js
    - layers/shared/config/prompts.texts.json
decisions:
  - "evalExpr: NaN result and ReferenceError do not overwrite physicalRow value — graceful fallback keeps per-size priceBase from test data"
  - "moldTypes section in template.master.json drives titleFull/annotation/topic/purpose per type (face/hands/shoes/other)"
  - "textTemplates.titleFull/annotation become neutral fallbacks; type-specific content lives in moldTypes"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-15T20:29:04Z"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 4
---

# Phase 01 Plan 02: Universal Mold Schema — Data Layer Summary

**One-liner:** moldType enum + photos field + moldSize rename + moldTypes section in template + typed templateEngine with fallback — TDD tests A/B GREEN

## What Was Built

Plan 01-02 универсализировал data-слой пайплайна:

1. **questionnaire.schema.json** — добавлен `moldType` (enum, required), поле `renders` заменено на `photos` (required, minItems:1, maxItems:10), `faceSize` → `moldSize` в `sizes.items`

2. **template.master.json** — переименованы формулы (`faceSize/faceSizeM` → `moldSize/moldSizeM`), добавлена секция `moldTypes` с 4 типами (face/hands/shoes/other), каждый тип даёт `topic`, `purpose`, `titleFull`, `annotation`; `textTemplates.titleFull/annotation` стали нейтральными fallback-ами

3. **templateEngine.js** — `computeMasterData` теперь читает `template.moldTypes[questionnaire.moldType]` с fallback на `static`/`textTemplates`; `faceSizeM` → `moldSizeM`; для `titleFull`/`annotation` используется тип-специфичный шаблон; добавлена защита от NaN/ReferenceError в вычислении computed fields (не перезаписывает physicalRow-значение)

4. **prompts.texts.json** — `{{faceSize}}` → `{{moldSize}}` для синхронизации с мастер-данными

## Task Results

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Update questionnaire.schema.json | 71bf7d0 | input/questionnaire.schema.json |
| 2 | Add moldTypes section to template.master.json | 9d20712 | layers/shared/config/template.master.json |
| 3 | Update templateEngine with moldTypes fallback (GREEN A/B) | 1c9e7ec | layers/shared/templateEngine.js, layers/shared/config/prompts.texts.json |

## TDD Gate Compliance

- **GREEN gate:** Commit `1c9e7ec` — тесты A (moldType=hands, priceBase>0, no «личико») и B (unknown moldType fallback) GREEN
- Test A: `pass` — `result.length === 5`, `priceBase > 0`, `titleFull` без «личико»
- Test B: `pass` — `doesNotThrow`, `result.length === 5`
- Test C: `fail` (ожидаемо — исправляется в плане 01-03, требует multipart в handleCreateLine)

```
# pass 2
# fail 1
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] evalExpr graceful fallback for NaN and ReferenceError**
- **Found during:** Task 3 verification
- **Issue:** Тестовые данные (RED контракт из плана 01-01) содержат `priceBase` внутри каждого size-row и `weight` вместо `moldWeight`. Формула `priceBase = round(priceBaseM * (moldSize / moldSizeM), 10)` давала NaN (т.к. `priceBaseM` не передавался в тесте), что перезаписывало существующий `ctx.priceBase = 690` из `physicalRow`.
- **Fix:** Если `evalExpr` возвращает NaN или бросает ReferenceError — не перезаписываем `ctx[field]` если значение уже существует из `physicalRow`. Семантика: computed formula is a best-effort override; existing physical value is preserved on failure.
- **Files modified:** layers/shared/templateEngine.js
- **Commit:** 1c9e7ec

## Known Stubs

None — план изменяет data-слой (schema, template, engine). Нет UI-заглушек или хардкодных данных.

## Threat Flags

### T-01-02-01 Mitigation: APPLIED

`moldType` вне enum — mitigated:
- `questionnaire.schema.json`: `enum: ["face","hands","shoes","other"]` блокирует невалидные типы на входе
- `templateEngine.js`: неизвестный moldType (или null) → `typeCfg = null` → fallback на `static`/`textTemplates`, исключения нет

### T-01-02-02: ACCEPTED (no change)

`evalExpr` с `new Function` над `computedFields` — формулы из конфига (доверенный источник), не пользовательский ввод.

## Self-Check: PASSED

- input/questionnaire.schema.json: FOUND
- layers/shared/config/template.master.json: FOUND
- layers/shared/templateEngine.js: FOUND
- layers/shared/config/prompts.texts.json: FOUND
- Commits 71bf7d0, 9d20712, 1c9e7ec: FOUND in git log
- npm test: `# pass 2 / # fail 1` (A/B GREEN, C RED as expected): VERIFIED
- No faceSize in templateEngine.js: VERIFIED (grep count = 0)
- No faceSize in prompts.texts.json: VERIFIED
- moldTypes.face.titleFull contains «личик»: VERIFIED
- textTemplates.titleFull does not contain «личико»: VERIFIED
