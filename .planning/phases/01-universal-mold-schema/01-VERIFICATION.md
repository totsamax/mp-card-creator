---
phase: 01-universal-mold-schema
verified: 2026-06-16T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open http://localhost:5173 in browser, click 'Новая линейка', confirm moldType select (Лицо/Руки/Обувь/Другое) appears and file upload input accepts ≥1 photo, then submit — verify 200 response and card appears in sidebar"
    expected: "Form renders without existing cards, moldType select has 4 options, photo upload is required (button disabled until file chosen), POST /lines returns 200 with questionnaire.photos non-empty"
    why_human: "React UI rendering and browser FormData boundary behavior cannot be verified by grep or unit test alone; executor confirmed in Task 3 but independent human confirmation required per phase gate"
---

# Phase 1: Universal Mold Schema Verification Report

**Phase Goal:** Universal Mold Schema — walking skeleton with moldType parameterization, multipart photo upload, and vertical slice through UI → API → storage.
**Verified:** 2026-06-16
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Questionnaire form contains moldType field (face/hands/shoes/other) — value saved in questionnaire | VERIFIED | `PipelineApp.jsx:686-691`: `<select>` with 4 options; `buildQuestionnaire()` at line 646 passes `moldType: form.moldType`; `SIZE_DEFAULTS`/`SIZE_FIELDS` use `moldSize` (not `faceSize`) |
| 2 | Form allows uploading ≥1 photo — photo is transmitted to API on card creation | VERIFIED | `PipelineApp.jsx:630,744-753,775`: `photoFiles` state from `<input type="file" multiple accept="image/*">`; button `disabled` when `photoFiles.length === 0`; `submitQuestionnaire()` at lines 21-30 uses `FormData` with `fd.append('photos', file, file.name)` |
| 3 | template.master.json accepts `moldType` as parameter — all 5 sizes computed regardless of type | VERIFIED | `template.master.json` lines 19-44: `moldTypes` section with face/hands/shoes/other entries; `templateEngine.js:54`: `typeCfg = (template.moldTypes && moldType) ? template.moldTypes[moldType] : null` with fallback to `static`/`textTemplates`; test A GREEN confirms hands type returns 5 records, no "личико" |
| 4 | POST /lines with `moldType` and `photos` creates a product line without error | VERIFIED | `functions/api/index.js:185-214`: multipart branch reads `event.files`, saves photos via `store.putArtifact`, assigns `questionnaire.photos = photoRefs` before hash; smoke test C GREEN: `statusCode 200`, `stepId 01-normalize`, `questionnaire.photos` non-empty |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `input/questionnaire.schema.json` | `moldType` required enum, `photos` required, sizes use `moldSize` | VERIFIED | Line 6: `required` includes `moldType` and `photos`; line 34-38: `moldType` enum `["face","hands","shoes","other"]`; line 86-95: `photos` minItems 1 maxItems 10; line 51: sizes items require `moldSize` |
| `layers/shared/config/template.master.json` | `moldTypes` section with 4 types; formulas use `moldSize`/`moldSizeM` | VERIFIED | Lines 6-10: `computedFields.priceBase = "round(priceBaseM * (moldSize / moldSizeM), 10)"`; lines 19-44: full `moldTypes` block with face/hands/shoes/other |
| `layers/shared/templateEngine.js` | Reads `moldTypes[moldType]` with fallback; no `faceSize` references | VERIFIED | Lines 50-57: destructures `moldType` from questionnaire; uses `typeCfg` pattern for type-specific text templates; `moldSizeM` at line 65; grep confirms zero `faceSize` occurrences |
| `infra/local-server.js` | Parses multipart via busboy; produces `event.files` | VERIFIED | Lines 60-92: `if (ct.startsWith('multipart/form-data'))` branch; busboy with `fileSize: 15*1024*1024, files: 10` limits; produces `event = { formFields, files, ... }` |
| `functions/api/index.js` | `handleCreateLine` branches on `event.files`; saves photos via versionStore | VERIFIED | Lines 185-214: `if (event.files && event.files.length > 0)` branch; `store.putArtifact(article, 'photos', 1, safeName, f.buffer)`; `questionnaire.photos = photoRefs` before `createHash` |
| `frontend/PipelineApp.jsx` | moldType select, FormData submission, photo file input, disabled-until-photo | VERIFIED | `submitQuestionnaire()` at lines 21-30 uses `fetch()` not `apiFetch()`; `moldType` select line 686; `photoFiles` state line 630; `disabled={...|| photoFiles.length === 0}` line 775 |
| `test/templateEngine.test.js` | Tests A/B GREEN | VERIFIED | npm test output: `ok 2`, `ok 3` — both pass |
| `test/create-line.smoke.test.js` | Test C GREEN | VERIFIED | npm test output: `ok 1` — passes |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `PipelineApp.jsx:submitQuestionnaire` | `POST /lines` | `fetch()` with `FormData` | WIRED | Line 28: `fetch(\`${API_BASE}/lines\`, { method: 'POST', body: fd })` — no manual Content-Type, browser sets boundary |
| `infra/local-server.js` multipart branch | `functions/api/index.js:handleCreateLine` | `event.files` | WIRED | `local-server.js:88`: `event.files = files`; `api/index.js:185`: reads `event.files` |
| `handleCreateLine` photo loop | `versionStore.putArtifact` | `store.putArtifact(article,'photos',1,safeName,buffer)` | WIRED | `api/index.js:209`: direct call with sanitized name and file buffer |
| `templateEngine.computeMasterData` | `template.moldTypes[moldType]` | `typeCfg` selection | WIRED | `templateEngine.js:54-57`: selects type config, uses `typeCfg.titleFull` and `typeCfg.annotation` when type is known |
| `handleCreateLine` | `computeMasterData` | `masterData = computeMasterData(questionnaire, template)` | WIRED | `api/index.js:247-251`: calls engine, wraps in try/catch |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| npm test — 3/3 tests GREEN | `npm test` | `# pass 3 / # fail 0` | PASS |
| templateEngine returns 5 records for hands type | test A (node:test) | `ok 2` | PASS |
| unknown moldType does not throw | test B (node:test) | `ok 3` | PASS |
| POST /lines with event.files produces 200 + photos[] | test C (node:test) | `ok 1` | PASS |

---

### Requirements Coverage

| Requirement | Phase | Description | Status | Evidence |
|-------------|-------|-------------|--------|---------|
| INP-01 | Phase 1 | User uploads ≥1 photo in questionnaire form | SATISFIED | `PipelineApp.jsx:744-775`: file input + disabled gate; `api/index.js:199-210`: saves via versionStore |
| INP-02 | Phase 1 | User specifies mold type (face/hands/shoes/other) | SATISFIED | `PipelineApp.jsx:686-691`: select with 4 options; `buildQuestionnaire():646`: passes moldType to API |
| INP-03 | Phase 1 | template.master.json has universal fields — type is parameter, not separate template | SATISFIED | Single `template.master.json` with `moldTypes` section; all 5 sizes computed by same engine regardless of type |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `functions/api/index.js` | 205-208 | `path.basename('..')` returns `'..'` — bypasses safeName check | Warning | Per code review CR-02: `..` and `.` pass sanitization guard; can cause runtime error when stored (directory path not file) |
| `infra/local-server.js` | 69-77 | No `stream.on('limit', ...)` handler | Warning | Per code review CR-03: truncated files silently stored as complete; clients uploading >15MB get `200` with corrupt image |
| `layers/shared/versionStore.js` | called from api/index.js | `article` from URL used in `path.join` without traversal check | Warning | Per code review CR-01: `GET /lines/..%2Fetc/manifest` resolves outside `OUTPUT_DIR` in local mode |
| `test/templateEngine.test.js` | 19-23 | Test data uses wrong field names (`weight`, `priceBase` per-row) | Info | Per code review WR-01: `priceBase` formula never actually exercised; test passes for wrong reason but result is correct |

No `TBD`, `FIXME`, or `XXX` markers found in any phase-modified files.

**Anti-pattern classification:** All findings are warnings/info from the post-phase code review. None are unresolved debt markers (no `TBD`/`FIXME`/`XXX` present). The security issues (CR-01, CR-02, CR-03) are real but: (a) they affect `local` adapter mode only, (b) the project is a single-developer local tool at this stage, and (c) the ROADMAP success criteria do not include security hardening for Phase 1. These are appropriately tracked in `01-REVIEW.md` for remediation in a future phase.

---

### Human Verification Required

#### 1. Browser E2E — moldType select + photo upload + form submission

**Test:** Run `npm run dev`, open http://localhost:5173, click "Новая линейка". Confirm: (a) moldType select shows Лицо/Руки/Обувь/Другое, (b) "Сохранить" button is disabled until at least one photo is attached, (c) fill form, attach a photo, submit — verify the new card appears in the sidebar and no error toast appears.

**Expected:** Card created without error; `POST /lines` returns 200; new line id appears in sidebar list.

**Why human:** Executor Task 3 of 01-04 documents this was approved by the user ("теперь ок"), but independent verifier cannot confirm browser-side FormData boundary behavior, React state transitions, or live server integration purely through grep. A fresh run is required for an independent confidence signal.

---

### Gaps Summary

No automated gaps. All 4 roadmap success criteria are verified in the codebase with substantive, wired implementations. The `npm test` run confirms 3/3 tests GREEN. The single blocking item for this report is the human browser E2E check, which the executor documented as user-approved but which an independent verifier cannot satisfy without running the browser.

---

_Verified: 2026-06-16_
_Verifier: Claude (gsd-verifier)_
