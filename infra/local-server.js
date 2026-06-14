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

  // Collect request body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString() || null;

  // Build event matching YC API Gateway format
  const event = {
    httpMethod:            req.method,
    url:                   url.pathname,
    path:                  url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers:               req.headers,
    body:                  rawBody,
    isBase64Encoded:       false,
  };

  console.log(`[api] ${req.method} ${url.pathname}`);

  const result = await handler(event).catch(err => {
    console.error('[api] unhandled:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  });

  res.writeHead(result.statusCode, {
    'Content-Type': 'application/json',
    ...corsHeaders(),
  });
  res.end(result.body);
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
