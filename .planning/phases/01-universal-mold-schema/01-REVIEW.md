---
phase: 01
plan: all
status: fixed
depth: standard
files_reviewed: 8
files_reviewed_list:
  - frontend/PipelineApp.jsx
  - functions/api/index.js
  - infra/local-server.js
  - input/questionnaire.schema.json
  - layers/shared/config/template.master.json
  - layers/shared/templateEngine.js
  - test/templateEngine.test.js
  - test/create-line.smoke.test.js
findings:
  critical: 3
  warning: 4
  info: 3
  total: 10
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-16  
**Depth:** standard  
**Files Reviewed:** 8  
**Status:** issues_found

## Summary

Phase 1 adds `moldType` support, renames `faceSize→moldSize`/`renders→photos`, wires busboy multipart parsing, and establishes TDD tests. The core logic is structurally sound, but there are three blocking issues: the `article` parameter from the URL is passed unsanitized into `path.join` (local path traversal), filename sanitization allows `..` through, and the busboy file-size limit is not checked for truncation. Four warnings cover test data mismatches that make assertions pass for the wrong reasons, a mimeType spoofing gap, and a double article check producing dead code. Three info items address minor quality concerns.

---

## Critical Issues

### CR-01: `article` from URL is unsanitized before use in filesystem paths

**File:** `layers/shared/versionStore.js:13` (called from `functions/api/index.js:107`)

**Issue:** `article` is extracted from the URL with `decodeURIComponent(lineMatch[1])` and passed directly to `articleDir(article)` which does `path.join(OUTPUT_DIR, article, ...)`. A request to `GET /lines/..%2Fetc/manifest` resolves to `OUTPUT_DIR/../etc/manifest.json`, escaping the output directory. All six storage functions (`getManifest`, `updateManifest`, `putArtifact`, `getArtifact`, `listArtifacts`, and the POST `/lines` path that accepts `article` from the JSON body) are affected in local mode.

Confirmed by: `path.join('/tmp/output', '../etc', 'manifest.json')` → `/tmp/etc/manifest.json`.

**Fix:** Validate `article` immediately after extraction in `api/index.js` before any store call:
```js
const article = decodeURIComponent(lineMatch[1]);
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(article)) {
  return respond(400, { error: 'Invalid article identifier' });
}
```
Apply the same check to the `article` field parsed from the JSON/form body in `handleCreateLine` (line 229).

---

### CR-02: Filename sanitization allows `..` and `.` as stored filenames

**File:** `functions/api/index.js:205-208`

**Issue:** The sanitization chain is `path.basename(f.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_')`. `path.basename('..')` returns `'..'` and `path.basename('.')` returns `'.'`. Both pass the `!safeName` guard and are accepted. When passed to `store.putArtifact(article, 'photos', 1, '..')` the local adapter computes `path.join(OUTPUT_DIR, article, 'photos', 'v1', '..')` which resolves to the `photos/` directory itself — writing a buffer to a directory path causes a runtime error and can be used to probe or overwrite sibling directories.

**Fix:** Reject names that are only dots, and additionally require at least one alphanumeric character:
```js
const safeName = path.basename(f.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
if (!safeName || /^\.+$/.test(safeName) || !/[a-zA-Z0-9]/.test(safeName)) {
  return respond(400, { error: 'Invalid filename in upload' });
}
```

---

### CR-03: Busboy file-size truncation is silently ignored

**File:** `infra/local-server.js:63-80`

**Issue:** Busboy is configured with `{ fileSize: 15 * 1024 * 1024, files: 10 }`. When a file exceeds the limit, busboy truncates the stream and emits a `'limit'` event on the file stream — it does **not** error out. The current code has no `stream.on('limit', ...)` handler. The truncated buffer is silently pushed into `files[]` and stored as if it were a complete file. A client uploading a 30 MB photo would get back a `200` with a corrupt, half-written image stored in the artifact store.

**Fix:**
```js
bb.on('file', (name, stream, info) => {
  const chunks = [];
  let truncated = false;
  stream.on('data', c => chunks.push(c));
  stream.on('limit', () => { truncated = true; });
  stream.on('end', () => {
    if (truncated) return; // skip this file; reject below
    files.push({ field: name, filename: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks) });
  });
});
// After bb.on('close', ...) resolve, check files.length vs original count or add a top-level truncated flag
```
Alternatively reject the whole request: set a `truncated` flag and call `reject(new Error('File too large'))` in the `limit` handler, then return a 413 from the outer catch.

---

## Warnings

### WR-01: Tests use wrong field names — assertions pass for the wrong reason

**File:** `test/templateEngine.test.js:19-23`, `test/create-line.smoke.test.js:21-25`

**Issue:** Both test files supply size rows with keys `{ width, height, weight, priceBase }` instead of the schema-required `{ moldLength, moldWidth, moldHeight, moldWeight }` plus a top-level `priceBaseM`. The `computeMasterData` formula `round(priceBaseM * (moldSize / moldSizeM), 10)` uses `priceBaseM` from the questionnaire root — which is `undefined` in the test — producing `NaN`. The NaN guard at `templateEngine.js:89-91` checks `!Object.prototype.hasOwnProperty.call(ctx, field)` before nulling the field. Because the test's size rows include a `priceBase` key, `ctx.priceBase` is already populated from the physical row spread (line 72), so the guard leaves it at `690` rather than nulling it. Test A's assertion `result[2].priceBase > 0` passes, but it is testing the wrong code path (it reads the per-size `priceBase` from the input, not the formula result).

This means the formula `round(priceBaseM * (moldSize / moldSizeM), 10)` is **never actually exercised** by the test suite. A regression in that formula would go undetected.

**Fix:** Align test data with the current schema field names:
```js
sizes: [
  { size: 'XS', moldSize: 2, moldLength: 3,   moldWidth: 1.25, moldHeight: 2.5,  moldWeight: 10 },
  // ...
],
priceBaseM: 1000,
moldName: 'TestMold', brand: 'ТопМолд', theme: 'Test', color: 'White',
```
Also add `moldName`, `brand`, `theme`, `color` — which are destructured in `computeMasterData` line 50 and injected into text templates; their absence causes `undefined` in `titleFull`.

---

### WR-02: mimeType validation trusts the client-supplied header, not the file magic bytes

**File:** `functions/api/index.js:201-202`

**Issue:** `f.mimeType` comes directly from the multipart `Content-Type` part header set by the browser. A client can upload a PHP script or SVG with active content and set `Content-Type: image/png` to bypass the check. The server stores whatever buffer arrives. For a local dev tool this is lower risk, but once the stored files are later served back via the artifact endpoint (which sets `Content-Type` from the file extension — line 330), a stored `.svg` with `Content-Type: image/svg+xml` could execute scripts in a browser.

**Fix:** Validate the first bytes of the buffer against known magic numbers before storing:
```js
function isImageMagic(buf) {
  if (!buf || buf.length < 4) return false;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50) return true;
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8) return true;
  // WEBP (RIFF....WEBP)
  if (buf.slice(8, 12).toString() === 'WEBP') return true;
  return false;
}
if (!isImageMagic(f.buffer)) return respond(400, { error: 'File is not a recognized image format' });
```

---

### WR-03: Double article validation — second check is dead code after multipart path

**File:** `functions/api/index.js:229-230`

**Issue:** In the multipart branch, `article` is validated and the function returns early at line 196 if missing. In the JSON branch (else), `questionnaire` is built from the body. The second `if (!article)` check at line 229-230 is unreachable in the multipart path (already returned) but is the only guard in the JSON path. This is fine for the JSON path, but the code comment "T-01-03-01 path traversal mitigation" is attached to the multipart block while the JSON path's `article` (which also flows into `store.putArtifact`) has no sanitization at all — only a presence check.

**Fix:** Extract article validation into a shared helper and apply it once at line 229 for both paths, with the traversal-safe pattern from CR-01:
```js
const { article } = questionnaire;
if (!article || !/^[a-zA-Z0-9_-]{1,64}$/.test(article)) {
  return respond(400, { error: 'Invalid or missing questionnaire.article' });
}
```
Remove the earlier (line 196) early return and rely on this single check.

---

### WR-04: Smoke test questionnaire is missing required fields — `computeMasterData` silently produces malformed text

**File:** `test/create-line.smoke.test.js:15-30`

**Issue:** The smoke test questionnaire omits `moldName`, `brand`, `theme`, `color`, `priceBaseM`, and `artifacts`. `computeMasterData` destructures these at line 50 of `templateEngine.js`; their absence results in `undefined` being injected into text templates. `titleFull` for the smoke test will contain `«undefined»` and `{{moldLength}}...` (unresolved tokens because size rows use `length`/`width`/`height` instead of `moldLength`/`moldWidth`/`moldHeight`). The test only asserts on `statusCode === 200` and `stepId === '01-normalize'`, so the malformed master-data goes unchecked and the test provides false confidence for the multipart flow.

**Fix:** Supply all required questionnaire fields with correct key names, and add an assertion that `body.masterData[2].titleFull` does not contain `'undefined'` or unresolved `{{...}}` tokens.

---

## Info

### IN-01: `apiFetch` always sets `Content-Type: application/json` even for non-JSON requests

**File:** `frontend/PipelineApp.jsx:11-18`

**Issue:** The `apiFetch` helper hard-codes `'Content-Type': 'application/json'` in the default headers before spreading `opts`. If `opts` contains a custom `headers`, the merge order (`headers: {...}, ...opts`) means `opts.headers` overwrites the default entirely — the Content-Type is gone. This is benign today because all callers either use GET or explicitly set `body: JSON.stringify(...)`. The comment on line 20 already documents the multipart exception. However, `opts.headers` silently overrides rather than merging, which could cause future callers to lose the JSON header unexpectedly.

**Fix:** Merge headers explicitly:
```js
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
```

---

### IN-02: Trailing double-semicolon on log line

**File:** `infra/local-server.js:110`

**Issue:** Line 110 ends with `;;` — a harmless but obvious artifact:
```js
console.log(`[api] ${req.method} ${url.pathname}${logBody}`);;
```

**Fix:** Remove the extra semicolon.

---

### IN-03: `evalExpr` is exported but is an internal implementation detail

**File:** `layers/shared/templateEngine.js:139`

**Issue:** `module.exports = { computeMasterData, round, evalExpr, renderText }` — `evalExpr` and `round` are exported along with the public API. Both use `new Function` internally. Exporting them invites callers to pass arbitrary `expr` strings from untrusted sources. Today `expr` only comes from the static `template.master.json` file, so the actual risk is low, but the export unnecessarily widens the attack surface.

**Fix:** Export only `computeMasterData`. Keep `round`, `evalExpr`, and `renderText` as unexported module-level functions. If unit tests need them, test through `computeMasterData`.

---

_Reviewed: 2026-06-16_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: standard_
