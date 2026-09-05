/* ==========================================
   app.js — Twitter/X Video Downloader
   New flow:
     1. Fetch video URLs via API
     2. Load selected quality into <video> on page
     3. Show CSS watermark overlay on preview
     4. "Add Watermark & Download" → Canvas + MediaRecorder
   ========================================== */

// -------- Particle background --------
(function initParticles() {
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  let W, H;
  const particles = [];

  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * W; this.y = Math.random() * H;
      this.r = Math.random() * 1.8 + 0.3;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = (Math.random() - 0.5) * 0.3;
      this.alpha = Math.random() * 0.4 + 0.1;
      this.hue = Math.random() > 0.5 ? '29,155,240' : '168,85,247';
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
    }
    draw() {
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.hue},${this.alpha})`; ctx.fill();
    }
  }
  for (let i = 0; i < 120; i++) particles.push(new Particle());
  (function loop() { ctx.clearRect(0, 0, W, H); particles.forEach(p => { p.update(); p.draw(); }); requestAnimationFrame(loop); })();
})();

// -------- Refs --------
const tweetInput = document.getElementById('tweetUrl');
const clearBtn = document.getElementById('clearBtn');
const previewVideo = document.getElementById('previewVideo');
const previewWrap = document.getElementById('previewWrap');
const overlayWm = document.getElementById('videoOverlayWm');
const wmDownloadBtn = document.getElementById('wmDownloadBtn');
const wmProgressWrap = document.getElementById('wmProgressWrap');
const wmFill = document.getElementById('wmFill');
const wmStatus = document.getElementById('wmStatus');

// currently selected video URL + quality label
let activeVideoUrl = null;
let activeQualLabel = 'video';

// -------- Clear button --------
tweetInput.addEventListener('input', () => {
  clearBtn.classList.toggle('visible', tweetInput.value.length > 0);
  hideError(); hideResults();
});
clearBtn.addEventListener('click', () => {
  tweetInput.value = '';
  clearBtn.classList.remove('visible');
  hideError(); hideResults();
  tweetInput.focus();
});

// -------- UI Helpers --------
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${msg}`;
  el.classList.add('visible');
}
function hideError() { document.getElementById('errorMsg').classList.remove('visible'); }

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
function showResults() { document.getElementById('resultsWrap').classList.add('visible'); }
function hideResults() {
  document.getElementById('resultsWrap').classList.remove('visible');
  document.getElementById('qualityGrid').innerHTML = '';
  previewWrap.classList.remove('visible');
  overlayWm.classList.remove('visible');
  previewVideo.src = '';
  activeVideoUrl = null;
}
function animateBar() {
  const fill = document.getElementById('loadingFill'); fill.style.width = '0'; let w = 0;
  const iv = setInterval(() => { w += Math.random() * 12 + 4; if (w >= 88) { clearInterval(iv); w = 88; } fill.style.width = w + '%'; }, 220);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -------- Validation --------
function isValidTwitterUrl(url) { return /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i.test(url); }
function extractTweetId(url) { const m = url.match(/\/status\/(\d+)/); return m ? m[1] : null; }

// -------- Main fetch --------
async function fetchVideo() {
  const raw = tweetInput.value.trim();
  hideError(); hideResults();
  if (!raw) { showError('Please paste a Twitter / X tweet link first.'); tweetInput.focus(); return; }
  if (!isValidTwitterUrl(raw)) { showError('That doesn\'t look like a valid Twitter/X link. Example: <code>https://x.com/user/status/1234567890</code>'); return; }

  const tweetId = extractTweetId(raw);
  if (!tweetId) { showError('Could not find a tweet ID in this URL.'); return; }

  const btn = document.getElementById('fetchBtn');
  btn.classList.add('loading');
  btn.querySelector('.btn-text').textContent = 'Fetching…';
  showLoading('Fetching video links…');

  try {
    const variants = await fetchWithApis(raw, tweetId);
    document.getElementById('loadingFill').style.width = '100%';
    await sleep(300);
    hideLoading();
    buildQualityCards(variants);
    showResults();
  } catch (err) {
    hideLoading();
    showError(err.message || 'Failed to fetch video. Make sure the tweet is public and contains a video.');
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('.btn-text').textContent = 'Get Video';
  }
}

// -------- API --------
async function fetchWithApis(url, tweetId) {
  try { return await fetchFromFxTwitter(tweetId); } catch (_) { }
  try { return await fetchFromTwitsave(url); } catch (_) { }
  throw new Error('Could not retrieve video links. The tweet may be private, age-restricted, or may not contain a video.');
}

async function fetchFromFxTwitter(tweetId) {
  const resp = await fetch(`https://api.fxtwitter.com/i/status/${tweetId}`);
  if (!resp.ok) throw new Error('fxtwitter API failed');
  const data = await resp.json();
  const media = data?.tweet?.media?.videos || data?.tweet?.media?.video;
  const videos = Array.isArray(media) ? media : media ? [media] : [];
  if (!videos.length) throw new Error('No video');
  const variants = [];
  for (const v of videos) {
    if (v.variants) variants.push(...v.variants.filter(x => x.content_type === 'video/mp4'));
    else if (v.url) variants.push({ url: v.url, bitrate: v.bitrate || 0 });
  }
  if (!variants.length) throw new Error('No mp4 variants');
  return variants.map(v => ({ url: v.url, bitrate: v.bitrate || 0 }));
}

async function fetchFromTwitsave(url) {
  const api = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
  const resp = await fetch(`https://corsproxy.io/?${encodeURIComponent(api)}`);
  if (!resp.ok) throw new Error('twitsave failed');
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = [...doc.querySelectorAll('a[href*=".mp4"]')];
  if (!links.length) throw new Error('No video links found');
  return links.map((a, i) => ({ url: a.href, bitrate: (links.length - i) * 1000000 }));
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

  // Auto-load best quality
  if (sorted.length > 0) {
    selectQuality(sorted[0].url, getQualLabel(sorted[0].url, sorted[0].bitrate), 0);
  }
}

// -------- Select quality → load video on page --------
function selectQuality(url, qual, idx) {
  // Mark card active
  document.querySelectorAll('.quality-btn').forEach(c => c.classList.remove('active'));
  const card = document.getElementById(`quality-btn-${idx}`);
  if (card) card.classList.add('active');

  activeVideoUrl = url;
  activeQualLabel = qual;

  // Load into preview player
  previewVideo.src = url;
  previewVideo.load();
  previewVideo.play().catch(() => { }); // autoplay muted

  // Show preview + watermark overlay
  previewWrap.classList.add('visible');
  overlayWm.classList.add('visible');

  // Reset watermark button
  wmDownloadBtn.disabled = false;
  wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Add Watermark & Download';
  wmProgressWrap.style.display = 'none';
  wmFill.style.width = '0';

  // Scroll to preview
  previewWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
//  WATERMARK BURN: Canvas + MediaRecorder
//  Uses the already-loaded video element (no re-fetch needed)
// ============================================================
async function startWatermark(format = 'mp4') {
  if (!activeVideoUrl) { showError('Please select a quality first.'); return; }
  if (wmDownloadBtn.disabled) return;

  wmDownloadBtn.disabled = true;
  document.getElementById('mp3DownloadBtn').disabled = true;
  wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Processing…';
  wmProgressWrap.style.display = 'block';

  function setProgress(pct, msg) {
    wmFill.style.width = pct + '%';
    wmStatus.textContent = msg;
  }

  try {
    // If downloading as MP3, handle it with FFmpeg
    if (format === 'mp3') {
      setProgress(10, 'Initializing FFmpeg…');
      const { FFmpeg } = FFmpegWASM;
      const { fetchFile } = FFmpegUtil;
      
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        setProgress(10 + Math.round(progress * 80), 'Extracting audio…');
      });

      // Must specify CDN core URL when ffmpeg.js itself is loaded from CDN
      await ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
      });
      
      setProgress(20, 'Downloading video for audio extraction…');
      // fetch blob via CORS proxy to bypass Twitter direct link CORS
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(activeVideoUrl)}`;
      await ffmpeg.writeFile('input.mp4', await fetchFile(proxyUrl));
      
      setProgress(40, 'Converting to MP3…');
      await ffmpeg.exec(['-i', 'input.mp4', '-q:a', '0', '-map', 'a', 'output.mp3']);
      
      setProgress(90, 'Finalizing audio file…');
      const data = await ffmpeg.readFile('output.mp3');
      
      const audioBlob = new Blob([data.buffer], { type: 'audio/mpeg' });
      const dlUrl = URL.createObjectURL(audioBlob);
      
      setProgress(100, '✅ Done! Saving file…');
      
      const a = document.createElement('a');
      a.href = dlUrl; a.download = `riya_mishra007_${activeQualLabel}.mp3`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(dlUrl), 15000);
      
      wmStatus.textContent = '✅ MP3 Audio downloaded!';
      wmStatus.style.color = '#22c55e';
      wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Add Watermark & Download (MP4)';
      wmDownloadBtn.disabled = false;
      document.getElementById('mp3DownloadBtn').disabled = false;
      
      return; // Exit early since we handled the mp3 download
    }

    // --- MP4 Watermark processing using Canvas + MediaRecorder ---
    
    // Re-create a fresh video element so crossOrigin works
    // (setting crossOrigin after src is set doesn't work on some browsers)
    setProgress(5, 'Loading video with canvas access…');

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';  // needed for canvas.drawImage
    video.src = activeVideoUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => {
        // If crossOrigin fails (CORS not allowed), fall back to direct link open
        rej(new Error('CANVAS_TAINTED'));
      };
      video.load();
    });

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const duration = video.duration;

    // ── Top stripe — driven by toggle ───────────────────────────
    const stripeEnabled = document.getElementById('stripeToggle')?.checked ?? false;
    const STRIPE_H      = stripeEnabled ? 20 : 0;  // px added at top
    const STRIPE_COLOR  = '#ffffff';                // white stripe
    const totalH        = vh + STRIPE_H;            // total canvas height
    // ────────────────────────────────────────────────────

    setProgress(18, `Video ready (${vw}×${vh}${stripeEnabled ? ` → +20px stripe` : ''}). Setting up encoder…`);

    // Canvas — taller by STRIPE_H when enabled
    const canvas = document.getElementById('wmCanvas');
    canvas.width  = vw;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // ----- Draw watermark -----
    function drawWatermark() {
      const fontSize = Math.max(28, Math.round(vw * 0.04));
      const text = 'riya_mishra007';
      ctx.font = `bold italic ${fontSize}px 'Dancing Script', cursive`;
      const tw = ctx.measureText(text).width;
      const padX = 18, padY = 10;
      // by is relative to totalH (video sits at STRIPE_H offset)
      const bx = 24, by = totalH - fontSize - padY * 2 - 24;
      const bw = tw + padX * 2, bh = fontSize + padY * 2;

      ctx.save();
      // frosted dark pill
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = '#000';
      roundRect(ctx, bx, by, bw, bh, 12); ctx.fill();
      ctx.globalAlpha = 1;

      ctx.textBaseline = 'top';
      ctx.font = `bold italic ${fontSize}px 'Dancing Script', cursive`;

      // layer 1 — wide glow
      ctx.shadowColor = 'rgba(29,155,240,0.9)'; ctx.shadowBlur = 32;
      ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
      ctx.fillText(text, bx + padX, by + padY);
      ctx.fillText(text, bx + padX, by + padY);

      // layer 2 — purple mid glow
      ctx.shadowColor = 'rgba(168,85,247,0.85)'; ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.38;
      ctx.fillText(text, bx + padX, by + padY);

      // layer 3 — tight white glow
      ctx.shadowColor = 'rgba(255,255,255,0.8)'; ctx.shadowBlur = 7;
      ctx.globalAlpha = 0.70; ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(text, bx + padX, by + padY);

      ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    // ----- MediaRecorder -----
    const mimeTypes = [
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
    ];
    const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    const fps = 30;
    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    setProgress(25, 'Recording with watermark…');

    await new Promise((res, rej) => {
      recorder.start(100);
      let animId;

      function renderFrame() {
        // 1. White stripe at top (only when toggle is on)
        if (stripeEnabled) {
          ctx.fillStyle = STRIPE_COLOR;
          ctx.fillRect(0, 0, vw, STRIPE_H);
        }

        // 2. Video frame (pushed down by STRIPE_H when stripe is on)
        try { ctx.drawImage(video, 0, STRIPE_H, vw, vh); } catch (e) { /* tainted – CORS */ }

        // 3. Blurry watermark over the video area
        drawWatermark();
        animId = requestAnimationFrame(renderFrame);
      }

      video.onplay = () => { animId = requestAnimationFrame(renderFrame); };
      video.onended = () => { cancelAnimationFrame(animId); recorder.stop(); };
      video.onerror = () => rej(new Error('Playback error'));
      recorder.onstop = res;

      video.ontimeupdate = () => {
        if (duration > 0) {
          const pct = 25 + Math.round((video.currentTime / duration) * 65);
          setProgress(pct, `Burning watermark… ${Math.round(video.currentTime)}s / ${Math.round(duration)}s`);
        }
      };

      video.play().catch(rej);
    });

    setProgress(93, 'Finalizing…');
    await sleep(200);

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const finalBlob = new Blob(chunks, { type: mimeType });
    const dlUrl = URL.createObjectURL(finalBlob);

    setProgress(100, '✅ Done! Saving file…');

    const a = document.createElement('a');
    a.href = dlUrl; a.download = `riya_mishra007_${activeQualLabel}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 15000);

    wmStatus.textContent = '✅ Watermarked video downloaded!';
    wmStatus.style.color = '#22c55e';
    wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Download Again (MP4)';
    wmDownloadBtn.disabled = false;
    document.getElementById('mp3DownloadBtn').disabled = false;

  } catch (err) {
    console.error(err);
    if (err.message === 'CANVAS_TAINTED' || err.message.includes('taint') || err.message.includes('CORS')) {
      // Twitter CDN doesn't allow crossOrigin canvas — open direct link as fallback
      wmProgressWrap.style.display = 'none';
      showError('⚠️ This video\'s CDN blocks canvas access (CORS). Downloading without watermark instead…');
      await sleep(800);
      window.open(activeVideoUrl, '_blank');
    } else {
      wmProgressWrap.style.display = 'none';
      showError('⚠️ ' + (err.message || 'Failed to process. Try a different quality.'));
    }
    wmDownloadBtn.disabled = false;
    document.getElementById('mp3DownloadBtn').disabled = false;
    wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Add Watermark & Download (MP4)';
  }
}

// -------- Enter key --------
tweetInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchVideo(); });

// -------- Bottom-left watermark ambient hover --------
const wm = document.getElementById('watermark');
document.addEventListener('mousemove', e => {
  if (!wm) return;
  const rect = wm.getBoundingClientRect();
  const dist = Math.hypot(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
  const t = wm.querySelector('.watermark-text');
  if (t) t.style.opacity = String(0.45 + Math.max(0, 1 - dist / 300) * 0.45);
});
