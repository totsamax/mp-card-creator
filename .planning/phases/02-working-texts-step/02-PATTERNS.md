# Phase 02: Working Texts Step — Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 4
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `functions/step-texts/index.js` | step-handler | request-response + recursive retry | self (modify existing) | exact |
| `layers/shared/config/prompts.texts.json` | config | transform | self (modify existing) | exact |
| `layers/shared/config/prompts.critic-texts.json` | config | transform | self (modify existing) | exact |
| `test/step-texts.test.js` | test | CRUD | `test/create-line.smoke.test.js` | role-match |

---

## Pattern Assignments

### `functions/step-texts/index.js` (step-handler, request-response + recursive retry)

**Analog:** self — `functions/step-texts/index.js` (modify in place)

**Imports pattern** (lines 1–13, keep as-is):
```js
'use strict';

const crypto = require('crypto');
const path   = require('path');

const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');

const store        = require(path.join(SHARED, 'versionStore'));
const promptsTmpl  = require(path.join(SHARED, 'config/prompts.texts.json'));
const criticRules  = require(path.join(SHARED, 'config/prompts.critic-texts.json'));

const STEP_ID      = '02-texts';
const MAX_ATTEMPTS = 3;
```

**Core handler structure** (lines 22–92) — three sections to modify:

1. **runCritic call site (line 58)** — must pass `sizeRecord.topic` as second arg after DEC-03:
```js
// BEFORE (line 58):
const criticVerdict = runCritic(generated);

// AFTER:
const criticVerdict = runCritic(generated, sizeRecord.topic);
```

2. **Retry branch (lines 89–91)** — replace `enqueueRetry` with recursive handler call:
```js
// BEFORE (lines 89–91):
await enqueueRetry({ article, size, attempt: attempt + 1, feedback: criticVerdict.issues, force });
return respond(202, { queued: true, article, size, attempt: attempt + 1, issues: criticVerdict.issues });

// AFTER — DEC-01 recursive pattern, wrapping message in { body } as parseMessage expects:
if (!criticVerdict.ok && attempt < MAX_ATTEMPTS) {
  return exports.handler({
    body: JSON.stringify({
      article,
      size,
      attempt: attempt + 1,
      feedback: criticVerdict.issues,
      force,
      attemptsLog: [...(msg.attemptsLog ?? []), { attempt, criticVerdict }],
    }),
  });
}
```

   Note: `attemptsLog` carried forward through recursion solves Pitfall 4 (attempts[] accumulation). The final save branch must use `msg.attemptsLog` instead of `buildAttemptsLog(stepMeta, ...)` when `attemptsLog` is present in the message.

3. **Substitution chain (lines 106–115)** — fix BUG-01 and add DEC-02 fields:
```js
// BEFORE (lines 106–115):
const userPrompt = promptsTmpl.generate.user
  .replace('{{moldName}}',      sizeRecord.moldName)
  .replace('{{theme}}',         sizeRecord.theme)
  .replace('{{faceSize}}',      sizeRecord.faceSize)   // ← BUG-01: undefined
  .replace('{{moldLength}}',    sizeRecord.moldLength)
  .replace('{{moldWidth}}',     sizeRecord.moldWidth)
  .replace('{{moldHeight}}',    sizeRecord.moldHeight)
  .replace('{{color}}',         sizeRecord.color)
  .replace('{{brand}}',         sizeRecord.brand)
  .replace('{{feedbackBlock}}', feedbackBlock);

// AFTER:
const userPrompt = promptsTmpl.generate.user
  .replace('{{moldName}}',      sizeRecord.moldName)
  .replace('{{theme}}',         sizeRecord.theme)
  .replace('{{moldSize}}',      sizeRecord.moldSize)   // ★ BUG-01 fix
  .replace('{{moldLength}}',    sizeRecord.moldLength)
  .replace('{{moldWidth}}',     sizeRecord.moldWidth)
  .replace('{{moldHeight}}',    sizeRecord.moldHeight)
  .replace('{{color}}',         sizeRecord.color)
  .replace('{{brand}}',         sizeRecord.brand)
  .replace('{{topic}}',         sizeRecord.topic)      // ★ DEC-02 new
  .replace('{{purpose}}',       sizeRecord.purpose)    // ★ DEC-02 new
  .replace('{{feedbackBlock}}', feedbackBlock);
```

**`runCritic` function** (lines 191–215) — extend signature and add two rules (DEC-03):
```js
// BEFORE (line 191):
function runCritic(texts) {

// AFTER:
function runCritic(texts, topic) {
  const issues = [];

  // existing rules (lines 193–214) — keep unchanged
  for (const rule of criticRules.rules) { ... }
  for (const [field, required] of Object.entries(criticRules.requiredSubstrings)) { ... }
  for (const phrase of criticRules.bannedPhrases) { ... }

  // DEC-03 rule 1: topicKeywordCheck (dynamic, requires topic param)
  const tk = criticRules.topicKeywordCheck;
  if (tk?.enabled && topic) {
    const topicWords = topic.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 4);
    const fieldVal = (texts[tk.field] ?? '').toLowerCase();
    const hit = topicWords.some(w => fieldVal.includes(w));
    if (!hit) issues.push(tk.message);
  }

  // DEC-03 rule 2: noUnresolvedPlaceholders
  const np = criticRules.noUnresolvedPlaceholders;
  if (np?.enabled) {
    const re = new RegExp(np.pattern);
    if (re.test(texts[np.field] ?? '')) issues.push(np.message);
  }

  return { ok: issues.length === 0, issues };
}
```

**`enqueueRetry` function** (lines 221–239) — delete entirely after retry branch is replaced with recursion.

**Error handling pattern** (lines 51–55, keep as-is):
```js
let generated;
try {
  generated = await generateTexts(sizeRecord, feedback);
} catch (err) {
  return respond(500, { error: `LLM call failed: ${err.message}` });
}
```

**`parseMessage` helper** (lines 245–257) — keep as-is. The recursive call must wrap message as `{ body: JSON.stringify(msg) }` — NOT pass bare object — because `parseMessage` reads `event.body`.

**`buildAttemptsLog` helper** (lines 260–263) — keep for reference, but the new accumulation uses `msg.attemptsLog` carried through recursion. In the final save branch:
```js
// In save branch (around line 78), replace buildAttemptsLog call:
attempts: msg.attemptsLog
  ? [...msg.attemptsLog, { attempt, criticVerdict }]
  : buildAttemptsLog(stepMeta, attempt, criticVerdict),
```

**updateManifest signature** (line 81) — keep 3-argument form, do NOT use dotted-path form from DEC-01 draft:
```js
// Correct (line 81 — keep as-is):
await store.updateManifest(article, STEP_ID, {
  currentVersion: nextVersion,
  history: [...(stepMeta?.history ?? []), historyEntry],
});
```

---

### `layers/shared/config/prompts.texts.json` (config, transform)

**Analog:** self (modify in place)

**Current shape** (full file, 7 lines):
```json
{
  "generate": {
    "system": "...",
    "user": "Создай тексты...\n\nДанные товара:\n- Имя молда: {{moldName}}\n- Тема/персонаж: {{theme}}\n- Характерный размер молда: {{moldSize}} см\n..."
  },
  "feedbackBlock": "..."
}
```

**Change required** — add two lines to the "Данные товара" block in the `user` field, after `{{brand}}`:
```
- Тема товара: {{topic}}
- Назначение: {{purpose}}
```

Note: `{{moldSize}}` is ALREADY present in the template (line 4) — the bug was in the JS code (`{{faceSize}}`), not the JSON. Verify before adding a duplicate `{{moldSize}}` line.

---

### `layers/shared/config/prompts.critic-texts.json` (config, transform)

**Analog:** self (modify in place)

**Current shape** (full file, 25 lines):
```json
{
  "rules": [ ... 3 length rules ... ],
  "requiredSubstrings": { "titleShort": [], "titleFull": ["молд", "силиконовый"], "annotation": [] },
  "bannedPhrases": ["бесплатная доставка", "лучший", "100%"]
}
```

**Additions required** — two top-level keys (DEC-03):
```json
{
  "rules": [ ... unchanged ... ],
  "requiredSubstrings": { ... unchanged ... },
  "bannedPhrases": [ ... unchanged ... ],
  "topicKeywordCheck": {
    "enabled": true,
    "field": "titleFull",
    "message": "titleFull не содержит ключевых слов из темы товара"
  },
  "noUnresolvedPlaceholders": {
    "enabled": true,
    "field": "annotation",
    "pattern": "\\{\\{[^}]+\\}\\}",
    "message": "annotation содержит нераскрытый плейсхолдер"
  }
}
```

---

### `test/step-texts.test.js` (test, CRUD)

**Analog:** `test/create-line.smoke.test.js`

**Env setup pattern** (lines 1–9 of analog — copy this header):
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
process.env.USE_STUB = 'true';   // deterministic: no network calls
```

**Handler import pattern** (adapted for step-texts):
```js
const { handler } = require('../functions/step-texts/index.js');
```

**Direct handler call pattern** (NOT via api/runLocally — avoids fire-and-forget pitfall):
```js
const r = await handler({ body: JSON.stringify({ article: 'TXT01', size: 'M', attempt: 1, force: true }) });
const body = JSON.parse(r.body);
assert.strictEqual(r.statusCode, 200);
```

**Test isolation** — use unique article IDs per test to avoid cache-skip (Pitfall 5). Alternatively, always pass `force: true`.

**Test structure to cover all requirements:**

```js
// Test 1: TXT-01 — all 5 sizes produce {size}_texts.json
test('TXT-01: all 5 sizes generate texts', async () => {
  // pre-condition: master-data.json must exist — create line first via api handler
  // then call step-texts.handler for each size and assert 200 + texts present
});

// Test 2: TXT-02 — no unresolved placeholders (BUG-01 + DEC-02)
test('TXT-02: no {{...}} in generated texts', async () => {
  const r = await handler({ body: JSON.stringify({ article, size: 'M', attempt: 1, force: true }) });
  const body = JSON.parse(r.body);
  const allText = JSON.stringify(body.texts);
  assert.ok(!/\{\{[^}]+\}\}/.test(allText), 'unresolved placeholder found');
});

// Test 3: TXT-03 — critic reject triggers recursion, max 3 attempts, then needsReview:true
// Strategy: use a banned phrase that stub templateTexts will produce, or mock runCritic
// Simplest: unit-test runCritic as pure function, then test handler with article whose
// titleFull won't contain topic keywords (topicKeywordCheck will fire)
test('TXT-03: critic rule — noUnresolvedPlaceholders fires on {{...}} in annotation', async () => {
  // inject texts with placeholder directly into runCritic
  // (export runCritic or test indirectly via handler with crafted sizeRecord)
});

// Test 4: TXT-03 — attempts[] in manifest has entry for each attempt
test('TXT-03: manifest history.attempts contains all attempt verdicts', async () => {
  // after handler call, read manifest from tmp-output and assert attempts.length
});
```

**Article pre-condition pattern** (from analog lines 37–56):
```js
// Create line first so master-data.json exists for step-texts to read
const apiHandler = require('../functions/api/index.js').handler;
const createResult = await apiHandler({ httpMethod: 'POST', path: '/lines', ... });
```

---

## Shared Patterns

### Module loading (all JS files in functions/ and layers/shared/)
**Source:** `functions/step-texts/index.js` lines 1–13
```js
'use strict';
const SHARED = process.env.SHARED_LAYER_PATH || path.resolve(__dirname, '../../layers/shared');
const store = require(path.join(SHARED, 'versionStore'));
```

### respond() helper
**Source:** `functions/step-texts/index.js` lines 265–270
```js
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
```
**Apply to:** keep as-is in step-texts.

### parseMessage — event wrapping convention
**Source:** `functions/step-texts/index.js` lines 245–258 + `functions/api/index.js` line 66
```js
// runLocally wraps messages as: { body: JSON.stringify(msg) }
// Recursive retry call must do the same:
return exports.handler({ body: JSON.stringify({ ...nextMsg }) });
```
**Apply to:** recursive retry branch in step-texts handler (critical — bare object breaks parseMessage).

### updateManifest — 3-argument signature
**Source:** `functions/step-texts/index.js` line 81
```js
await store.updateManifest(article, STEP_ID, { currentVersion, history });
// NOT: store.updateManifest(article, { 'steps.02-texts.x': value })  ← wrong
```
**Apply to:** any manifest write in step-texts.

### Test env setup
**Source:** `test/create-line.smoke.test.js` lines 7–9
```js
process.env.STORE_ADAPTER = 'local';
process.env.OUTPUT_DIR = path.join(__dirname, 'tmp-output');
process.env.SHARED_LAYER_PATH = path.join(__dirname, '../layers/shared');
```
**Apply to:** `test/step-texts.test.js` header.

---

## No Analog Found

None — all 4 files have exact or role-match analogs in the codebase.

---

## Critical Implementation Notes for Planner

1. **`attemptsLog` accumulation** (Open Question 1 from RESEARCH.md) — the existing `buildAttemptsLog` reads from `stepMeta.history.slice(-1)` which is NOT updated between recursive calls (manifest only written in final save branch). Pass `attemptsLog` array through message and accumulate with each recursive call. See retry branch pattern above.

2. **`enqueueRetry` deletion scope** — remove the entire `enqueueRetry` function (lines 221–239) after replacing the call site. The function has no other callers.

3. **`{{moldSize}}` in prompts.texts.json is already there** — the bug was only in the JS `.replace('{{faceSize}}', sizeRecord.faceSize)` call. Do NOT add a second `{{moldSize}}` line to the JSON; only add `{{topic}}` and `{{purpose}}`.

4. **runCritic signature change is backward-compatible** — existing callers pass 1 arg; adding optional `topic` param with `if (tk?.enabled && topic)` guard makes DEC-03 rules no-op when `topic` is absent.

5. **Test pre-condition** — `step-texts.handler` requires `master-data.json` to exist (written by step-normalize). Tests must either call `api.handler POST /lines` first, or `store.putArtifact` the fixture directly. The analog test (`create-line.smoke.test.js`) uses the API handler route.

## Metadata

**Analog search scope:** `functions/`, `layers/shared/config/`, `test/`
**Files scanned:** 6 (step-texts/index.js, api/index.js, prompts.texts.json, prompts.critic-texts.json, create-line.smoke.test.js, templateEngine.test.js)
**Pattern extraction date:** 2026-06-16
