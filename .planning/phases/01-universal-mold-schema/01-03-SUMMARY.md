---
phase: 01-universal-mold-schema
plan: "03"
subsystem: multipart-upload
tags: [busboy, multipart, upload, api, mvp, security, path-traversal]
dependency_graph:
  requires: [01-01, 01-02]
  provides: [multipart-post-lines, photo-upload-via-versionstore, event-files-wiring]
  affects:
    - infra/local-server.js
    - functions/api/index.js
tech_stack:
  added: []
  patterns: [busboy-stream-parse, Content-Type-branching, adapter-putArtifact, filename-sanitization]
key_files:
  modified:
    - infra/local-server.js
    - functions/api/index.js
decisions:
  - "multipart parsing lives in the HTTP adapter (infra/local-server.js) — keeps handler serverless-compatible"
  - "photos saved via store.putArtifact('photos',1,...) — not direct S3, fallback is free"
  - "questionnaire.photos assigned BEFORE inputHash computation (Pitfall 4: photos invalidate cache)"
  - "skipped=true response now includes questionnaire — makes test C idempotent across repeated runs"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-15T20:40:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 01 Plan 03: Multipart Upload Wiring Summary

**One-liner:** busboy parses multipart/form-data in local-server.js, event.files wired to handleCreateLine which saves photos via versionStore with path-traversal protection — smoke test C GREEN

## What Was Built

Plan 01-03 замкнул цепочку загрузки фото молда:

1. **infra/local-server.js** — добавлена ветка по `Content-Type`:
   - `multipart/form-data` → busboy парсит поток; event получает `formFields` (map имя→значение) и `files` (массив `{field,filename,mimeType,buffer}`); лимиты DoS: fileSize 15 МБ, files 10 (T-01-03-04)
   - else → существующий JSON-путь без изменений (rawBody, event.body)
   - Логирование обновлено: при multipart пишет количество файлов, при JSON — тело

2. **functions/api/index.js** → `handleCreateLine`:
   - Новая ветка `if (event.files && event.files.length > 0)`: парсит `formFields.questionnaire` как JSON (400 при ошибке); `force = formFields.force === 'true'`
   - Для каждого файла: проверка `mimeType.startsWith('image/')` → 400 (T-01-03-03); санитизация `path.basename(filename).replace(/[^a-zA-Z0-9._-]/g,'_')` → 400 если пустое (T-01-03-01); сохранение `store.putArtifact(article,'photos',1,safeName,buffer)`
   - `questionnaire.photos = photoRefs` присваивается **до** `crypto.createHash` inputHash (Pitfall 4)
   - JSON-путь: `({ force=false, ...questionnaire } = body)` — без изменений
   - Ответ теперь включает `questionnaire` во все случаи (fresh и skipped=true) — делает тест C идемпотентным

## Task Results

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Парсить multipart в local-server.js через busboy | 97e2fc7 | infra/local-server.js |
| 2 | handleCreateLine принимает event.files, сохраняет фото, подставляет photos[] (GREEN для теста C) | 6d040d7 | functions/api/index.js |

## TDD Gate Compliance

- **GREEN gate:** Commit `6d040d7` — тест C `POST /lines with multipart event.files creates a product line` GREEN
- Итог `npm test`: `# pass 3 / # fail 0` — все три теста A/B/C проходят

```
# pass 3
# fail 0
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Добавлен questionnaire в ответ при skipped=true**
- **Found during:** Task 2 verification (повторный запуск npm test)
- **Issue:** При повторном запуске `npm test` test/tmp-output содержит уже сохранённый SMOKE01. `handleCreateLine` возвращал `{skipped: true, ...}` без поля `questionnaire`. Тест C проверяет `body.questionnaire.photos` — падал с AssertionError при повторном запуске.
- **Fix:** Добавлен `questionnaire: last.questionnaire` в ответ при `skipped=true` (строка 242). Семантика: клиент получает questionnaire который привёл к кэш-хиту.
- **Files modified:** functions/api/index.js
- **Commit:** 6d040d7 (включено в тот же коммит Task 2)

## Security Mitigations Applied

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-01-03-01 (path traversal) | MITIGATED | `path.basename(filename).replace(/[^a-zA-Z0-9._-]/g,'_')` + пустое имя → 400 |
| T-01-03-02 (field injection) | MITIGATED | handleCreateLine читает только `formFields.questionnaire` и `formFields.force` |
| T-01-03-03 (non-image upload) | MITIGATED | `mimeType.startsWith('image/')` проверка → 400 |
| T-01-03-04 (DoS large files) | MITIGATED | busboy limits: `fileSize: 15*1024*1024, files: 10` |

## Known Stubs

None — план реализует production wiring без заглушек. Фото реально сохраняются через versionStore.

## Threat Flags

None — новые security-поверхности уже описаны в threat_model плана и все mitigated выше.

## Self-Check: PASSED

- infra/local-server.js: FOUND
- functions/api/index.js: FOUND
- Commits 97e2fc7, 6d040d7: FOUND in git log
- npm test: `# pass 3 / # fail 0`: VERIFIED
- multipart branch in local-server.js: VERIFIED (grep line 60)
- event.files branch in handleCreateLine: VERIFIED (grep line 185)
- path.basename sanitization: VERIFIED (grep line 205)
- putArtifact('photos',...): VERIFIED (grep line 209)
- questionnaire.photos assigned before createHash: VERIFIED (lines 214 vs 232)
- no new S3Client in handleCreateLine: VERIFIED (grep count 0)
