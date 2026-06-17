---
phase: 03-working-images-step
plan: 02
subsystem: step-images
tags: [openai-edits-api, image-in-image, recursive-retry, compositor]
requires:
  - "test/step-images.test.js (RED contract from 03-01)"
  - "store.listArtifacts/getArtifact('photos', 1)"
provides:
  - "exports.buildEditRequest(article, sizeRecord, imageType, feedback) → { prompt, imageCount }"
  - "generateImage as /v1/images/edits compositor (background + mold photos)"
  - "IMAGE_TYPES = ['infographic'] (5 dispatch messages)"
affects:
  - "functions/step-images/index.js"
  - "layers/shared/config/prompts.images.json"
  - "functions/api/index.js"
tech-stack:
  added: []
  patterns:
    - "Node built-in FormData + Blob multipart (no manual Content-Type — undici derives boundary)"
    - "Recursive local retry via exports.handler self-call threading attemptsLog"
key-files:
  created: []
  modified:
    - "functions/step-images/index.js"
    - "layers/shared/config/prompts.images.json"
    - "functions/api/index.js"
decisions:
  - "Single substitutePrompt helper shared by buildEditRequest and generateImage so the prompt string is identical in both paths"
  - "Used global-regex token replacement (/{{token}}/g) instead of String.replace so repeated tokens (e.g. {{moldName}} twice in the infographic prompt) all resolve — required for the D-09 'no unresolved {{...}}' assertion"
metrics:
  duration_min: 12
  completed: 2026-06-17
  tasks: 3
  files: 3
---

# Phase 3 Plan 2: Working Images Step (Edits-API compositor) Summary

step-images rewritten from a broken text-to-image generator into an image-in-image compositor that POSTs the background template plus all mold photos to OpenAI `/v1/images/edits`, with recursive local retry and a `buildEditRequest` export; the infographic prompt is now a composition instruction and `IMAGE_TYPES` is single-type so the dispatch produces exactly 5 messages.

## What Was Built

- **`functions/step-images/index.js` (rewrite):**
  - `generateImage(article, sizeRecord, imageType, feedback)` — gains leading `article` arg; keeps the `!apiKey` stub branch verbatim (1×1 PNG, returns before any template/photo read, D-04); reads the background template from `layers/shared/templates/{imageType}.png` (friendly `Background template not found` error → 500 on ENOENT, D-00c); reads all mold photos via `listArtifacts/getArtifact('photos', 1)`; builds `FormData` with `image[] = [background, ...photos]` and POSTs to `https://api.openai.com/v1/images/edits` with only an `Authorization` header (D-01).
  - `exports.buildEditRequest` — new async export returning `{ prompt, imageCount: 1 + photos.length }` for deterministic test assertions on the resolved prompt and photo count (IMG-03).
  - Substitution chain switched to `{{moldSize}}` (D-09) and gained `{{topic}}`/`{{purpose}}` (D-12); a shared `substitutePrompt` helper guarantees the prompt is identical across `buildEditRequest` and `generateImage`.
  - Handler: `attemptsLog = []` in destructure; 400 `'no mold photo found'` guard before generation (D-03); terminal save `attempts: [...attemptsLog, { attempt, criticVerdict }]` (D-11); critic-reject branch recurses via `exports.handler({ body: ... })` threading `attemptsLog` (D-10).
  - Deleted `enqueueRetry` and `buildAttemptsLog` — removes the only `@aws-sdk/client-sqs` usage in the file.
- **`layers/shared/config/prompts.images.json`:** `infographic` rewritten as an image-in-image composition instruction (place mold photo on background, position name heading + dimensions/size callout) carrying `{{moldName}}`, `{{moldSize}}`, `{{moldLength/Width/Height}}`, `{{topic}}`, `{{purpose}}`; every `{{faceSize}}` replaced with `{{moldSize}}` across all prompts (D-09); `feedbackSuffix`/`{{issues}}` preserved.
- **`functions/api/index.js`:** `IMAGE_TYPES = ['infographic']` (D-05) — dispatch loop untouched, yields exactly 5 messages.

## Verification

- `node --test 'test/step-images.test.js'` → **exit 0**, 6 pass / 0 fail (was RED at 3 failing).
- `grep -v '//' functions/step-images/index.js | grep -c '@aws-sdk/client-sqs'` → 0; same for `enqueueRetry` and `buildAttemptsLog`.
- File contains `v1/images/edits`, not `v1/images/generations`; no literal `faceSize`.
- `prompts.images.json` and `functions/api/index.js` both `require()`/parse cleanly.
- No new npm packages.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1+2 | Edits-API compositor + buildEditRequest export + recursive retry + 400 guard | 3a5c861 | functions/step-images/index.js |
| 3 | Composition-instruction infographic prompt + single-type IMAGE_TYPES | dd69c6b | layers/shared/config/prompts.images.json, functions/api/index.js |

Tasks 1 and 2 both modify only `functions/step-images/index.js` and are tightly coupled (the 400 guard and recursive retry depend on the rewritten handler/generateImage), so they were authored together and committed as a single atomic handler rewrite.

## Deviations from Plan

None — plan executed as written. Both TDD tasks were satisfied by a single coherent file rewrite; the prompt-token replacement uses global regex (a refinement noted in Decisions) rather than `String.replace`, which is what makes the D-09 "no unresolved placeholders" assertion pass when a token repeats.

## Known Stubs

- `generateImage` returns a 1×1 transparent PNG when `OPENAI_API_KEY` is unset (D-04, intentional — the test suite relies on it; real generation runs when the key is present).
- `runCritic` returns `{ ok: true, issues: [] }` without `ANTHROPIC_API_KEY` (intentional, per D-04 / Claude's Discretion — not to be changed in Phase 3).
- `layers/shared/templates/infographic.png` is not yet committed; real (non-stub) generation will 500 with `Background template not found` until the user supplies it (D-00c, expected).

## Self-Check: PASSED

- FOUND: functions/step-images/index.js (contains `v1/images/edits`, `exports.buildEditRequest`)
- FOUND: layers/shared/config/prompts.images.json (composition prompt, no `{{faceSize}}`)
- FOUND: functions/api/index.js (`const IMAGE_TYPES = ['infographic']`)
- FOUND commit: 3a5c861
- FOUND commit: dd69c6b
