/* ==========================================
   app.js — VideoX Downloader (Twitter/X & Instagram)
   Hardened for long-term stability, zero-hang video
   recording, robust API fallbacks, and memory safety.
   ========================================== */

// -------- Particle background --------
(function initParticles() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H;
  const particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.r = Math.random() * 1.8 + 0.3;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = (Math.random() - 0.5) * 0.3;
      this.alpha = Math.random() * 0.4 + 0.1;
      this.hue = Math.random() > 0.5 ? '29,155,240' : '168,85,247';
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.hue},${this.alpha})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < 100; i++) particles.push(new Particle());
  (function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(loop);
  })();
})();

// -------- DOM Refs --------
const tweetInput = document.getElementById('tweetUrl');
const clearBtn = document.getElementById('clearBtn');
const previewVideo = document.getElementById('previewVideo');
const previewWrap = document.getElementById('previewWrap');
const overlayWm = document.getElementById('videoOverlayWm');
const wmDownloadBtn = document.getElementById('wmDownloadBtn');
const mp3DownloadBtn = document.getElementById('mp3DownloadBtn');
const wmProgressWrap = document.getElementById('wmProgressWrap');
const wmFill = document.getElementById('wmFill');
const wmStatus = document.getElementById('wmStatus');

// Currently selected video state & active blob URLs (tracked to prevent memory leaks)
let activeVideoUrl = null;
let activeQualLabel = 'video';
let currentPreviewBlobUrl = null;

function cleanupPreviewBlob() {
  if (currentPreviewBlobUrl) {
    try { URL.revokeObjectURL(currentPreviewBlobUrl); } catch (_) {}
    currentPreviewBlobUrl = null;
  }
}

// -------- Clear button --------
tweetInput.addEventListener('input', () => {
  clearBtn.classList.toggle('visible', tweetInput.value.length > 0);
  hideError();
  hideResults();
});
clearBtn.addEventListener('click', () => {
  tweetInput.value = '';
  clearBtn.classList.remove('visible');
  hideError();
  hideResults();
  tweetInput.focus();
});

// -------- UI Helpers --------
function showError(msg) {
  const el = document.getElementById('errorMsg');
  const safeMsg = typeof msg === 'string' ? msg : 'An unexpected error occurred.';
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${safeMsg}`;
  el.classList.add('visible');
}

function hideError() {
  document.getElementById('errorMsg').classList.remove('visible');
}

function showLoading(text) {
  const wrap = document.getElementById('loadingWrap');
  wrap.querySelector('.loading-text').textContent = text || 'Fetching video links…';
  wrap.classList.add('visible');
  animateBar();
}

function hideLoading() {
  document.getElementById('loadingWrap').classList.remove('visible');
  document.getElementById('loadingFill').style.width = '0';
}

function showResults() {
  document.getElementById('resultsWrap').classList.add('visible');
}

function hideResults() {
  document.getElementById('resultsWrap').classList.remove('visible');
  document.getElementById('qualityGrid').innerHTML = '';
  previewWrap.classList.remove('visible');
  overlayWm.classList.remove('visible');
  cleanupPreviewBlob();
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
  }
  activeVideoUrl = null;
}

function animateBar() {
  const fill = document.getElementById('loadingFill');
  fill.style.width = '0';
  let w = 0;
  const iv = setInterval(() => {
    w += Math.random() * 14 + 5;
    if (w >= 88) {
      clearInterval(iv);
      w = 88;
    }
    fill.style.width = w + '%';
  }, 180);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// -------- Validation --------
function isValidTwitterUrl(url) {
  return /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i.test(url);
}

function isValidInstagramUrl(url) {
  return /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(p|reel|reels|tv)\/[\w-]+/i.test(url);
}

function extractTweetId(url) {
  const m = url.match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractInstagramShortcode(url) {
  const m = url.match(/\/(p|reel|reels|tv)\/([\w-]+)/i);
  return m ? m[2] : null;
}

// Helper to fetch through internal proxy with fallback
async function fetchProxied(targetUrl) {
  // First attempt: internal /api/proxy
  try {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`);
    if (res.ok) return res;
  } catch (_) {}

  // Second attempt: public corsproxy fallback if internal is inaccessible
  try {
    const res2 = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
    if (res2.ok) return res2;
  } catch (_) {}

  throw new Error(`Failed to fetch upstream resource: ${targetUrl}`);
}

// -------- Main fetch (Hybrid: Twitter & Instagram) --------
async function fetchVideo() {
  const raw = tweetInput.value.trim();
  hideError();
  hideResults();
  if (!raw) {
    showError('Please paste a Twitter/X or Instagram link first.');
    tweetInput.focus();
    return;
  }

  const isTwitter = isValidTwitterUrl(raw);
  const isInstagram = isValidInstagramUrl(raw);

  if (!isTwitter && !isInstagram) {
    showError('Please enter a valid link from <b>Twitter/X</b> (e.g. <code>x.com/user/status/123</code>) or <b>Instagram</b> (e.g. <code>instagram.com/reel/...</code>).');
    return;
  }

  const btn = document.getElementById('fetchBtn');
  btn.classList.add('loading');
  btn.querySelector('.btn-text').textContent = 'Fetching…';
  showLoading(isInstagram ? 'Fetching Instagram Reel…' : 'Fetching Twitter video…');

  try {
    let variants;
    if (isTwitter) {
      const tweetId = extractTweetId(raw);
      if (!tweetId) throw new Error('Could not find a tweet ID in this URL.');
      variants = await fetchWithApis(raw, tweetId);
    } else {
      const shortcode = extractInstagramShortcode(raw);
      if (!shortcode) throw new Error('Could not extract Instagram shortcode.');
      variants = await fetchFromInstagram(raw, shortcode);
    }

    if (!variants || !variants.length) {
      throw new Error('No downloadable video streams found for this post.');
    }

    document.getElementById('loadingFill').style.width = '100%';
    await sleep(250);
    hideLoading();
    buildQualityCards(variants);
    showResults();
  } catch (err) {
    hideLoading();
    showError(err.message || 'Failed to fetch video. Make sure the post is public and contains a video.');
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('.btn-text').textContent = 'Get Video';
  }
}

// -------- Twitter API Redundancy Chain --------
async function fetchWithApis(url, tweetId) {
  // Method 1: fxtwitter
  try {
    const res = await fetchFromFxTwitter(tweetId);
    if (res && res.length) return res;
  } catch (_) {}

  // Method 2: vxtwitter
  try {
    const res = await fetchFromVxTwitter(tweetId);
    if (res && res.length) return res;
  } catch (_) {}

  // Method 3: fixupx
  try {
    const res = await fetchFromFixupx(tweetId);
    if (res && res.length) return res;
  } catch (_) {}

  // Method 4: twitsave scraper
  try {
    const res = await fetchFromTwitsave(url);
    if (res && res.length) return res;
  } catch (_) {}

  throw new Error('Could not retrieve video links. The tweet may be private, age-restricted, or contains no video.');
}

async function fetchFromFxTwitter(tweetId) {
  const resp = await fetch(`https://api.fxtwitter.com/i/status/${tweetId}`);
  if (!resp.ok) throw new Error('fxtwitter failed');
  const data = await resp.json();
  const media = data?.tweet?.media?.videos || data?.tweet?.media?.video;
  const videos = Array.isArray(media) ? media : media ? [media] : [];
  if (!videos.length) throw new Error('No video found in fxtwitter');

  const variants = [];
  for (const v of videos) {
    if (v.variants && Array.isArray(v.variants)) {
      variants.push(...v.variants.filter(x => x.content_type === 'video/mp4'));
    } else if (v.url) {
      variants.push({ url: v.url, bitrate: v.bitrate || 2000000 });
    }
  }
  if (!variants.length) throw new Error('No mp4 variants in fxtwitter');
  return variants.map(v => ({ url: v.url, bitrate: v.bitrate || 0 }));
}

async function fetchFromVxTwitter(tweetId) {
  const resp = await fetch(`https://api.vxtwitter.com/Twitter/status/${tweetId}`);
  if (!resp.ok) throw new Error('vxtwitter failed');
  const data = await resp.json();

  const variants = [];
  if (data.media_extended && Array.isArray(data.media_extended)) {
    for (const m of data.media_extended) {
      if (m.type === 'video' || m.type === 'gif') {
        if (m.url) variants.push({ url: m.url, bitrate: m.size ? m.size.bitrate || 2000000 : 2000000 });
      }
    }
  } else if (data.video_url) {
    variants.push({ url: data.video_url, bitrate: 2000000 });
  }

  if (!variants.length) throw new Error('No video found in vxtwitter');
  return variants;
}

async function fetchFromFixupx(tweetId) {
  const resp = await fetch(`https://api.fixupx.com/status/${tweetId}`);
  if (!resp.ok) throw new Error('fixupx failed');
  const data = await resp.json();
  const media = data?.tweet?.media?.videos || data?.tweet?.media?.video;
  const videos = Array.isArray(media) ? media : media ? [media] : [];
  if (!videos.length) throw new Error('No video in fixupx');

  const variants = [];
  for (const v of videos) {
    if (v.variants) variants.push(...v.variants.filter(x => x.content_type === 'video/mp4'));
    else if (v.url) variants.push({ url: v.url, bitrate: v.bitrate || 0 });
  }
  if (!variants.length) throw new Error('No mp4 in fixupx');
  return variants.map(v => ({ url: v.url, bitrate: v.bitrate || 0 }));
}

async function fetchFromTwitsave(url) {
  const target = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
  const resp = await fetchProxied(target);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = [...doc.querySelectorAll('a[href*=".mp4"]')];
  if (!links.length) throw new Error('No video links found on twitsave');

  return links.map((a, i) => ({
    url: a.href,
    bitrate: (links.length - i) * 1000000,
  }));
}

// -------- Instagram API Redundancy Chain --------
async function fetchFromInstagram(url, shortcode) {
  // Method 1: Public Instagram Embed parser via internal proxy
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const resp = await fetchProxied(embedUrl);
    if (resp.ok) {
      const html = await resp.text();
      const videoMatch = html.match(/"video_url":"([^"]+)"/) ||
                         html.match(/src="([^"]+\.mp4[^"]*)"/i) ||
                         html.match(/href="([^"]+\.mp4[^"]*)"/i);
      if (videoMatch) {
        let videoUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        return [{ url: videoUrl, bitrate: 2500000 }];
      }
    }
  } catch (_) {}

  // Method 2: DDInstagram parser via internal proxy
  try {
    const ddUrl = `https://ddinstagram.com/reel/${shortcode}`;
    const resp = await fetchProxied(ddUrl);
    if (resp.ok) {
      const html = await resp.text();
      const match = html.match(/<meta property="og:video" content="([^"]+)"/i) ||
                    html.match(/src="([^"]+\.mp4[^"]*)"/i);
      if (match) {
        const videoUrl = match[1].replace(/&amp;/g, '&');
        return [{ url: videoUrl, bitrate: 2500000 }];
      }
    }
  } catch (_) {}

  // Method 3: Direct API endpoint
  try {
    const directApi = `https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`;
    const resp = await fetchProxied(directApi);
    if (resp.ok) {
      const data = await resp.json();
      const items = data?.items || data?.graphql?.shortcode_media;
      const vUrl = items?.[0]?.video_versions?.[0]?.url || items?.video_url;
      if (vUrl) {
        return [{ url: vUrl, bitrate: 2500000 }];
      }
    }
  } catch (_) {}

  throw new Error('Could not retrieve Instagram video. The Reel/Post may be private or age-restricted.');
}

// -------- Quality label --------
function getQualLabel(url, bitrate) {
  const m = url.match(/\/(\d{3,4})x(\d{3,4})\//);
  if (m) return m[2] + 'p';
  if (bitrate >= 2000000) return '720p';
  if (bitrate >= 800000) return '480p';
  if (bitrate >= 300000) return '360p';
  return 'SD';
}

// -------- Build Quality Selector Cards --------
function buildQualityCards(variants) {
  const grid = document.getElementById('qualityGrid');
  grid.innerHTML = '';
  const sorted = [...variants].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  sorted.forEach((v, i) => {
    const qual = getQualLabel(v.url, v.bitrate);
    const card = document.createElement('div');
    card.className = 'quality-btn' + (i === 0 ? ' active' : '');
    card.id = `quality-btn-${i}`;
    card.innerHTML = `
      ${i === 0 ? '<span class="quality-badge">Best</span>' : ''}
      <span class="quality-dl-icon">🎬</span>
      <span class="quality-label">${qual}</span>
      <span class="quality-sub">Click to preview</span>
    `;
    card.addEventListener('click', () => selectQuality(v.url, qual, i));
    grid.appendChild(card);
  });

  if (sorted.length > 0) {
    selectQuality(sorted[0].url, getQualLabel(sorted[0].url, sorted[0].bitrate), 0);
  }
}

// ── Watermark Selection Helper ─────────────────────────────
function getSelectedWatermark() {
  const selected = document.querySelector('input[name="watermarkChoice"]:checked');
  return selected ? selected.value : 'riya_mishra007';
}

function updateWatermarkPreviewText() {
  const name = getSelectedWatermark();
  if (overlayWm) overlayWm.textContent = name;
  const noteWm = document.getElementById('noteWmName');
  if (noteWm) noteWm.textContent = name;
}

document.querySelectorAll('input[name="watermarkChoice"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    document.querySelectorAll('.wm-option').forEach(opt => opt.classList.remove('active'));
    e.target.closest('.wm-option')?.classList.add('active');
    updateWatermarkPreviewText();
  });
});

// ── Stripe Live Preview Toggle (20% of video height) ─────────────
const stripeToggleEl = document.getElementById('stripeToggle');
const videoContainerEl = document.getElementById('videoContainer');

function updateStripePreview() {
  if (stripeToggleEl && videoContainerEl) {
    const stripeEl = document.getElementById('previewStripe');
    if (stripeToggleEl.checked) {
      videoContainerEl.classList.add('has-stripe');
      const vh = previewVideo.clientHeight || previewVideo.videoHeight || 300;
      const stripePx = Math.round(vh * 0.20);
      if (stripeEl) stripeEl.style.height = stripePx + 'px';
      videoContainerEl.style.paddingTop = '0px';
    } else {
      videoContainerEl.classList.remove('has-stripe');
      if (stripeEl) stripeEl.style.height = '0px';
      videoContainerEl.style.paddingTop = '0px';
    }
  }
}

if (stripeToggleEl) stripeToggleEl.addEventListener('change', updateStripePreview);
if (previewVideo) previewVideo.addEventListener('loadedmetadata', updateStripePreview);

// -------- Select quality → load video into preview player --------
function selectQuality(url, qual, idx) {
  document.querySelectorAll('.quality-btn').forEach(c => c.classList.remove('active'));
  const card = document.getElementById(`quality-btn-${idx}`);
  if (card) card.classList.add('active');

  activeVideoUrl = url;
  activeQualLabel = qual;

  updateStripePreview();
  updateWatermarkPreviewText();

  cleanupPreviewBlob();

  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  previewVideo.src = proxyUrl;
  previewVideo.load();
  previewVideo.play().catch(() => {});

  // Fallback: if proxy streaming fails, load as Blob URL
  previewVideo.onerror = () => {
    console.warn('[VideoX] Direct stream failed, loading video as blob...');
    fetch(proxyUrl)
      .then(r => r.blob())
      .then(blob => {
        cleanupPreviewBlob();
        currentPreviewBlobUrl = URL.createObjectURL(blob);
        previewVideo.src = currentPreviewBlobUrl;
        previewVideo.load();
        previewVideo.play().catch(() => {});
      })
      .catch(err => console.error('[VideoX] Blob load error:', err));
  };

  previewWrap.classList.add('visible');
  overlayWm.classList.add('visible');

  wmDownloadBtn.disabled = false;
  wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Add Watermark & Download';
  wmProgressWrap.style.display = 'none';
  wmFill.style.width = '0';

  previewWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Pure JS WAV Encoder Fallback (Zero WASM / SharedArrayBuffer dependency) ──
function audioBufferToWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let samples;
  if (numChannels === 2) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    samples = new Float32Array(left.length + right.length);
    for (let i = 0; i < left.length; i++) {
      samples[i * 2] = left[i];
      samples[i * 2 + 1] = right[i];
    }
  } else {
    samples = audioBuffer.getChannelData(0);
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// ============================================================
//  WATERMARK BURN & AUDIO EXTRACTION
// ============================================================
async function startWatermark(format = 'mp4') {
  if (!activeVideoUrl) {
    showError('Please select a quality first.');
    return;
  }
  if (wmDownloadBtn.disabled) return;

  wmDownloadBtn.disabled = true;
  if (mp3DownloadBtn) mp3DownloadBtn.disabled = true;
  wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Processing…';
  wmProgressWrap.style.display = 'block';

  function setProgress(pct, msg) {
    wmFill.style.width = pct + '%';
    wmStatus.textContent = msg;
  }

  let localBlobUrl = null;
  let audioCtx = null;
  let canvasStream = null;

  try {
    const videoProxyUrl = `/api/proxy?url=${encodeURIComponent(activeVideoUrl)}`;

    // ── MP3 / Audio Extraction Flow ────────────────────────────────
    if (format === 'mp3') {
      setProgress(5, 'Downloading video for audio extraction…');
      const vidRes = await fetch(videoProxyUrl);
      if (!vidRes.ok) throw new Error(`HTTP ${vidRes.status} downloading video`);
      const vidBlob = await vidRes.blob();

      let dlUrl, dlFilename;

      // Attempt 1: Try local FFmpeg WASM if available
      let ffmpegSuccess = false;
      if (typeof FFmpegWASM !== 'undefined' && typeof FFmpegUtil !== 'undefined') {
        try {
          setProgress(20, 'Initializing audio converter…');
          const { FFmpeg } = FFmpegWASM;
          const { fetchFile, toBlobURL } = FFmpegUtil;
          const ffmpeg = new FFmpeg();

          ffmpeg.on('progress', ({ progress }) => {
            setProgress(30 + Math.round(progress * 60), `Extracting audio… ${Math.round(progress * 100)}%`);
          });

          // Attempt local assets first, fallback to unpkg
          try {
            await ffmpeg.load({
              coreURL: await toBlobURL('public/ffmpeg/core/dist/umd/ffmpeg-core.js', 'text/javascript'),
              wasmURL: await toBlobURL('public/ffmpeg/core/dist/umd/ffmpeg-core.wasm', 'application/wasm'),
            });
          } catch (_) {
            const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
            await ffmpeg.load({
              coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
              wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
          }

          setProgress(50, 'Converting audio to MP3…');
          await ffmpeg.writeFile('input.mp4', await fetchFile(vidBlob));
          await ffmpeg.exec(['-i', 'input.mp4', '-vn', '-q:a', '0', 'output.mp3']);

          const data = await ffmpeg.readFile('output.mp3');
          const audioBlob = new Blob([data.buffer], { type: 'audio/mpeg' });
          dlUrl = URL.createObjectURL(audioBlob);
          dlFilename = `${getSelectedWatermark()}_${activeQualLabel}.mp3`;
          ffmpegSuccess = true;
          try { ffmpeg.terminate(); } catch (_) {}
        } catch (ffErr) {
          console.warn('[VideoX] FFmpeg extraction failed, falling back to Web Audio API:', ffErr);
        }
      }

      // Attempt 2: Pure Web Audio API fallback (100% reliable, zero WASM requirement)
      if (!ffmpegSuccess) {
        setProgress(50, 'Decoding audio track with Web Audio API…');
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) throw new Error('Audio extraction is not supported on this browser.');

        const tempCtx = new AudioCtx();
        const arrayBuffer = await vidBlob.arrayBuffer();
        const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        const wavBlob = audioBufferToWav(decodedBuffer);
        try { tempCtx.close(); } catch (_) {}

        dlUrl = URL.createObjectURL(wavBlob);
        dlFilename = `${getSelectedWatermark()}_${activeQualLabel}.wav`;
      }

      setProgress(100, '✅ Audio ready! Downloading…');
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = dlFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(dlUrl), 15000);

      wmStatus.textContent = '✅ Audio downloaded successfully!';
      wmStatus.style.color = '#22c55e';
      wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Add Watermark & Download (MP4)';
      wmDownloadBtn.disabled = false;
      if (mp3DownloadBtn) mp3DownloadBtn.disabled = false;
      return;
    }

    // ── MP4 Watermark Flow (Canvas + MediaRecorder) ────────────────
    setProgress(5, 'Downloading video… 0%');

    let videoBlob;
    const res = await fetch(videoProxyUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading video`);

    const totalBytes = parseInt(res.headers.get('content-length') || '0', 10);
    if (totalBytes > 0 && res.body) {
      const reader = res.body.getReader();
      let receivedBytes = 0;
      const chunksArr = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunksArr.push(value);
        receivedBytes += value.length;
        const pct = Math.min(22, Math.round(5 + (receivedBytes / totalBytes) * 17));
        const mb = (receivedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        setProgress(pct, `Downloading video… ${mb} MB / ${totalMb} MB`);
      }
      videoBlob = new Blob(chunksArr, { type: 'video/mp4' });
    } else {
      videoBlob = await res.blob();
    }

    setProgress(23, 'Setting up media renderer…');
    localBlobUrl = URL.createObjectURL(videoBlob);

    const video = document.createElement('video');
    video.src = localBlobUrl;
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = false;

    await new Promise((resolve, reject) => {
      let isSettled = false;
      const onReady = () => {
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      };
      video.oncanplay = onReady;
      video.onloadeddata = onReady;
      video.onerror = () => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error('Failed to decode video stream'));
        }
      };
      video.load();
      setTimeout(() => {
        if (!isSettled && video.readyState >= 2) onReady();
      }, 3000);
    });

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const duration = (video.duration && isFinite(video.duration) && video.duration > 0) ? video.duration : 5;

    const stripeEnabled = !!(document.getElementById('stripeToggle')?.checked);
    const STRIPE_H = stripeEnabled ? Math.round(vh * 0.20) : 0;
    const totalH = vh + STRIPE_H;

    setProgress(25, 'Configuring audio capture…');

    let audioTrack = null;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();

        source.connect(dest);

        // Silent gain keeps the audio pipeline flowing without playing through speakers
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        source.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        const tracks = dest.stream.getAudioTracks();
        if (tracks.length > 0) {
          audioTrack = tracks[0];
        }
      }
    } catch (e) {
      console.warn('[VideoX] Web Audio capture warning:', e);
    }

    if (!audioTrack) {
      try {
        video.volume = 1;
        const vs = video.captureStream ? video.captureStream() :
                   video.mozCaptureStream ? video.mozCaptureStream() : null;
        if (vs) {
          const tracks = vs.getAudioTracks();
          if (tracks.length > 0) audioTrack = tracks[0];
        }
      } catch (e) {
        console.warn('[VideoX] captureStream fallback warning:', e);
      }
    }

    setProgress(28, 'Preparing canvas & watermark…');

    const canvas = document.getElementById('wmCanvas');
    canvas.width = vw;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r);
      c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y);
      c.closePath();
    }

    function drawWatermark() {
      const fontSize = Math.max(28, Math.round(vw * 0.04));
      const text = getSelectedWatermark();
      ctx.font = `bold italic ${fontSize}px 'Dancing Script', cursive`;
      const tw = ctx.measureText(text).width;
      const padX = 18, padY = 10;
      const bx = 24, by = totalH - fontSize - padY * 2 - 24;
      const bw = tw + padX * 2, bh = fontSize + padY * 2;

      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = '#000';
      roundRect(ctx, bx, by, bw, bh, 12);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.textBaseline = 'top';
      ctx.font = `bold italic ${fontSize}px 'Dancing Script', cursive`;

      ctx.shadowColor = 'rgba(29,155,240,0.9)';
      ctx.shadowBlur = 32;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#fff';
      ctx.fillText(text, bx + padX, by + padY);
      ctx.fillText(text, bx + padX, by + padY);

      ctx.shadowColor = 'rgba(168,85,247,0.85)';
      ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.38;
      ctx.fillText(text, bx + padX, by + padY);

      ctx.shadowColor = 'rgba(255,255,255,0.8)';
      ctx.shadowBlur = 7;
      ctx.globalAlpha = 0.70;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(text, bx + padX, by + padY);

      ctx.restore();
    }

    // MediaRecorder format selection with iOS Safari compatibility
    const candidateTypes = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    const supportedMime = candidateTypes.find(m => {
      try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; }
    });

    canvasStream = canvas.captureStream(30);
    if (audioTrack) {
      try { canvasStream.addTrack(audioTrack); } catch (_) {}
    }

    const recorderOptions = supportedMime ? { mimeType: supportedMime, videoBitsPerSecond: 5_000_000 } : {};
    const recorder = new MediaRecorder(canvasStream, recorderOptions);
    const actualMime = recorder.mimeType || supportedMime || 'video/webm';

    const chunks = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    setProgress(30, 'Burning watermark & recording…');

    // ── Render loop with fail-safe stop & background tab interval fallback ──
    await new Promise((resolve, reject) => {
      recorder.start(100);
      let animId = null;
      let backupInterval = null;
      let isFinished = false;
      let lastFrameTime = performance.now();

      function renderFrame() {
        if (isFinished) return;
        lastFrameTime = performance.now();

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, vw, totalH);

        try {
          ctx.drawImage(video, 0, STRIPE_H, vw, vh);
        } catch (_) {}

        if (stripeEnabled && STRIPE_H > 0) {
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, vw, STRIPE_H);
        }

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        drawWatermark();

        // Multi-condition finish detection
        if (video.ended || (duration > 0 && video.currentTime >= duration - 0.15)) {
          finishRecording();
          return;
        }

        animId = requestAnimationFrame(renderFrame);
      }

      function finishRecording() {
        if (isFinished) return;
        isFinished = true;

        clearTimeout(safetyTimeout);
        if (animId) cancelAnimationFrame(animId);
        if (backupInterval) clearInterval(backupInterval);

        try { video.pause(); } catch (_) {}

        if (recorder.state === 'recording') {
          setTimeout(() => {
            try {
              if (recorder.state === 'recording') recorder.stop();
            } catch (_) {}
          }, 150);
        } else {
          resolve();
        }
      }

      // Hard safety timeout: guarantees recording stops even if video stalls
      const safetyTimeout = setTimeout(() => {
        console.warn('[VideoX] Safety timeout triggered');
        finishRecording();
      }, Math.max(10000, Math.round((duration + 8) * 1000)));

      // Background tab protection (keeps rendering if requestAnimationFrame throttles)
      backupInterval = setInterval(() => {
        if (isFinished) return;
        if (performance.now() - lastFrameTime > 70) {
          renderFrame();
        }
      }, 40);

      video.onplay = () => {
        animId = requestAnimationFrame(renderFrame);
      };

      video.onended = () => {
        finishRecording();
      };

      video.onerror = () => {
        finishRecording();
        reject(new Error('Playback error during rendering'));
      };

      recorder.onstop = resolve;

      video.ontimeupdate = () => {
        if (duration > 0 && !isFinished) {
          const pct = Math.min(95, 30 + Math.round((video.currentTime / duration) * 65));
          const curSec = Math.round(video.currentTime);
          const totalSec = Math.round(duration);
          setProgress(pct, `Recording watermark… ${curSec}s / ${totalSec}s`);
          if (video.currentTime >= duration - 0.15) {
            finishRecording();
          }
        }
      };

      video.play().catch(playErr => {
        console.warn('[VideoX] Unmuted play failed, falling back to muted play:', playErr);
        video.muted = true;
        video.play().catch(reject);
      });
    });

    setProgress(96, 'Finalizing video package…');

    const finalBlob = new Blob(chunks, { type: actualMime });
    const ext = actualMime.includes('mp4') ? 'mp4' : 'webm';
    const dlUrl = URL.createObjectURL(finalBlob);

    setProgress(100, '✅ Done! Saving file…');
    const wmName = getSelectedWatermark();
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `${wmName}_${activeQualLabel}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 15000);

    wmStatus.textContent = '✅ Watermarked video downloaded!';
    wmStatus.style.color = '#22c55e';
    wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Download Again';
    wmDownloadBtn.disabled = false;
    if (mp3DownloadBtn) mp3DownloadBtn.disabled = false;

  } catch (err) {
    console.error('[VideoX] Watermarking error:', err);
    wmProgressWrap.style.display = 'none';
    showError('⚠️ ' + (err.message || 'Failed to process. Try a different quality.'));
    wmDownloadBtn.disabled = false;
    if (mp3DownloadBtn) mp3DownloadBtn.disabled = false;
    wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Add Watermark & Download (MP4)';
  } finally {
    // Prevent memory leaks and hardware context exhaustion
    if (audioCtx) {
      try { audioCtx.close(); } catch (_) {}
    }
    if (localBlobUrl) {
      try { URL.revokeObjectURL(localBlobUrl); } catch (_) {}
    }
    if (canvasStream) {
      canvasStream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    }
  }
}

// -------- Enter key trigger --------
tweetInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchVideo();
});

// -------- Watermark ambient hover --------
const wm = document.getElementById('watermark');
document.addEventListener('mousemove', e => {
  if (!wm) return;
  const rect = wm.getBoundingClientRect();
  const dist = Math.hypot(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
  const t = wm.querySelector('.watermark-text');
  if (t) t.style.opacity = String(0.45 + Math.max(0, 1 - dist / 300) * 0.45);
});
