---
phase: 03
slug: working-images-step
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-17
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node.js 18+) |
| **Config file** | none — built-in runner, no config needed |
| **Quick run command** | `node --test 'test/step-images.test.js'` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds (stub mode, no network) |

---

## Sampling Rate

- **After every task commit:** Run `node --test 'test/step-images.test.js'`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green (`npm test` exits 0)
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 01 | 1 | — | PNG fixture valid magic bytes | unit | `node -e "const b=require('fs').readFileSync('test/fixtures/infographic.png'); process.exit(b[0]===0x89&&b[1]===0x50?0:1)"` | ❌ W0 | ⬜ pending |
| 03-01-T2 | 01 | 1 | IMG-01,02,03,04 | RED suite (exit non-zero) | tdd-red | `node --test 'test/step-images.test.js'; test $? -ne 0` | ❌ W0 | ⬜ pending |
| 03-02-T1 | 02 | 2 | IMG-02,03 | Edits API call with image[], no key leakage | tdd-green | `node -e "const {buildEditRequest}=require('./functions/step-images/index.js');..."` | ✅ | ⬜ pending |
| 03-02-T2 | 02 | 2 | IMG-02,03 | Recursive retry up to 3 attempts | tdd-green | `node --test 'test/step-images.test.js'` | ✅ | ⬜ pending |
| 03-02-T3 | 02 | 2 | IMG-02 | IMAGE_TYPES=['infographic'], prompts updated | source | `node -e "const t=require('./functions/api/index.js')..."` | ✅ | ⬜ pending |
| 03-03-T1 | 03 | 3 | IMG-01,04 | Slides retrievable via GET, 202 on trigger | integration | `npm test` | ✅ | ⬜ pending |
| 03-03-T2 | 03 | 3 | IMG-01 | UI button triggers 202 (human verify) | manual | human checkpoint | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/fixtures/infographic.png` — 1×1 PNG stub (background template fixture)
- [ ] `test/step-images.test.js` — RED test suite (6 test cases, exits non-zero)

*Existing infrastructure: node:test runner already in use (test/step-texts.test.js). No new framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| {behavior} | REQ-{XX} | {reason} | {steps} |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 03s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}
