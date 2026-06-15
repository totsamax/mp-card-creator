---
phase: 1
slug: universal-mold-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — no test runner configured in project |
| **Config file** | none |
| **Quick run command** | `node -e "require('./layers/shared/templateEngine.js'); console.log('ok')"` |
| **Full suite command** | `npm run api` (starts server, then manual curl checks) |
| **Estimated runtime** | ~5 seconds (quick) / manual (full) |

---

## Sampling Rate

- **After every task commit:** Run quick command above
- **After every plan wave:** Manual API smoke test (see Manual-Only Verifications)
- **Before `/gsd-verify-work`:** All acceptance criteria verified manually
- **Max feedback latency:** 30 seconds (quick), manual (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INP-02 | — | N/A | manual | `node -e "const s=require('./input/questionnaire.schema.json'); console.log(s.properties.moldType?'ok':'fail')"` | ✅ | ⬜ pending |
| 01-01-02 | 01 | 1 | INP-03 | — | N/A | manual | `node -e "const t=require('./layers/shared/config/template.master.json'); console.log(t.moldTypes?'ok':'fail')"` | ✅ | ⬜ pending |
| 01-02-01 | 02 | 2 | INP-01 | — | path-traversal prevented in filename | manual | `curl -F 'photos=@/tmp/test.jpg' http://localhost:3001/lines` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | INP-01, INP-02 | — | N/A | manual | `curl -s http://localhost:3001/lines/test-article/manifest \| node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).steps?.['01-normalize']?'ok':'fail'))"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `busboy` npm package installed (`npm install busboy`) — needed for multipart parsing
- [ ] Dev server starts without error: `npm run api`

*No automated test framework to install — project uses no test runner.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Форма опросника с moldType и photos открывается в браузере | INP-01, INP-02 | React UI, нет headless browser | `npm run dev`, открыть localhost:5173, нажать «Новая карточка», убедиться что поле moldType и загрузка фото есть |
| POST /lines с FormData создаёт карточку | INP-01, INP-02 | multipart/form-data, curl неудобен для проверки UI | Заполнить форму, загрузить фото, нажать «Создать» — должна появиться карточка в списке |
| template.master.json вычисляет прайс для hands/shoes/other | INP-03 | нет теста для templateEngine | Послать опросник с moldType=hands, убедиться что master-data.json создан, priceBase не 0 |

---

## Validation Sign-Off

- [ ] questionnaire.schema.json содержит moldType (enum), photos (required), moldSize (не faceSize)
- [ ] template.master.json содержит секцию moldTypes с face/hands/shoes/other
- [ ] templateEngine.js не содержит хардкода `faceSize`
- [ ] POST /lines принимает multipart/form-data, не возвращает 400/500
- [ ] Фото сохраняется в output/{article}/photos/v1/ (local mode)
- [ ] `nyquist_compliant: true` set in frontmatter после прохождения

**Approval:** pending
