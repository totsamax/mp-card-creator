---
phase: 5
slug: e2e-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (встроен, Node 22.22.1) + `node:assert` |
| **Config file** | none — glob в `package.json` script |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm run test:e2e` |
| **Estimated runtime** | ~15–20 мин (ограничено реальными вызовами OpenAI) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (unit-тесты — быстрые, без сети)
- **After every plan wave:** Run `npm test` зелёный
- **Before `/gsd-verify-work`:** `npm run test:e2e` зелёный ОДИН раз с реальными ключами + реальным фото
- **Max feedback latency:** ~120 seconds (unit) / ~20 мин (e2e — только при phase gate)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | REL-02 | — | OPENAI_API_KEY из env, не хардкод | e2e | `npm run test:e2e` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | REL-02 / SC-1 | — | POST /lines создаёт линейку, возвращает 201 | e2e | `npm run test:e2e` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | REL-02 / SC-1 | — | 02-texts: poll artifact-count==5, не status | e2e | `npm run test:e2e` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | REL-02 / SC-1 | — | 03-images: poll artifact-count==5, needsReview check | e2e | `npm run test:e2e` | ❌ W0 | ⬜ pending |
| 05-01-05 | 01 | 1 | REL-02 / SC-2 | — | После 06-assemble: master-data.json + тексты + PNG + xlsx существуют | e2e | `npm run test:e2e` | ❌ W0 | ⬜ pending |
| 05-01-06 | 01 | 1 | REL-02 / SC-3 | — | Ни один шаг не висит > таймаута | e2e | `npm run test:e2e` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/e2e.test.js` — оркестратор pipeline (covers REL-02, SC-1/2/3)
- [ ] `test/fixtures/e2e-face-mold.png` — реальное фото (предоставляет пользователь, D-04)
- [ ] `test/fixtures/e2e-face-questionnaire.json` — фикстура опросника (D-03)
- [ ] `.gitignore` — добавить `test/e2e-output/`
- [ ] `package.json` — добавить `test:e2e` script
- [ ] Helper wait-for-port + spawn server
- [ ] Helper `pollStep` по artifact-count

*Все Wave 0 гэпы покрываются одним планом (05-01-PLAN.md).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Реальное фото молда в тест (D-04) | REL-02 | Пользователь предоставляет перед запуском E2E | Скопировать реальное фото в `test/fixtures/e2e-face-mold.png` |
| Качество сгенерированных слайдов | D-02 (контент) | Субъективная оценка визуального качества | Открыть `test/e2e-output/{article}/03-images/v1/` и просмотреть PNG |
| xlsx открывается в Excel/LibreOffice | D-02 (xlsx) | Ручная проверка совместимости | Открыть `ozon.xlsx`, `wb.xlsx` из e2e-output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (unit) / phase gate only for E2E
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
