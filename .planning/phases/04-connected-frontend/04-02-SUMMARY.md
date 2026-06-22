---
phase: 4
plan: 02
subsystem: frontend
tags: [ui, api-integration, mock-removal, version-picker, empty-states]
requires:
  - "GET /lines (functions/api/index.js)"
  - "GET /lines/:id/manifest"
  - "Per-step GET endpoints (01-normalize, 02-texts, 03-images, 05-excel)"
provides:
  - "Mock-free, API-driven PipelineApp.jsx for lines/master-data/texts/images/video/excel/assemble"
  - "VersionPicker labels from real manifest history: v{N} · {date} · {N} разм."
  - "Empty-state CTA, list-load error, loading skeleton (locked UI-SPEC copy)"
  - "New line appears in sidebar without page reload (setLines append)"
affects:
  - "frontend/PipelineApp.jsx"
tech-stack:
  added: []
  patterns:
    - "React JSX text interpolation auto-escapes all server data (no dangerouslySetInnerHTML)"
    - "Optional-chaining guards on manifest?.steps?.[id] → empty-state copy on missing data"
    - "Append-on-create (setLines(prev => [...prev, newLine])) instead of full /lines re-fetch"
key-files:
  created: []
  modified:
    - "frontend/PipelineApp.jsx"
decisions:
  - "Step-04 video out of scope — VideoView always renders «Видео: шаг не запущен» placeholder"
  - "refreshManifest catch leaves manifests unchanged; per-line absence resolves to empty views"
  - "UI-02 implemented via in-place append (no window.location.reload, no /lines re-fetch)"
metrics:
  duration: "~25m"
  completed: "2026-06-22"
  tasks: 3
  files: 1
requirements: [UI-01, UI-02]
---

# Phase 4 Plan 02: Frontend Mock Removal Summary

API-driven PipelineApp.jsx — all seven hardcoded mock constants removed, every view rendered from GET /lines + manifest + per-step endpoints, with VersionPicker reading real history and locked empty/error/loading copy.

## What Was Built

Removed every hardcoded demo constant from `frontend/PipelineApp.jsx` (LINES, MASTER_DATA, TEXTS, IMAGES, VIDEO, VERSIONS, ASSEMBLE_TREE) and rewired the entire UI to read from the API. Net change: 118 insertions, 203 deletions — the UI got smaller and stopped lying with demo data («Василиса / Гномик / Ёжик» no longer appear anywhere).

### Task 1 — Delete mock constants + harden loading (commit 6f5b269)
- Deleted all seven mock constants; kept `STATUS_LABEL`/`STATUS_CLASS`/`IMAGE_TYPES`.
- Added `listError` and `listLoading` state.
- Mount effect now sets `listError` on failure (replaced silent `.catch(() => {})`) with copy «Не удалось загрузить линейки. Проверьте, что сервер запущен, и обновите страницу.».
- NormalizeView/TextsView mock fallbacks removed → existing empty-state copy renders when no step data.
- Sidebar: 3-row loading skeleton while `/lines` is in flight; list-error copy in clay text; real `lines.map` otherwise.
- No-lines empty state: «Линеек пока нет.» heading + «Создайте первую →» primary button → `setActiveTab('form')`.
- UI-02: `submitQuestionnaire` success appends the new line via `setLines(prev => [...prev, ...])` — no reload, no re-fetch.

### Task 2 — VersionPicker history + Video/Excel/Assemble real-data (commit 81b5388)
- `manifestToVersions` computes `sizeCount` (unique sizes per version) per version.
- VersionPicker label now `v{N} · {date} · {N} разм.`; empty branch «Шаг ещё не запускался» kept.
- VideoView: `VIDEO[line.id]` deleted → every size shows «Видео: шаг не запущен» (step-04 out of scope).
- ExcelView: signature `({ line, manifest })`; «Выгрузка не сформирована» when no `05-excel` step.
- AssembleView: signature `({ line, manifest })`; `<pre>{ASSEMBLE_TREE...}</pre>` replaced by per-step summary from `manifest.steps`.
- renderStep passes `manifest` to ExcelView and AssembleView.

### Task 3 — Human verify (approved)
Browser verification confirmed by user: sidebar loads from real API, data not hardcoded, UI works as designed.

## Deviations from Plan

None — plan executed exactly as written. All grep gates pass and `vite build` exits 0.

## Verification

- `grep` gates: all seven mock constants absent, no fallback reads remain, list-error / empty-state / VersionPicker «разм.» / `setLines(prev` markers all present.
- `cd frontend && npx vite build` → exits 0.
- Human-verify checkpoint: approved.

## Self-Check: PASSED

- frontend/PipelineApp.jsx — FOUND (118+/203- vs 6f5b269~1)
- Commit 6f5b269 — FOUND
- Commit 81b5388 — FOUND
- No fallback reads (MASTER_DATA[/TEXTS[/VIDEO[/VERSIONS[/ASSEMBLE_TREE[) — none remain
