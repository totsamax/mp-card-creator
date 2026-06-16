---
phase: 02
slug: working-texts-step
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (builtin, Node 22.22.1) + `node:assert` |
| **Config file** | none — конвенция: `test/*.test.js`, env выставляется в начале файла |
| **Quick run command** | `node --test 'test/step-texts.test.js'` |
| **Full suite command** | `npm test` (= `node --test 'test/**/*.test.js'`) |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test 'test/step-texts.test.js'`
- **After every plan wave:** Run `npm test` (полный набор — регрессия A/B/C)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | TXT-01,02,03 | T-DoS | Рекурсия терминируется ≤3 итерациями | unit (RED) | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 | ⬜ pending |
| 02-02-01 | 02 | 1 | TXT-03 | T-DoS | `attempt >= MAX_ATTEMPTS` → stop, needsReview:true | unit (GREEN) | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 | ⬜ pending |
| 02-02-02 | 02 | 1 | TXT-03 | — | Манифест `history[].attempts[]` содержит запись каждой попытки | unit | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 | ⬜ pending |
| 02-03-01 | 03 | 2 | TXT-02 | — | `moldType=hands` → titleFull не содержит «лицо»/«личик»; нет `{{...}}` | unit | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 | ⬜ pending |
| 02-03-02 | 03 | 2 | TXT-01 | — | Все 5 размеров XS-XL → файл `{size}_texts.json` существует | unit | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 | ⬜ pending |
| 02-04-01 | 04 | 2 | TXT-02,03 | — | topicKeywordCheck + noUnresolvedPlaceholders возвращают issues | unit (runCritic) | `node --test 'test/step-texts.test.js'` | ❌ Wave 0 | ⬜ pending |
| (regression) | — | — | — | — | Тесты A/B (templateEngine) и C (create-line) остаются GREEN | unit | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/step-texts.test.js` — RED тесты, покрывающие TXT-01/02/03 (рекурсия, подстановка, attempts-log, 5 размеров)
- [ ] Узкий тест на `runCritic` как чистую функцию (DEC-03 правила)
- [ ] Уникальные article-ID на каждый тест для предотвращения cache-skip (`force: true`)
- [ ] Framework install: не требуется (`node:test` builtin)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Реальный LLM-вызов генерирует нефейковые тексты | TXT-01 | Требует OPENAI_API_KEY/ANTHROPIC_API_KEY, нет в CI | Запустить `npm run api`, POST /lines/:id/steps/02-texts/regenerate, проверить output/ |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
