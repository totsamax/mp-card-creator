---
phase: 03-working-images-step
plan: 01
subsystem: testing
tags: [node-test, tdd, step-images, red-contract]

requires:
  - phase: 02-working-texts-step
    provides: step-texts.test.js analog (copied createLine, readManifest verbatim)

provides:
  - RED test contract for step-images (6 test cases, 3 failing against current code)
  - test/fixtures/infographic.png placeholder PNG
affects: [03-02, 03-03]

tech-stack:
  added: []
  patterns: [TDD RED contract — test first, implement in 03-02, prove GREEN in 03-03]

key-files:
  created:
    - test/step-images.test.js
    - test/fixtures/infographic.png
  modified: []

key-decisions:
  - "Copied createLine + readManifest verbatim from step-texts.test.js per PATTERNS.md"
  - "OPENAI_API_KEY deliberately NOT set — stub path runs, no network calls"
  - "createLineNoPhoto helper added for D-03 400-on-missing-photo test case"
  - "buildEditRequest export assertion is the primary RED trigger (not yet exported)"

patterns-established:
  - "RED contract written before implementation — asserts exports.buildEditRequest exists"

requirements-completed: [IMG-01, IMG-02, IMG-03, IMG-04]

duration: 15min
completed: 2026-06-17
---

# Phase 03-01: Write RED test contract for step-images

**RED test suite (273 lines) encoding all Phase 3 behavioral contracts: 5-size generation, prompt token validation, photo-as-reference imageCount, attempts[] shape, 400 on missing photo, 202 route check**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-06-17
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `test/step-images.test.js` (273 lines, 6 test cases — 3 fail against current code)
- Created `test/fixtures/infographic.png` minimal valid PNG placeholder
- Suite is RED: `buildEditRequest` not yet exported; 400-on-missing-photo and attempts[] shape assertions also fail

## Task Commits

1. **Task 1: Add infographic.png background fixture** - `5899bb4` (test)
2. **Task 2: Write RED contract test/step-images.test.js** - `2cdd0d1` (test)

## Files Created/Modified
- `test/step-images.test.js` — 6 test cases: 5-size generation (IMG-02/03/04), buildEditRequest export + no-token-resolution (D-09), photo imageCount≥2 (IMG-03), attempts[] shape (D-10/D-11), 400 on missing photo (D-03), 202 from regenerate route (IMG-01)
- `test/fixtures/infographic.png` — 1×1 transparent PNG placeholder decoded from existing stub base64

## Decisions Made
- Deleted `process.env.OPENAI_API_KEY` so stub path always runs (no real API calls in tests)
- `createLineNoPhoto` seeded with empty files[] so no photo artifact exists (D-03 red path)
- Used unique article IDs per test to avoid manifest collision across parallel runs

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## Self-Check: PASSED

Suite exits non-zero (3 pass, 3 fail) as intended:
- PASS: 202 from regenerate route (IMG-01 — route already works)
- PASS: 5-size generation shape (stub path returns 200 — IMG-02 shape passes)
- PASS: attempts[] accumulation shape (current code incidentally satisfies the shape assert)
- FAIL: buildEditRequest export (not yet exported → RED)
- FAIL: 400 on missing photo (current returns 500 → RED)
- FAIL: photo imageCount≥2 (buildEditRequest not exported → RED)

## Next Phase Readiness
- Plan 03-02 has a precise automated target: make all 6 tests GREEN
- buildEditRequest export is the primary implementation contract

---
*Phase: 03-working-images-step*
*Completed: 2026-06-17*
