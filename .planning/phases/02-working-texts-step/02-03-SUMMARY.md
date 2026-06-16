---
plan: 02-03
phase: 02-working-texts-step
wave: 3
status: complete
commit: 9fb0e0f
---

# Plan 02-03 Summary — Substitution Fix + Critic Extension

## What was done

### Task 1: Fix substitution chain (BUG-01) + add topic/purpose (DEC-02)

**functions/step-texts/index.js — `generateTexts`:**
- Removed `.replace('{{faceSize}}', sizeRecord.faceSize)` (BUG-01: `faceSize` undefined since Phase 1)
- Added `.replace('{{moldSize}}', sizeRecord.moldSize)` in its place
- Added `.replace('{{topic}}', sizeRecord.topic)` and `.replace('{{purpose}}', sizeRecord.purpose)`

**layers/shared/config/prompts.texts.json:**
- Added `"- Тема товара: {{topic}}\n- Назначение: {{purpose}}\n"` after `"- Бренд: {{brand}}"` line

### Task 2: Extend and export runCritic (DEC-03)

**functions/step-texts/index.js — `runCritic`:**
- Changed signature to `function runCritic(texts, topic)`
- Added `topicKeywordCheck`: splits topic into words (length ≥ 4), checks titleFull contains at least one
- Added `noUnresolvedPlaceholders`: regex tests annotation for `{{...}}` pattern
- Added `exports.runCritic = runCritic` for unit testing

**functions/step-texts/index.js — call site (line 58):**
- Updated from `runCritic(generated)` to `runCritic(generated, sizeRecord.topic)`

**layers/shared/config/prompts.critic-texts.json:**
- Added `topicKeywordCheck` rule config
- Added `noUnresolvedPlaceholders` rule config

## Test results

| Test | Status |
|------|--------|
| TXT-02: no unresolved placeholders | GREEN |
| TXT-02: hands no лицо/личик | GREEN |
| TXT-01: all 5 sizes produce artifact | GREEN |
| TXT-03: needsReview after exhaustion | GREEN |
| TXT-03: attempts[] length === 3 | GREEN |
| DEC-03: runCritic noUnresolvedPlaceholders | GREEN |
| DEC-03: runCritic topicKeywordCheck | GREEN |
| A: templateEngine (regression) | GREEN |
| B: unknown moldType fallback (regression) | GREEN |
| C: POST /lines smoke (regression) | GREEN |

**Full suite: 10/10 GREEN.**

## Why topicKeywordCheck fires for `face` moldType in tests

- `face` topic: "Личико малыша, лицо ребёнка"
- Topic words ≥4 chars: ["личико", "малыша", "лицо", "ребёнка"]
- `templateTexts` stub titleFull: "...форма для личика куклы..." (contains "личика" not "личико")
- None of the topic words appear → critic rejects all 3 attempts → `needsReview: true`

## Why hands tests remain GREEN

- `hands` topic: "Руки куклы, кисти рук"
- Topic words ≥4 chars: ["руки", "куклы", "кисти"]
- `templateTexts` stub titleFull: "...форма для рук куклы..." (contains "куклы")
- "куклы" matches → critic passes → no recursion → `needsReview: false`
