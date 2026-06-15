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
try {
  const envPath = path.resolve(__dirname, '../.env.local');
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  });
} catch { /* .env.local not present — ok */ }
const { handler } = require(path.resolve(__dirname, '../functions/api'));

const PORT = process.env.PORT || 3001;

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

  if (ct.startsWith('multipart/form-data')) {
    // busboy parses multipart stream into memory; handler receives formFields + files
    const Busboy = require('busboy');
    const { fields, files } = await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers, limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
      const fields = {};
      const files = [];
      bb.on('field', (name, val) => { fields[name] = val; });
      bb.on('file', (name, stream, info) => {
        const chunks = [];
        stream.on('data', c => chunks.push(c));
        stream.on('end', () => files.push({
          field: name,
          filename: info.filename,
          mimeType: info.mimeType,
          buffer: Buffer.concat(chunks),
        }));
      });
      bb.on('close', () => resolve({ fields, files }));
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
  console.log(`[api] ${req.method} ${url.pathname}${logBody}`);;

  const result = await handler(event).catch(err => {
    console.error('[api] unhandled:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  });

  if (result.statusCode >= 400) {
    console.warn(`[api] ${result.statusCode} ${req.method} ${url.pathname} → ${result.body}`);
  }

  const contentType = result.headers?.['Content-Type'] || 'application/json';
  res.writeHead(result.statusCode, {
    'Content-Type': contentType,
    ...corsHeaders(),
  });
  if (result.isBase64Encoded && result.body) {
    res.end(Buffer.from(result.body, 'base64'));
  } else {
    res.end(result.body);
  }
}).listen(PORT, () => {
  console.log(`[local-server] API listening on http://localhost:${PORT}`);
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
