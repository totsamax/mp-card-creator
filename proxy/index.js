'use strict';

/**
 * Cloudflare Worker — AI API proxy.
 * Yandex Cloud Functions (RU) are blocked by OpenAI/Anthropic.
 * This worker runs on Cloudflare US edge and forwards requests.
 *
 * Env secrets (set via wrangler secret put):
 *   OPENAI_API_KEY
 *   ANTHROPIC_API_KEY
 *
 * Request format:
 *   POST /v1/chat/completions?service=openai
 *   POST /v1/images/generations?service=openai
 *   POST /v1/messages?service=anthropic
 */
export default {
  async fetch(request, env) {
    const url     = new URL(request.url);
    const service = url.searchParams.get('service');
    const apiPath = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    let targetUrl, authHeader;

    if (service === 'openai') {
      targetUrl  = `https://api.openai.com${apiPath}`;
      authHeader = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
    } else if (service === 'anthropic') {
      targetUrl  = `https://api.anthropic.com${apiPath}`;
      authHeader = {
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      };
    } else {
      return jsonResponse(400, { error: `Unknown service "${service}". Use ?service=openai or ?service=anthropic` });
    }

    try {
      const upstream = await fetch(targetUrl, {
        method:  request.method,
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    request.body,
      });

      const data   = await upstream.json();
      return jsonResponse(upstream.status, data);
    } catch (err) {
      return jsonResponse(502, { error: err.message });
    }
  },
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*' };
}
