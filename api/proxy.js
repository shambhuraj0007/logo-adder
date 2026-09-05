// api/proxy.js — Vercel Edge Function
// Proxies Twitter video URLs, adding CORS headers so the browser
// can use them in canvas (for watermarking) and FFmpeg (for MP3).
export const config = { runtime: 'edge' };

export default async function handler(req) {
  // ── Handle CORS preflight OPTIONS request ───────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Authorization',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  // ── Security: only allow twimg.com video URLs ──────────────
  if (!url) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = ['twimg.com', 'twitter.com', 'cdninstagram.com', 'fbcdn.net', 'instagram.com'].some(d => hostname.endsWith(d));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Only twimg.com, cdninstagram.com, fbcdn.net URLs are allowed' }), {
      status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // ── Forward request to Twitter CDN ─────────────────────────
  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Origin': 'https://twitter.com',
  };

  // Forward Range header so the browser can seek inside the video
  const range = req.headers.get('range');
  if (range) fetchHeaders['Range'] = range;

  let upstream;
  try {
    upstream = await fetch(url, { headers: fetchHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // ── Build response headers ──────────────────────────────────
  const resHeaders = new Headers();

  // Copy relevant upstream headers
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
    const val = upstream.headers.get(key);
    if (val) resHeaders.set(key, val);
  }

  // CORS headers — allow any origin to use this resource freely
  resHeaders.set('Access-Control-Allow-Origin', '*');
  resHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  resHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Authorization');
  resHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  resHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

  // Stream the body through without buffering — handles large videos
  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

