/* ==========================================
   app.js — Twitter/X Video Downloader
   Flow:
     1. Fetch video URLs via API
     2. Load selected quality into <video> preview via proxy
     3. Show watermark overlay on preview
     4. "Add Watermark & Download":
        - Download video blob first (fast & reliable)
        - Render onto canvas with watermark & optional +20px stripe
        - Record with audio and output MP4
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
function isValidInstagramUrl(url) { return /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(p|reel|reels|tv)\/[\w-]+/i.test(url); }
function extractTweetId(url) { const m = url.match(/\/status\/(\d+)/); return m ? m[1] : null; }
function extractInstagramShortcode(url) { const m = url.match(/\/(p|reel|reels|tv)\/([\w-]+)/i); return m ? m[2] : null; }

// -------- Main fetch (Hybrid: Twitter & Instagram) --------
async function fetchVideo() {
  const raw = tweetInput.value.trim();
  hideError(); hideResults();
  if (!raw) { showError('Please paste a Twitter/X or Instagram link first.'); tweetInput.focus(); return; }

  const isTwitter = isValidTwitterUrl(raw);
  const isInstagram = isValidInstagramUrl(raw);

  if (!isTwitter && !isInstagram) {
    showError('Please enter a valid link from <b>Twitter/X</b> (e.g. <code>x.com/user/status/123</code>) or <b>Instagram</b> (e.g. <code>instagram.com/reel/C123...</code>).');
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

    document.getElementById('loadingFill').style.width = '100%';
    await sleep(300);
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

// -------- Twitter API --------
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

// -------- Instagram API --------
async function fetchFromInstagram(url, shortcode) {
  // Method 1: Public Instagram Embed parser
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const proxyApi = `/api/proxy?url=${encodeURIComponent(embedUrl)}`;
    const resp = await fetch(proxyApi);
    if (resp.ok) {
      const html = await resp.text();
      const videoMatch = html.match(/"video_url":"([^"]+)"/) || html.match(/src="([^"]+\.mp4[^"]*)"/);
      if (videoMatch) {
        let videoUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        return [{ url: videoUrl, bitrate: 2500000 }];
      }
    }
  } catch (e) {}

  // Method 2: DDInstagram proxy parser
  try {
    const ddUrl = `https://ddinstagram.com/reel/${shortcode}`;
    const resp = await fetch(`https://corsproxy.io/?${encodeURIComponent(ddUrl)}`);
    if (resp.ok) {
      const html = await resp.text();
      const match = html.match(/<meta property="og:video" content="([^"]+)"/i) || html.match(/src="([^"]+\.mp4[^"]*)"/i);
      if (match) {
        let videoUrl = match[1].replace(/&amp;/g, '&');
        return [{ url: videoUrl, bitrate: 2500000 }];
      }
    }
  } catch (e) {}

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

  // Auto-load best quality
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
  const overlayWm = document.getElementById('videoOverlayWm');
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

if (stripeToggleEl) {
  stripeToggleEl.addEventListener('change', updateStripePreview);
}
if (previewVideo) {
  previewVideo.addEventListener('loadedmetadata', updateStripePreview);
}

// -------- Select quality → load video on page --------
function selectQuality(url, qual, idx) {
  // Mark card active
  document.querySelectorAll('.quality-btn').forEach(c => c.classList.remove('active'));
  const card = document.getElementById(`quality-btn-${idx}`);
  if (card) card.classList.add('active');

  activeVideoUrl = url;
  activeQualLabel = qual;

  // Sync stripe & watermark preview state
  updateStripePreview();
  updateWatermarkPreviewText();

  // Load into preview player via our proxy
  // (direct video.twimg.com URLs are blocked from Vercel's origin)
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  previewVideo.src = proxyUrl;
  previewVideo.load();
  previewVideo.play().catch(() => {}); // autoplay muted

  // Fallback: if browser <video> streaming fails, fetch blob directly
  previewVideo.onerror = () => {
    console.warn('Proxy streaming error in preview <video>, falling back to Blob load...');
    fetch(proxyUrl)
      .then(r => r.blob())
      .then(blob => {
        previewVideo.src = URL.createObjectURL(blob);
        previewVideo.load();
        previewVideo.play().catch(() => {});
      })
      .catch(err => console.error('Preview blob load error:', err));
  };

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
//  Flow: Download Video First → Local Object URL → Render Canvas
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
    const videoProxyUrl = `/api/proxy?url=${encodeURIComponent(activeVideoUrl)}`;

    // ── MP3 Audio Extraction Flow ────────────────────────────────
    if (format === 'mp3') {
      setProgress(5, 'Downloading video for MP3 extraction…');
      const vidRes = await fetch(videoProxyUrl);
      if (!vidRes.ok) throw new Error(`HTTP ${vidRes.status} downloading video`);
      const vidBlob = await vidRes.blob();

      setProgress(25, 'Loading FFmpeg audio converter…');
      const { FFmpeg } = FFmpegWASM;
      const { fetchFile, toBlobURL } = FFmpegUtil;
      
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        setProgress(30 + Math.round(progress * 60), `Extracting audio… ${Math.round(progress * 100)}%`);
      });

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      setProgress(45, 'Writing video data to memory…');
      await ffmpeg.writeFile('input.mp4', await fetchFile(vidBlob));
      
      setProgress(60, 'Converting to MP3…');
      await ffmpeg.exec(['-i', 'input.mp4', '-q:a', '0', '-map', 'a', 'output.mp3']);
      
      setProgress(95, 'Finalizing MP3 file…');
      const data = await ffmpeg.readFile('output.mp3');
      
      const audioBlob = new Blob([data.buffer], { type: 'audio/mpeg' });
      const dlUrl = URL.createObjectURL(audioBlob);
      
      setProgress(100, '✅ Done! Saving MP3…');
      
      const wmName = getSelectedWatermark();
      const a = document.createElement('a');
      a.href = dlUrl; a.download = `${wmName}_${activeQualLabel}.mp3`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(dlUrl), 15000);
      try { ffmpeg.terminate(); } catch (e) {}
      
      wmStatus.textContent = '✅ MP3 Audio downloaded!';
      wmStatus.style.color = '#22c55e';
      wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Add Watermark & Download (MP4)';
      wmDownloadBtn.disabled = false;
      document.getElementById('mp3DownloadBtn').disabled = false;
      return;
    }

    // ── MP4 Watermark Flow ─────────────────────────────────────────
    // Strategy: Canvas + MediaRecorder with PROPER audio capture.
    //  1. Download video blob
    //  2. Create video element from blob (same-origin)
    //  3. Capture audio via Web Audio API or captureStream
    //  4. Render canvas frames with watermark
    //  5. MediaRecorder records canvas video + audio
    //  6. Output file with watermark AND audio
    // ──────────────────────────────────────────────────────────────

    // Step 1: Download video
    setProgress(5, 'Downloading video… 0%');

    let videoBlob;
    try {
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
          const pct = Math.min(20, Math.round(5 + (receivedBytes / totalBytes) * 15));
          const mb = (receivedBytes / (1024 * 1024)).toFixed(1);
          const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
          setProgress(pct, `Downloading video… ${mb} MB / ${totalMb} MB`);
        }
        videoBlob = new Blob(chunksArr, { type: 'video/mp4' });
      } else {
        videoBlob = await res.blob();
      }
    } catch (dlErr) {
      throw new Error(`Failed to download video: ${dlErr.message}`);
    }

    // Step 2: Create video element from blob
    setProgress(22, 'Video downloaded! Setting up player…');
    const localBlobUrl = URL.createObjectURL(videoBlob);

    const video = document.createElement('video');
    video.src = localBlobUrl;
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = false;      // MUST be unmuted for audio capture
    video.crossOrigin = 'anonymous';

    await new Promise((res, rej) => {
      video.oncanplay = res;
      video.onerror = () => rej(new Error('Failed to load video data'));
      video.load();
    });

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const duration = video.duration || 1;

    // Step 3: Stripe settings
    const stripeEnabled = !!(document.getElementById('stripeToggle')?.checked);
    const STRIPE_H = stripeEnabled ? Math.round(vh * 0.20) : 0;
    const totalH = vh + STRIPE_H;

    setProgress(24, `Video ${vw}×${vh} | Setting up audio capture…`);

    // Step 4: Audio capture — try multiple methods
    let audioTrack = null;
    let audioCtx = null;

    // Method 1: Web Audio API — route audio through AudioContext
    // This captures audio at full volume without speaker output
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        // AudioContext MUST be running — user clicked button so interaction is present
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        console.log('[VideoX] AudioContext state:', audioCtx.state);

        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();

        // Route 1: audio → capture destination (full volume for recording)
        source.connect(dest);

        // Route 2: audio → silent gain → speakers (keeps pipeline alive)
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        source.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        const tracks = dest.stream.getAudioTracks();
        if (tracks.length > 0) {
          audioTrack = tracks[0];
          console.log('[VideoX] ✅ Audio captured via Web Audio API');
        }
      }
    } catch (e) {
      console.warn('[VideoX] Web Audio API failed:', e);
    }

    // Method 2 fallback: video.captureStream()
    if (!audioTrack) {
      try {
        video.volume = 1;
        const vs = video.captureStream ? video.captureStream() :
                   video.mozCaptureStream ? video.mozCaptureStream() : null;
        if (vs) {
          const tracks = vs.getAudioTracks();
          if (tracks.length > 0) {
            audioTrack = tracks[0];
            console.log('[VideoX] ✅ Audio captured via captureStream');
          }
        }
      } catch (e) {
        console.warn('[VideoX] captureStream fallback failed:', e);
      }
    }

    if (audioTrack) {
      console.log('[VideoX] Audio track ready:', audioTrack.label, 'enabled:', audioTrack.enabled);
    } else {
      console.warn('[VideoX] ⚠️ No audio capture succeeded — video will be silent');
    }

    // Step 5: Set up canvas for watermark rendering
    setProgress(26, 'Preparing watermark canvas…');

    const canvas = document.getElementById('wmCanvas');
    canvas.width = vw;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
      c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
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
      roundRect(ctx, bx, by, bw, bh, 12); ctx.fill();
      ctx.globalAlpha = 1;

      ctx.textBaseline = 'top';
      ctx.font = `bold italic ${fontSize}px 'Dancing Script', cursive`;

      ctx.shadowColor = 'rgba(29,155,240,0.9)'; ctx.shadowBlur = 32;
      ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
      ctx.fillText(text, bx + padX, by + padY);
      ctx.fillText(text, bx + padX, by + padY);

      ctx.shadowColor = 'rgba(168,85,247,0.85)'; ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.38;
      ctx.fillText(text, bx + padX, by + padY);

      ctx.shadowColor = 'rgba(255,255,255,0.8)'; ctx.shadowBlur = 7;
      ctx.globalAlpha = 0.70; ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(text, bx + padX, by + padY);

      ctx.restore();
    }

    // Step 6: Set up MediaRecorder with canvas video + audio
    const candidateTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = candidateTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    console.log('[VideoX] MediaRecorder mime:', mimeType);

    const canvasStream = canvas.captureStream(30);

    // Add audio track to canvas stream
    if (audioTrack) {
      canvasStream.addTrack(audioTrack);
      console.log('[VideoX] Audio track added to recording stream. Total tracks:',
        canvasStream.getTracks().length,
        '(video:', canvasStream.getVideoTracks().length,
        'audio:', canvasStream.getAudioTracks().length + ')');
    }

    const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 5_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    setProgress(28, 'Recording watermark + audio…');

    // Step 7: Render loop — play video, draw frames + watermark on canvas
    await new Promise((res, rej) => {
      recorder.start(100);
      let animId;

      function renderFrame() {
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, vw, totalH);

        try {
          ctx.drawImage(video, 0, STRIPE_H, vw, vh);
        } catch (e) {}

        if (stripeEnabled && STRIPE_H > 0) {
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, vw, STRIPE_H);
        }

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        drawWatermark();

        animId = requestAnimationFrame(renderFrame);
      }

      video.onplay = () => { animId = requestAnimationFrame(renderFrame); };
      video.onended = () => {
        cancelAnimationFrame(animId);
        setTimeout(() => recorder.stop(), 200); // small delay to flush audio
      };
      video.onerror = () => rej(new Error('Playback error during rendering'));
      recorder.onstop = res;

      video.ontimeupdate = () => {
        if (duration > 0) {
          const pct = 28 + Math.round((video.currentTime / duration) * 65);
          setProgress(pct, `Recording… ${Math.round(video.currentTime)}s / ${Math.round(duration)}s`);
        }
      };

      // Start playback — triggers audio flow through Web Audio API
      video.play().catch(playErr => {
        console.error('[VideoX] Play failed:', playErr);
        // If unmuted play fails due to autoplay policy, try muted (lose audio)
        video.muted = true;
        video.play().catch(rej);
      });
    });

    // Cleanup
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
    URL.revokeObjectURL(localBlobUrl);

    // Step 8: Package and download
    setProgress(95, 'Packaging video file…');

    const finalBlob = new Blob(chunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const dlUrl = URL.createObjectURL(finalBlob);
    setProgress(100, '✅ Done! Saving file…');

    const wmName = getSelectedWatermark();
    const a = document.createElement('a');
    a.href = dlUrl; a.download = `${wmName}_${activeQualLabel}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 15000);

    wmStatus.textContent = '✅ Watermarked video downloaded!';
    wmStatus.style.color = '#22c55e';
    wmDownloadBtn.querySelector('.wm-btn-text').textContent = 'Download Again';
    wmDownloadBtn.disabled = false;
    document.getElementById('mp3DownloadBtn').disabled = false;

  } catch (err) {
    console.error(err);
    wmProgressWrap.style.display = 'none';
    showError('⚠️ ' + (err.message || 'Failed to process. Try a different quality.'));
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
