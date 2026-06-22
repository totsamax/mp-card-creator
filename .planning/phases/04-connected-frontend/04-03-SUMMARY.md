---
phase: 4
plan: 03
subsystem: frontend
tags: [ui, error-state, polling, optimistic-ui, running-indicator, retry]
requires:
  - "manifest.steps[stepId].{ error, failedAt } contract (Plan 04-01)"
  - "Mock-free API-driven PipelineApp.jsx (Plan 04-02)"
provides:
  - "computeStepStatus error branch (D-03): stepMeta.error → { state: 'error' } priority over done/partial"
  - "STATE_INDICATOR error key: clay ✘ glyph (D-04)"
  - "Failed-step error card: «Ошибка шага: {message}» + «Повторить шаг» button (D-05)"
  - "Optimistic running state (runningSteps) set on 202 response (D-02)"
  - "setInterval 5s polling until runningCount hits 0 with clearInterval cleanup (D-01)"
  - "«Обновить статус» manual refresh button next to VersionPicker"
affects:
  - "frontend/PipelineApp.jsx"
tech-stack:
  added: []
  patterns:
    - "computeStepStatus error branch at top of function — error state has priority over partial/done/review"
    - "setInterval keyed on runningCount useEffect with return () => clearInterval cleanup"
    - "Optimistic running: setRunningSteps on 202, cleared when manifest shows terminal state"
    - "Error text rendered via JSX text interpolation (auto-escaped, no dangerouslySetInnerHTML)"
key-files:
  created: []
  modified:
    - "frontend/PipelineApp.jsx"
decisions:
  - "D-01: Polling 5s + manual «Обновить статус» button — both present simultaneously"
  - "D-02: Optimistic running on 202 — step shows running indicator before first poll confirms it"
  - "D-03: computeStepStatus error branch at TOP — error takes priority over partial/done/review states"
  - "D-04: STATE_INDICATOR error → clay ✘ (var(--clay-dark) token only, no new red hex)"
  - "D-05: Error card shows verbatim manifest error message + «Повторить шаг» button calling handleRegenerateStep"
metrics:
  duration: ~30m
  completed: 2026-06-22
  tasks: 3
  files: 1
requirements: [UI-03, REL-01]
commits:
  - "2eaa050 — error state + ✘ indicator + failed-step view (Task 1)"
  - "f3c484f — optimistic running + 5s polling + «Обновить статус» refresh button (Task 2)"
---

# Phase 4 Plan 03: Error/Polling UI Summary

Pipeline UI now shows live step status and failures: StepperNav renders a clay ✘ for failed steps, an animated lavender «…» for running steps; a failed step's view shows the verbatim error message with a retry button; starting an async step marks it running immediately (optimistic 202) and auto-polls the manifest every 5s until terminal; a manual «Обновить статус» button forces an immediate refresh.

## What Was Built

All changes landed in `frontend/PipelineApp.jsx`. No new dependencies, no new files.

### Task 1 — Error state + ✘ indicator + failed-step view (commit 2eaa050)

- **`computeStepStatus` error branch (D-03):** Added `if (stepMeta.error) return { state: 'error' }` immediately after the `!stepMeta` guard — above the texts/images/done branches so a failed step cannot show partial/done. This reads `manifest.steps[stepId].error` (the `{ error, failedAt }` contract from Plan 01).
- **`STATE_INDICATOR` error key (D-04):** Added `error: () => <span style={{ fontSize: 10, color: 'var(--clay-dark)', flexShrink: 0 }}>✘</span>`. Clay token only — no new red hex values. Also added `running: () => <span style={{ fontSize: 10, color: 'var(--lavender)', flexShrink: 0 }}>…</span>` for the polling state.
- **Failed-step error card (D-05):** When the active step's computed status is `error`, renders an error block above `renderStep()` output showing «Ошибка шага: {manifest.steps[stepId].error}» (verbatim, auto-escaped via JSX interpolation — no `dangerouslySetInnerHTML`) and a primary button «Повторить шаг» calling `handleRegenerateStep`. Threat T-04-06 (XSS via error string) mitigated.

### Task 2 — Optimistic running + 5s polling + manual refresh (commit f3c484f)

- **`runningSteps` state (D-02):** Added `const [runningSteps, setRunningSteps] = useState({})` keyed `${lineId}.${stepKey}` → true. After a successful 202 from `handleRegenerateStep`, async steps (`texts`, `images`) immediately set their key in `runningSteps`.
- **Removed one-shot timeout:** The previous `setTimeout(() => refreshManifest(activeLineId), 3000)` was removed — interval-driven polling replaces it.
- **Polling `useEffect` (D-01):** Keyed on `[activeLineId, runningCount]`. When `runningCount > 0`, starts `const id = setInterval(() => refreshManifest(activeLineId), 5000)` and returns `() => clearInterval(id)`. After each manifest refresh, steps that now show `done`/`error`/`review` are removed from `runningSteps` — polling self-terminates when `runningCount` hits 0. Mitigates T-04-07 (runaway intervals).
- **«Обновить статус» button:** Added next to VersionPicker with `.pp-btn` secondary styling; calls `refreshManifest(activeLineId)` for an immediate manual refresh.

## Verification

- `grep -n "stepMeta.error" frontend/PipelineApp.jsx` — matches in `computeStepStatus` before the texts/images branches
- `grep -n "✘" frontend/PipelineApp.jsx` — matches in `STATE_INDICATOR.error`
- `grep -n "Ошибка шага:" frontend/PipelineApp.jsx` — matches (error card copy)
- `grep -n "Повторить шаг" frontend/PipelineApp.jsx` — matches (retry button)
- `grep -n "setInterval" / "clearInterval" frontend/PipelineApp.jsx` — both match (polling with cleanup)
- `grep -n "5000" frontend/PipelineApp.jsx` — matches (5s interval per D-01)
- `grep -n "runningSteps" frontend/PipelineApp.jsx` — matches (optimistic running state)
- `grep -n "Обновить статус" frontend/PipelineApp.jsx` — matches (manual refresh button)
- `grep -n "setTimeout(() => refreshManifest" frontend/PipelineApp.jsx` — no matches (one-shot removed)
- `cd frontend && npx vite build` — exits 0
- Human-verify checkpoint: approved by user

### Browser Testing (approved)

User confirmed in browser:
- Clay ✘ error state renders correctly in StepperNav for failed steps
- Optimistic running «…» indicator appears immediately after triggering a step (before first poll)
- 5s polling auto-updates the UI without manual intervention
- «Обновить статус» button triggers immediate manifest refresh
- Error card shows real error message with «Повторить шаг» retry button

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Step-04 video remains out of scope (deferred to v2), unchanged from Plan 02.

## Self-Check: PASSED

- frontend/PipelineApp.jsx — FOUND (modified)
- Commit 2eaa050 — Task 1 (error state + ✘ + failed-step view)
- Commit f3c484f — Task 2 (optimistic running + polling + refresh button)
- Human-verify checkpoint — approved
- UI-03: step status shows running/error/done correctly — PASS
- REL-01 (UI half): error card shows manifest error text + «Повторить шаг» — PASS
- D-01/D-02: optimistic 202, 5s polling, manual refresh button — PASS
