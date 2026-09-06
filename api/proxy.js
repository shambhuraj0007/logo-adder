// api/proxy.js — Vercel Edge Function
// Securely proxies Twitter/Instagram media and API endpoints, adding CORS and CORP headers
// so the browser can process media in Canvas, Web Audio, and MediaRecorder.
export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'twimg.com',
  'twitter.com',
  'x.com',
  't.co',
  'cdninstagram.com',
  'fbcdn.net',
  'instagram.com',
  'threads.net',
  'twitsave.com',
  'ddinstagram.com',
  'fxtwitter.com',
  'vxtwitter.com',
  'fixupx.com',
];

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
];

function corsResponse(body, status, customHeaders = {}) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Authorization',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...customHeaders,
  });
  return new Response(body, { status, headers });
}

export default async function handler(req) {
  // ── Handle CORS preflight OPTIONS request ───────────────────
  if (req.method === 'OPTIONS') {
    return corsResponse(null, 204, { 'Access-Control-Max-Age': '86400' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405, { 'Content-Type': 'application/json' });
  }

  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get('url');

  if (!urlParam) {
    return corsResponse(JSON.stringify({ error: 'Missing url param' }), 400, { 'Content-Type': 'application/json' });
  }

  let parsed;
  try {
    parsed = new URL(urlParam);
  } catch {
    return corsResponse(JSON.stringify({ error: 'Invalid URL format' }), 400, { 'Content-Type': 'application/json' });
  }

  // Enforce HTTPS or HTTP
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return corsResponse(JSON.stringify({ error: 'Only HTTP/HTTPS URLs are allowed' }), 400, { 'Content-Type': 'application/json' });
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block private network / SSRF attacks
  if (PRIVATE_IP_PATTERNS.some(pat => pat.test(hostname))) {
    return corsResponse(JSON.stringify({ error: 'Access to private network address denied' }), 403, { 'Content-Type': 'application/json' });
  }

  // Strict domain validation: exact match or subdomain
  const isAllowed = ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  if (!isAllowed) {
    return corsResponse(
      JSON.stringify({ error: `Domain '${hostname}' is not authorized for proxying` }),
      403,
      { 'Content-Type': 'application/json' }
    );
  }

  // Forward request headers
  const isInstagram = hostname.includes('instagram') || hostname.includes('fbcdn');
  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': isInstagram ? 'https://www.instagram.com/' : 'https://twitter.com/',
    'Origin': isInstagram ? 'https://www.instagram.com' : 'https://twitter.com',
  };

  const range = req.headers.get('range');
  if (range) fetchHeaders['Range'] = range;

  // Timeout guard (25 seconds) to prevent edge connection hanging
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  let upstream;
  try {
    upstream = await fetch(parsed.toString(), {
      method: req.method,
      headers: fetchHeaders,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    return corsResponse(
      JSON.stringify({ error: isTimeout ? 'Upstream request timed out' : 'Upstream connection failed: ' + err.message }),
      502,
      { 'Content-Type': 'application/json' }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Build response headers
  const resHeaders = new Headers();
  const passThrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag'];
  for (const key of passThrough) {
    const val = upstream.headers.get(key);
    if (val) resHeaders.set(key, val);
  }

  // Enforce CORS & CORP headers
  resHeaders.set('Access-Control-Allow-Origin', '*');
  resHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  resHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Authorization');
  resHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  resHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}
