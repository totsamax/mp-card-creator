# Phase 4: Connected Frontend - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 4 (1 frontend, 3 backend)
**Analogs found:** 4 / 4 (all in-file — this phase refactors existing code, analogs are sibling functions in the same files)

> **Key insight:** Phase 4 is a *refactor-in-place* phase, not a greenfield phase. Every file already
> exists. The best analogs are NOT in other files — they are the existing functions *within the same
> file* that already implement the correct pattern. The planner should copy from these in-file analogs
> rather than inventing new conventions. `ImagesView` (already 100% real-data, zero mock fallback) is
> the gold-standard analog the other views must converge on.

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `frontend/PipelineApp.jsx` → list/manifest hooks | hook (React) | request-response + polling | existing `useEffect`+`apiFetch('/lines')` (L819-827) and `refreshManifest` (L830-836) | exact (in-file) |
| `frontend/PipelineApp.jsx` → `computeStepStatus` + `STATE_INDICATOR` | utility/component | transform | existing `computeStepStatus` (L530-563) + `STATE_INDICATOR` (L565-570) | exact (extend in place) |
| `frontend/PipelineApp.jsx` → `VersionPicker` | component | transform | existing `VersionPicker` (L262-295) + `manifestToVersions` (L793-806) | exact (rewire source) |
| `frontend/PipelineApp.jsx` → `NormalizeView`/`TextsView` (strip mock fallback) | component | request-response | `ImagesView` (L421-471) — already pure real-data | role+flow match (in-file) |
| `frontend/PipelineApp.jsx` → `VideoView`/`ExcelView`/`AssembleView` (strip constants) | component | request-response | empty-branch of `VersionPicker` (L263-272) for "not run" copy | role match |
| `functions/api/index.js` → `runLocally` error capture | utility (async runner) | event-driven / fire-and-forget | existing `runLocally` try/catch (L56-73) + `handleCreateLine` updateManifest (L272-275) | exact (extend in place) |
| `functions/step-texts/index.js` → catch→updateManifest | handler | request-response | success-path `updateManifest` (L84-87) in same handler | exact (in-file) |
| `functions/step-images/index.js` → catch→updateManifest | handler | request-response | success-path `updateManifest` (L101-105) in same handler | exact (in-file) |

---

## Pattern Assignments

### `frontend/PipelineApp.jsx` — lines list + manifest load + polling (hook, request-response + polling)

**Analog:** existing mount-effect and `refreshManifest` in the same file. These ALREADY exist and ALREADY
work — the only changes are (a) delete the `.catch(() => {})` silent-swallow → set an error state, and
(b) add the polling interval + manual refresh.

**Existing list-load pattern to keep + harden** (L819-827):
```jsx
useEffect(() => {
  apiFetch('/lines')
    .then(data => {
      const apiLines = (data.lines || []).map(l => ({ ...l, id: l.article, name: l.moldName || l.article, theme: '', color: '', status: 'active', sizes: l.sizes || ALL_SIZES }));
      setLines(apiLines);
      setActiveLineId(apiLines[0]?.id ?? null);
    })
    .catch(() => {});   // ← REPLACE: setListError(...) instead of silent swallow (UI copy: "Не удалось загрузить линейки…")
}, []);
```
Note: `GET /lines` returns `{ lines: [{ id, article, moldName, brand, sizes, steps }] }` (api L161-181).
Empty case = `{ lines: [] }` → render empty-state CTA (D-09), NOT the deleted `LINES` constant.

**Existing manifest-load pattern to keep** (L830-836) — already correct shape `manifests[lineId]`:
```jsx
const refreshManifest = useCallback((lineId) => {
  apiFetch(`/lines/${lineId}/manifest`)
    .then(manifest => setManifests(m => ({ ...m, [lineId]: manifest })))
    .catch(() => { /* keep VERSIONS mock */ });  // ← REMOVE the mock-keeping comment; set per-line error or "Загрузка…" resolves to empty
}, []);
useEffect(() => { if (activeLineId) refreshManifest(activeLineId); }, [activeLineId, refreshManifest]);
```

**Polling pattern to ADD** (new — D-01/D-02, derived from existing `useEffect`+`refreshManifest` plumbing):
- Compute `runningCount` from `manifests[activeLineId]` via `computeStepStatus` (state === 'running').
- `useEffect` keyed on `runningCount` + `activeLineId`: if `> 0`, `setInterval(() => refreshManifest(activeLineId), 5000)`; cleanup clears it.
- Manual refresh button calls the SAME `refreshManifest(activeLineId)` (already exists — reuse, don't duplicate).
- Optimistic running: after a 202 from regenerate, the existing `handleRegenerateStep` (L848-858) already
  does `setTimeout(refreshManifest, 3000)`. Replace that with the interval-based poll + optimistic running flag.

---

### `frontend/PipelineApp.jsx` — `computeStepStatus` + `STATE_INDICATOR` (extend in place, D-03/D-04)

**Analog:** the function itself (L530-563) and the indicator map (L565-570). Add an `error` branch + key.

**Existing structure to extend** (L530-533) — add error check at the TOP (error takes priority, UI-SPEC L134):
```jsx
function computeStepStatus(stepKey, manifest, lineSizes) {
  const stepId   = STEP_KEY_TO_ID[stepKey];
  const stepMeta = manifest?.steps?.[stepId];
  if (!stepMeta) return { state: 'idle' };
  if (stepMeta.error) return { state: 'error' };   // ← ADD: D-03, priority over partial/done
  // ... existing texts/images/done branches unchanged ...
```

**Existing indicator map to extend** (L565-570) — add `error` + `running` keys following the same shape:
```jsx
const STATE_INDICATOR = {
  done:    ({ label }) => <Check size={12} style={{ color: 'var(--sage-dark)', flexShrink: 0 }} aria-hidden="true" />,
  partial: ({ label }) => <span style={{ fontSize: 10, color: 'var(--clay)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{label}</span>,
  review:  ({ label }) => <span style={{ fontSize: 10, color: 'var(--clay-dark)', flexShrink: 0 }}>⚠{label ? ` ${label}` : ''}</span>,
  idle:    () => null,
  // ← ADD (D-04, UI-SPEC L132): error → clay ✘ ; running → lavender animated …
  error:   () => <span style={{ fontSize: 10, color: 'var(--clay-dark)', flexShrink: 0 }}>✘</span>,
  running: () => <span style={{ fontSize: 10, color: 'var(--lavender)', flexShrink: 0 }}>…</span>,
};
```
**Color rule (UI-SPEC L104-106):** error uses clay family only (`--clay` / `--clay-dark`). NEVER a new red hex, NEVER lavender.

---

### `frontend/PipelineApp.jsx` — `VersionPicker` (rewire data source, D-07/D-08)

**Analog:** existing `VersionPicker` (L262-295) + `manifestToVersions` (L793-806). The component already
takes `versions[]`, already has the empty-branch (D-08), already formats `v{N} · {date}`. Two changes:
(1) delete the `VERSIONS` constant (L175-200), (2) extend the label to include `size_count`.

**Existing date-format pattern to reuse verbatim** (L802) — this is the locked ISO→ru formatter (UI-SPEC L152-153):
```jsx
h.createdAt ? new Date(h.createdAt).toLocaleDateString('ru', { day: '2-digit', month: 'short' }) : `v${i + 1}`
```

**Existing empty-branch to KEEP unchanged** (L263-272) — D-08 says preserve this:
```jsx
if (!versions || versions.length === 0) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm pp-muted">Шаг ещё не запускался</span>
      <button className="pp-btn pp-btn-primary" onClick={onRegenerate}>
        <Play size={14} aria-hidden="true" /> Запустить шаг
      </button>
    </div>
  );
}
```

**Label format change** (L284) — add unique-size count from history entries (UI-SPEC L153-154):
```jsx
// current: <option key={ver.v} value={ver.v}>v{ver.v} · {ver.date}</option>
// target:  v{N} · {date} · {size_count} разм.  (size_count = unique `size` across that version's history entries)
```
`manifestToVersions` (L793-806) is where `size_count` should be computed and threaded into each `{ v, note, date, sizeCount }`.

---

### `frontend/PipelineApp.jsx` — `NormalizeView` / `TextsView` (strip mock fallback, UI-01)

**GOLD-STANDARD ANALOG:** `ImagesView` (L421-471). It reads purely from `manifest.steps['03-images'].history`,
builds URLs, and renders an empty state — with ZERO mock fallback. `NormalizeView` and `TextsView` must
converge on this exact shape.

**`ImagesView` real-data pattern to copy** (L421-436) — no `IMAGES` constant, derives everything from manifest:
```jsx
const imgMeta = manifest?.steps?.['03-images'];
const history = imgMeta?.history || [];
const done = {};
for (const h of history) {
  const key = `${h.size}_${h.imageType}`;
  if (!done[key] || h.version > done[key].version) done[key] = h;
}
const imgUrl = (size, imageType) => {
  const h = done[`${size}_${imageType}`];
  if (!h) return null;
  return `/lines/${line.id}/steps/03-images/artifacts/${size}_${imageType}.png?version=${h.version}`;
};
```
**Empty-state pattern at end of map** (L468) — copy this idiom for normalize/texts:
```jsx
{!imgMeta && <p className="text-sm pp-muted">Изображения ещё не генерировались. Нажмите «Перегенерировать».</p>}
```

**`NormalizeView` fallback to DELETE** (L329-333) — remove the `MASTER_DATA[line.id]` branch:
```jsx
} else {
  // Fall back to mock for demo lines   ← DELETE entire else branch (UI-01)
  const mock = MASTER_DATA[line.id];
  setRows(mock?.rows ?? null);
}
```
Keep the real branch (L321-328) that fetches `/lines/:id/steps/01-normalize` and runs `apiArrayToRows`.
Replace the swallowed `.catch(() => {})` with leaving `rows = null` → existing empty-state copy (L337) already correct.

**`TextsView` fallback to DELETE** (L394-396 and L399):
```jsx
} else { setTextsData(TEXTS[line.id] || {}); }   // ← DELETE
// and:  const texts = textsData || TEXTS[line.id] || {};   ← change to: textsData || {}
```
Keep the real branch (L383-393) parsing `{size}_texts.json` from `res.data`.

---

### `frontend/PipelineApp.jsx` — `VideoView` / `ExcelView` / `AssembleView` (strip constants, D-12/D-13)

**Analog:** the empty-state idiom from `VersionPicker` (L263-272) and `ExcelView`'s own existing empty branch (L499-502).

- **`VideoView`** (L473-496): delete `const data = VIDEO[line.id] || {}` (L474). Per-size empty state
  "Видео: шаг не запущен" (UI-SPEC L174). Step-04 out of scope.
- **`ExcelView`** (L498-519): delete `VERSIONS[line.id]?.excel?.[0]` (L499). Show "Выгрузка не сформирована"
  when `manifest.steps['05-excel']` absent (D-12). Keep the existing empty-state card idiom (L501).
- **`AssembleView`** (L521-527): delete `ASSEMBLE_TREE` constant (L202-229) and the `<pre>` tree render.
  Replace with a summary derived from `manifest.steps` — list completed steps + their `currentVersion` (D-13).
  Note: `VideoView`/`ExcelView`/`AssembleView` currently receive only `line` — they must now also receive
  `manifest` (wire through `renderStep`, L897-907, same as Normalize/Texts/Images already do).

**Constants to DELETE entirely** (UI-01, L186-187): `LINES` (L86-90), `MASTER_DATA` (L95-132),
`TEXTS` (L134-154), `IMAGES` (L163-167), `VIDEO` (L169-173), `VERSIONS` (L175-200), `ASSEMBLE_TREE` (L202-229).
`STATUS_LABEL`/`STATUS_CLASS` (L92-93) stay (used by `StatusBadge`). `IMAGE_TYPES` (L156-161) stays (used by `ImagesView`).

---

### `functions/api/index.js` — `runLocally` error capture (REL-01, D-06)

**Analog:** existing `runLocally` (L56-73) already has the per-message try/catch — extend the `catch` to
write to the manifest. The exact `updateManifest` call shape is the `handleCreateLine` write (L272-275)
in the same file.

**Existing catch to extend** (L63-72):
```jsx
(async () => {
  for (const msg of messages) {
    try {
      const r = await handler({ body: JSON.stringify(msg) });
      console.log(`[local] ${stepId} ok:`, JSON.stringify(msg), '→', r.statusCode);
    } catch (err) {
      console.error(`[local] ${stepId} error:`, err.message);
      // ← ADD (D-06): await store.updateManifest(msg.article, stepId, { error: err.message, failedAt: new Date().toISOString() });
    }
  }
})().catch(console.error);
```
**Existing updateManifest shape to copy** (L272-275) — `(article, stepId, patch)`, patch is deep-merged into `manifest.steps[stepId]`:
```jsx
await store.updateManifest(article, '01-normalize', {
  currentVersion: nextVersion,
  history: [...(stepMeta?.history ?? []), historyEntry],
});
```
`store.updateManifest` (versionStore L31-48 local / L239 dispatcher) uses `deepMerge` (L250-263), so a patch
of `{ error, failedAt }` adds those fields to the step entry without clobbering `history`/`currentVersion`.

---

### `functions/step-texts/index.js` — catch → updateManifest (REL-01, D-06)

**Analog:** the success-path `updateManifest` (L84-87) in the SAME handler — identical call signature.

The handler's generation failure currently just returns 500 (L56-58):
```jsx
try {
  generated = await generateTexts(sizeRecord, feedback);
} catch (err) {
  return respond(500, { error: `LLM call failed: ${err.message}` });   // ← ALSO write error to manifest before returning
}
```
**Pattern to add** (mirroring success-path L84-87, using same `store.updateManifest(article, STEP_ID, patch)`):
```jsx
await store.updateManifest(article, STEP_ID, { error: err.message, failedAt: new Date().toISOString() });
return respond(500, { error: `LLM call failed: ${err.message}` });
```
Decision point for planner: also wrap the whole handler body in a top-level try/catch so ANY throw (not just
the LLM call) records `{ error, failedAt }` — the `api/index.js` `runLocally` catch (above) is the safety net,
but writing inside the handler keeps the manifest accurate even when invoked directly (cloud YMQ path).

---

### `functions/step-images/index.js` — catch → updateManifest (REL-01, D-06)

**Analog:** the success-path `updateManifest` (L101-105) in the SAME handler. Note this handler already
threads `overrides` into the patch conditionally — same `store.updateManifest(article, STEP_ID, patch)` call.

Generation failure currently returns 500 (L69-72):
```jsx
} catch (err) {
  console.error(`[step-images] generation failed ${size}/${imageType}:`, err.message);
  return respond(500, { error: `Image generation failed: ${err.message}` });   // ← ALSO write error to manifest
}
```
**Pattern to add** (mirroring success-path L101-105):
```jsx
await store.updateManifest(article, STEP_ID, { error: err.message, failedAt: new Date().toISOString() });
return respond(500, { error: `Image generation failed: ${err.message}` });
```
Note: critic failure is intentionally swallowed (L78-82, `criticVerdict = { ok: true }`) and must NOT be
treated as a step error — only generation/store failures write `{ error, failedAt }`.

---

## Shared Patterns

### Manifest read-merge-write via deepMerge
**Source:** `layers/shared/versionStore.js` — `updateManifest` (L31-48), dispatcher (L239), `deepMerge` (L250-263)
**Apply to:** all three backend error-handling changes (`api/index.js`, `step-texts`, `step-images`)
```jsx
async updateManifest(article, stepId, patch) { /* read manifest → deepMerge(existing, patch) → write */ }
```
- Signature is always `(article, stepId, patch)`. Arrays in `patch` REPLACE; objects DEEP-MERGE; scalars overwrite (L254-260).
- Writing `{ error, failedAt }` therefore patches `manifest.steps[stepId]` non-destructively. To CLEAR an error on
  a successful retry, the success path should also patch `{ error: null, failedAt: null }` (planner decision — not
  currently done; recommended so the `error` state clears after "Повторить шаг").

### API fetch wrapper
**Source:** `frontend/PipelineApp.jsx` — `apiFetch` (L11-18)
**Apply to:** every new GET/POST in the frontend (lines list, manifest poll, regenerate)
```jsx
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json();
}
```
Reuse as-is. Multipart submit uses the separate `submitQuestionnaire` (L21-31) — never `apiFetch` (it forces JSON Content-Type).

### Step key ↔ id mapping
**Source:** `frontend/PipelineApp.jsx` — `STEP_KEY_TO_ID` (L783-790)
**Apply to:** every place that translates a UI step key to an API step id (status, version picker, regenerate, polling)
```jsx
const STEP_KEY_TO_ID = { normalize: '01-normalize', texts: '02-texts', images: '03-images', video: '04-video', excel: '05-excel', assemble: '06-assemble' };
```

### Toast feedback
**Source:** `frontend/PipelineApp.jsx` — `showToast` (L843-846) + toast render (L941-946)
**Apply to:** poll-start, regen-start, and error messages (UI-SPEC copywriting L180-182)
```jsx
const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };
```

---

## No Analog Found

None. Every modified file already exists with a sibling/in-file analog implementing the target pattern.
The only genuinely NEW behavior is the **polling interval** (`setInterval` in a `useEffect` keyed on
running-step count), but it composes from existing primitives (`refreshManifest` + `useEffect` + `computeStepStatus`)
and needs no external reference pattern. RESEARCH.md / external patterns are NOT required for this phase.

---

## Metadata

**Analog search scope:** `frontend/PipelineApp.jsx`, `functions/api/index.js`, `functions/step-texts/index.js`,
`functions/step-images/index.js`, `layers/shared/versionStore.js`
**Files scanned:** 5
**Pattern extraction date:** 2026-06-21
