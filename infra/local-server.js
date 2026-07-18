'use strict';

// Thin HTTP wrapper around functions/api/index.js handler.
// Translates plain Node.js HTTP requests into the YC API Gateway event format.
//
// Usage:
//   PORT=3001 node infra/local-server.js   (loads .env.local automatically)
//   (or via `npm run dev`)

const http = require('http');
const path = require('path');
const fs   = require('fs');

// File logger — writes timestamped lines to logs/api.log (rotates at 10 MB)
const LOG_FILE = path.resolve(__dirname, '../logs/api.log');
const LOG_MAX  = 10 * 1024 * 1024;
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX) {
  fs.renameSync(LOG_FILE, LOG_FILE + '.old');
}
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function patchConsole(method) {
  const orig = console[method].bind(console);
  console[method] = (...args) => {
    orig(...args);
    const line = `[${new Date().toISOString()}] [${method}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
    logStream.write(line);
  };
}
['log', 'warn', 'error'].forEach(patchConsole);

// Load .env.local from project root (if present) — does not override existing vars
let envLoaded = 0;
try {
  const envPath = path.resolve(__dirname, '../.env.local');
  // Normalize all line-ending variants (CRLF, LF, bare CR) before splitting
  fs.readFileSync(envPath, 'utf8')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n')
    .forEach(line => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
        envLoaded++;
      }
    });
} catch { /* .env.local not present — ok */ }
const { handler } = require(path.resolve(__dirname, '../functions/api'));

const PORT = process.env.PORT || 3001;

// Startup diagnostic — confirms which AI keys are present (values masked)
console.log(`[local-server] .env.local loaded ${envLoaded} vars`);
console.log(`[local-server] OPENAI_API_KEY   : ${process.env.OPENAI_API_KEY   ? process.env.OPENAI_API_KEY.slice(0,6)+'***' : '(not set)'}`);
console.log(`[local-server] OPENAI_BASE_URL  : ${process.env.OPENAI_BASE_URL  || '(not set)'}`);
console.log(`[local-server] OPENAI_IMAGE_MODEL: ${process.env.OPENAI_IMAGE_MODEL || '(not set, default gpt-image-1)'}`);
console.log(`[local-server] OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.slice(0,6)+'***' : '(not set)'}`);
console.log(`[local-server] STORE_ADAPTER    : ${process.env.STORE_ADAPTER    || '(not set, default yandex-cloud)'}`);
console.log(`[local-server] WEBHOOK_URL      : ${process.env.WEBHOOK_URL      || '(not set — step-completion notifications disabled)'}`);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // Collect request body — branch on Content-Type
  const ct = req.headers['content-type'] || '';
  let event;

  try {
    if (ct.startsWith('multipart/form-data')) {
      // busboy parses multipart stream into memory; handler receives formFields + files
      const Busboy = require('busboy');
      const { fields, files } = await new Promise((resolve, reject) => {
        const bb = Busboy({ headers: req.headers, limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
        const fields = {};
        const files = [];
        let truncatedCount = 0;
        bb.on('field', (name, val) => { fields[name] = val; });
        bb.on('file', (name, stream, info) => {
          const chunks = [];
          let fileTruncated = false;
          stream.on('data', c => chunks.push(c));
          stream.on('limit', () => { fileTruncated = true; truncatedCount = truncatedCount + 1; });
          stream.on('end', () => {
            if (fileTruncated) return; // skip truncated file; reject below on close
            files.push({
              field: name,
              filename: info.filename,
              mimeType: info.mimeType,
              buffer: Buffer.concat(chunks),
            });
          });
        });
        bb.on('close', () => {
          if (truncatedCount > 0) {
            return reject(new Error(`File too large: ${truncatedCount} file(s) exceeded 15 MB limit`));
          }
          resolve({ fields, files });
        });
        bb.on('error', reject);
        req.pipe(bb);
      });
      event = {
        httpMethod:            req.method,
        url:                   url.pathname,
        path:                  url.pathname,
        queryStringParameters: Object.fromEntries(url.searchParams),
        headers:               req.headers,
        formFields:            fields,
        files,
        body:                  null,
        isBase64Encoded:       false,
      };
    } else {
      // JSON path — existing logic unchanged
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString() || null;
      event = {
        httpMethod:            req.method,
        url:                   url.pathname,
        path:                  url.pathname,
        queryStringParameters: Object.fromEntries(url.searchParams),
        headers:               req.headers,
        body:                  rawBody,
        isBase64Encoded:       false,
      };
    }

    const logBody = event.body && event.body.length < 500 ? ' body=' + event.body : (event.files ? ` files=${event.files.length}` : '');
    console.log(`[api] ${req.method} ${url.pathname}${logBody}`);

    const result = await handler(event).catch(err => {
      console.error('[api] unhandled:', err);
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    });

    if (result.statusCode >= 400) {
      console.warn(`[api] ${result.statusCode} ${req.method} ${url.pathname} → ${result.body}`);
    }

    const resultHeaders = result.headers || {};
    const responseHeaders = { 'Content-Type': resultHeaders['Content-Type'] || 'application/json', ...corsHeaders() };
    if (resultHeaders['Content-Disposition']) responseHeaders['Content-Disposition'] = resultHeaders['Content-Disposition'];
    res.writeHead(result.statusCode, responseHeaders);
    if (result.isBase64Encoded && result.body) {
      res.end(Buffer.from(result.body, 'base64'));
    } else {
      res.end(result.body);
    }
  } catch (err) {
    const isTooLarge = err.message && err.message.startsWith('File too large');
    const statusCode = isTooLarge ? 413 : 500;
    console.error(`[api] ${statusCode} ${req.method} ${url.pathname}:`, err.message);
    res.writeHead(statusCode, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, () => {
  console.log(`[local-server] API listening on http://localhost:${PORT}`);
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
