const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Required headers for SharedArrayBuffer & modern media without blocking cross-origin fonts
app.use((req, res, next) => {
  res.header('Cross-Origin-Opener-Policy', 'same-origin');
  res.header('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

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

// Local development proxy endpoint matching api/proxy.js
app.get('/api/proxy', async (req, res) => {
  const urlParam = req.query.url;
  if (!urlParam) {
    return res.status(400).json({ error: 'Missing url param' });
  }

  let parsed;
  try {
    parsed = new URL(urlParam);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed' });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_IP_PATTERNS.some(pat => pat.test(hostname))) {
    return res.status(403).json({ error: 'Access to private network address denied' });
  }

  const isAllowed = ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  if (!isAllowed) {
    return res.status(403).json({ error: `Domain '${hostname}' is not authorized for proxying` });
  }

  const isInstagram = hostname.includes('instagram') || hostname.includes('fbcdn');
  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': isInstagram ? 'https://www.instagram.com/' : 'https://twitter.com/',
    'Origin': isInstagram ? 'https://www.instagram.com' : 'https://twitter.com',
  };

  if (req.headers.range) fetchHeaders['Range'] = req.headers.range;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const upstream = await fetch(parsed.toString(), {
      method: req.method,
      headers: fetchHeaders,
      signal: controller.signal,
      redirect: 'follow',
    });

    res.status(upstream.status);

    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag']) {
      const val = upstream.headers.get(key);
      if (val) res.setHeader(key, val);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!upstream.body) {
      return res.end();
    }

    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return res.status(502).json({ error: isTimeout ? 'Upstream request timed out' : err.message });
  } finally {
    clearTimeout(timeoutId);
  }
});

// Serve static files (HTML, CSS, JS) from the current directory
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open this URL in your browser to test.`);
});
