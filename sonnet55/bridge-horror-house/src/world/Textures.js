// Procedural canvas textures. Zero binary assets: everything in the house is painted here at boot.
import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgb = (c, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
const rgba = (c, a, k = 1) => `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`;

function toTex(canvas, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// film-grain style luminance noise: one shared random tile, blended on (much faster than per-pixel JS loops)
let noiseTile = null;
function grainNoise(g, w, h, r, amount) {
  if (!noiseTile) {
    noiseTile = cv(256, 256); const ng = noiseTile.getContext('2d'); const img = ng.createImageData(256, 256), d = img.data;
    for (let i = 0; i < 256 * 256; i++) { const v = (Math.random() * 255) | 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    ng.putImageData(img, 0, 0);
  }
  g.save();
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = Math.min(1, amount / 55);
  g.fillStyle = g.createPattern(noiseTile, 'repeat');
  g.translate(-Math.floor(r() * 256), -Math.floor(r() * 256));
  g.fillRect(0, 0, w + 256, h + 256);
  g.restore();
}

// soft, tileable cloud overlay (value noise upscaled from a tiny wrapped grid)
function cloud(g, w, h, r, n, color, alpha, contrast = 1.4) {
  const s = cv(n, n), sg = s.getContext('2d');
  const img = sg.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    img.data[i * 4] = color[0]; img.data[i * 4 + 1] = color[1]; img.data[i * 4 + 2] = color[2];
    img.data[i * 4 + 3] = Math.pow(r(), contrast) * 255 * alpha;
  }
  sg.putImageData(img, 0, 0);
  const t = cv(n * 3, n * 3), tg = t.getContext('2d');
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) tg.drawImage(s, x * n, y * n);
  g.save();
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(t, -w, -h, w * 3, h * 3);
  g.restore();
}

// draw something with wrap-around so tiles stay seamless
function wrapped(w, h, x, y, rad, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const px = x + ox * w, py = y + oy * h;
    if (px + rad < 0 || px - rad > w || py + rad < 0 || py - rad > h) continue;
    fn(px, py);
  }
}

function blot(g, w, h, r, count, color, maxR, alpha) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = (0.25 + r() * 0.75) * maxR, a = alpha * (0.4 + r() * 0.6);
    wrapped(w, h, x, y, rad, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, rad);
      gr.addColorStop(0, rgba(color, a)); gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
}

function scratches(g, w, h, r, count, color, a, len = 60) {
  g.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, ang = r() * Math.PI, l = 10 + r() * len;
    g.strokeStyle = rgba(color, a * (0.3 + r() * 0.7));
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); g.stroke();
  }
}

// random-walk crack with branches
function crack(g, r, x, y, ang, len, width, color, depth = 0) {
  g.lineWidth = width; g.strokeStyle = color;
  g.beginPath(); g.moveTo(x, y);
  let cx = x, cy = y, a = ang;
  const steps = Math.floor(len / 6);
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * 0.9;
    cx += Math.cos(a) * 6; cy += Math.sin(a) * 6;
    g.lineTo(cx, cy);
    if (depth < 2 && r() < 0.07) {
      const bx = cx, by = cy, ba = a + (r() < 0.5 ? 0.7 : -0.7);
      g.stroke();
      crack(g, r, bx, by, ba, len * 0.45, width * 0.7, color, depth + 1);
      g.beginPath(); g.moveTo(cx, cy);
    }
  }
  g.stroke();
}

// ------------------------------------------------------------------ wood floor
function genWoodFloor(seed, tone) {
  const r = mulberry32(seed), W = 512, H = 512, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = '#0d0805'; g.fillRect(0, 0, W, H);
  const rows = 8, rh = H / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 220;
    while (x < W) {
      const len = 150 + r() * 250;
      const bx = Math.max(0, x), ex = Math.min(W, x + len);
      const l = 0.7 + r() * 0.65;
      const y0 = i * rh + 1.5, bh = rh - 3;
      const gr = g.createLinearGradient(0, y0, 0, y0 + bh);
      gr.addColorStop(0, rgb(tone, l * 1.1)); gr.addColorStop(0.5, rgb(tone, l * 0.9)); gr.addColorStop(1, rgb(tone, l * 1.05));
      g.fillStyle = gr; g.fillRect(bx, y0, ex - bx - 1.5, bh);
      for (let k = 0; k < 14; k++) {
        const yy = y0 + r() * bh; g.strokeStyle = rgba(r() < 0.5 ? [20, 12, 6] : [150, 110, 70], 0.12 + r() * 0.2);
        g.lineWidth = 0.6 + r() * 1.3; g.beginPath(); g.moveTo(bx, yy);
        const ph = r() * 6, amp = 0.6 + r() * 1.8;
        for (let xx = bx; xx < ex; xx += 8) g.lineTo(xx, yy + Math.sin(xx * 0.05 + ph) * amp);
        g.stroke();
      }
      if (r() < 0.18) { // knot
        const kx = bx + 20 + r() * Math.max(10, ex - bx - 40), ky = y0 + bh * (0.3 + r() * 0.4);
        for (let q = 4; q > 0; q--) { g.strokeStyle = rgba([25, 14, 8], 0.35); g.lineWidth = 1; g.beginPath(); g.ellipse(kx, ky, q * 3.5, q * 1.8, 0, 0, 6.3); g.stroke(); }
        g.fillStyle = 'rgba(10,5,3,.8)'; g.beginPath(); g.ellipse(kx, ky, 2.4, 1.3, 0, 0, 6.3); g.fill();
      }
      g.fillStyle = 'rgba(10,6,4,.85)';
      if (bx > 1) { g.beginPath(); g.arc(bx + 5, y0 + bh * 0.3, 1.3, 0, 6.3); g.arc(bx + 5, y0 + bh * 0.7, 1.3, 0, 6.3); g.fill(); }
      x += len;
    }
  }
  cloud(g, W, H, r, 6, [8, 5, 3], 0.7, 1.2);
  cloud(g, W, H, r, 20, [6, 4, 2], 0.45, 1.6);
  blot(g, W, H, r, 5, [4, 2, 1], 90, 0.55);
  scratches(g, W, H, r, 60, [210, 180, 140], 0.12, 90);
  grainNoise(g, W, H, r, 22);
  return c;
}

// ------------------------------------------------------------------ wallpaper
function genWallpaper(seed, A, B, motif) {
  const r = mulberry32(seed), W = 512, H = 512, c = cv(W, H), g = c.getContext('2d');
  const sw = 64;
  for (let i = 0; i < W / sw; i++) {
    g.fillStyle = i % 2 ? rgb(B) : rgb(A);
    g.fillRect(i * sw, 0, sw, H);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(i * sw, 0, 2, H);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(i * sw + 2, 0, 1.5, H);
  }
  // damask motif inside the A stripes
  g.strokeStyle = rgba(motif, 0.4); g.fillStyle = rgba(motif, 0.28); g.lineWidth = 1.5;
  for (let i = 0; i < W / sw; i += 2) {
    const cx = i * sw + sw / 2;
    for (let y = 40; y < H; y += 128) {
      g.beginPath(); g.moveTo(cx, y - 32); g.bezierCurveTo(cx + 24, y - 12, cx + 16, y + 12, cx, y + 30);
      g.bezierCurveTo(cx - 16, y + 12, cx - 24, y - 12, cx, y - 32); g.stroke();
      g.beginPath(); g.arc(cx, y, 5, 0, 6.3); g.fill();
      g.beginPath(); g.moveTo(cx - 14, y + 44); g.quadraticCurveTo(cx, y + 30, cx + 14, y + 44); g.stroke();
      g.beginPath(); g.arc(cx, y + 64, 3, 0, 6.3); g.fill();
    }
  }
  cloud(g, W, H, r, 5, [25, 18, 8], 0.75, 1.1);
  cloud(g, W, H, r, 18, [10, 8, 4], 0.5, 1.5);
  for (let i = 0; i < 14; i++) { // water streaks
    const x = r() * W, len = 60 + r() * 380, wd = 3 + r() * 14;
    wrapped(W, H, x, 0, wd, (px) => {
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(45,28,10,0.38)'); gr.addColorStop(1, 'rgba(45,28,10,0)');
      g.fillStyle = gr; g.fillRect(px - wd / 2, 0, wd, len);
    });
  }
  blot(g, W, H, r, 9, [8, 12, 6], 60, 0.35);
  scratches(g, W, H, r, 40, [220, 200, 170], 0.1, 60);
  grainNoise(g, W, H, r, 26);
  return c;
}

function genPlaster(seed, base) {
  const r = mulberry32(seed), W = 512, H = 512, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = rgb(base); g.fillRect(0, 0, W, H);
  cloud(g, W, H, r, 4, [40, 30, 15], 0.9, 1.0);
  cloud(g, W, H, r, 16, [20, 15, 8], 0.6, 1.4);
  cloud(g, W, H, r, 48, [220, 215, 200], 0.25, 1.8);
  blot(g, W, H, r, 7, [35, 24, 10], 110, 0.5);
  blot(g, W, H, r, 4, [8, 12, 8], 50, 0.35);
  for (let i = 0; i < 5; i++) crack(g, r, r() * W, r() * H, r() * 6.3, 140 + r() * 200, 1.4, 'rgba(18,12,8,.75)');
  for (let i = 0; i < 4; i++) crack(g, r, r() * W, r() * H, r() * 6.3, 100 + r() * 160, 0.8, 'rgba(235,228,210,.3)');
  grainNoise(g, W, H, r, 24);
  return c;
}

function genDarkWood(seed, tone) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = rgb(tone); g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const y = r() * H; g.strokeStyle = rgba(r() < 0.55 ? [8, 4, 2] : [130, 90, 55], 0.1 + r() * 0.25);
    g.lineWidth = 0.5 + r() * 1.6; g.beginPath(); g.moveTo(0, y);
    const ph = r() * 6, amp = 1 + r() * 5, f = 0.01 + r() * 0.03;
    for (let x = 0; x <= W; x += 6) g.lineTo(x, y + Math.sin(x * f + ph) * amp);
    g.stroke();
  }
  cloud(g, W, H, r, 8, [4, 2, 1], 0.55, 1.2);
  scratches(g, W, H, r, 40, [190, 150, 110], 0.18, 50);
  grainNoise(g, W, H, r, 20);
  return c;
}

function genTile(seed, a, b, n = 8) {
  const r = mulberry32(seed), W = 512, H = 512, c = cv(W, H), g = c.getContext('2d');
  const s = W / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = 0.85 + r() * 0.3;
    g.fillStyle = rgb((x + y) % 2 ? a : b, k); g.fillRect(x * s, y * s, s, s);
  }
  g.strokeStyle = 'rgba(8,8,6,.9)'; g.lineWidth = 3;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, H); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(W, i * s); g.stroke(); }
  cloud(g, W, H, r, 5, [30, 22, 10], 0.85, 1.1);
  cloud(g, W, H, r, 22, [8, 6, 3], 0.6, 1.5);
  blot(g, W, H, r, 6, [60, 10, 8], 40, 0.25);
  for (let i = 0; i < 6; i++) crack(g, r, r() * W, r() * H, r() * 6.3, 80 + r() * 120, 1.2, 'rgba(10,8,6,.8)');
  grainNoise(g, W, H, r, 24);
  return c;
}

function genWallTile(seed) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  const tw = 64, th = 32;
  for (let y = 0; y < H / th; y++) for (let x = -1; x < W / tw + 1; x++) {
    const k = 0.9 + r() * 0.2, off = (y % 2) * tw / 2;
    g.fillStyle = `rgb(${150 * k},${150 * k},${138 * k})`; g.fillRect(x * tw + off, y * th, tw, th);
    g.strokeStyle = 'rgba(15,12,8,.85)'; g.lineWidth = 2.5; g.strokeRect(x * tw + off, y * th, tw, th);
  }
  cloud(g, W, H, r, 5, [30, 22, 8], 0.9, 1.0);
  for (let i = 0; i < 8; i++) { const x = r() * W; g.fillStyle = 'rgba(60,20,10,.22)'; g.fillRect(x, 0, 3 + r() * 6, 40 + r() * 200); }
  grainNoise(g, W, H, r, 22);
  return c;
}

function genPanel(seed) { // wainscoting
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = 'rgb(46,30,20)'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2; i++) {
    const x = i * 128 + 14;
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, 20, 100, 216);
    g.strokeStyle = 'rgba(150,110,70,.25)'; g.lineWidth = 2; g.strokeRect(x + 6, 26, 88, 204);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeRect(x, 20, 100, 216);
  }
  for (let i = 0; i < 40; i++) { const y = r() * H; g.strokeStyle = `rgba(0,0,0,${0.1 + r() * 0.2})`; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + (r() - 0.5) * 6); g.stroke(); }
  cloud(g, W, H, r, 6, [5, 3, 2], 0.6, 1.2);
  grainNoise(g, W, H, r, 20);
  return c;
}

function genFabric(seed, base, worn) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = rgb(base); g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 3) { g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.08})`; g.fillRect(0, y, W, 1); }
  for (let x = 0; x < W; x += 3) { g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`; g.fillRect(x, 0, 1, H); }
  cloud(g, W, H, r, 6, worn, 0.7, 1.1);
  blot(g, W, H, r, 5, [60, 12, 10], 40, 0.25);
  grainNoise(g, W, H, r, 26);
  return c;
}

function genRug(seed, main, accent) {
  const r = mulberry32(seed), W = 512, H = 512, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = rgb(main); g.fillRect(0, 0, W, H);
  g.lineWidth = 6; g.strokeStyle = rgb(accent); g.strokeRect(16, 16, W - 32, H - 32);
  g.lineWidth = 2; g.strokeStyle = 'rgba(220,190,120,.55)'; g.strokeRect(34, 34, W - 68, H - 68); g.strokeRect(48, 48, W - 96, H - 96);
  for (let i = 0; i < 28; i++) { // border pattern
    const t = (i / 28) * (W - 90) + 45;
    g.fillStyle = rgba(accent, 0.7);
    [[t, 40], [t, H - 40]].forEach(([x, y]) => { g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.fill(); });
    [[40, t], [W - 40, t]].forEach(([x, y]) => { g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.fill(); });
  }
  const cx = W / 2, cy = H / 2;
  for (let k = 5; k > 0; k--) {
    g.fillStyle = k % 2 ? rgba(accent, 0.34) : rgba(main, 0.9);
    g.beginPath(); g.moveTo(cx, cy - k * 38); g.lineTo(cx + k * 30, cy); g.lineTo(cx, cy + k * 38); g.lineTo(cx - k * 30, cy); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(230,200,130,.35)'; g.lineWidth = 1.5; g.stroke();
  }
  for (let i = 0; i < 40; i++) { const x = 70 + r() * (W - 140), y = 70 + r() * (H - 140); g.fillStyle = rgba(accent, 0.25); g.beginPath(); g.arc(x, y, 2 + r() * 4, 0, 6.3); g.fill(); }
  cloud(g, W, H, r, 5, [10, 8, 4], 0.85, 1.0);
  blot(g, W, H, r, 6, [20, 8, 6], 70, 0.5);
  for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(0, y, W, 1); }
  grainNoise(g, W, H, r, 28);
  return c;
}

function genEnamel(seed, base) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = rgb(base); g.fillRect(0, 0, W, H);
  cloud(g, W, H, r, 5, [60, 40, 20], 0.8, 1.0);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${90 + r() * 40},${40 + r() * 20},10,${0.2 + r() * 0.5})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  for (let i = 0; i < 6; i++) { const x = r() * W; g.fillStyle = 'rgba(70,35,12,.25)'; g.fillRect(x, 0, 2 + r() * 5, 50 + r() * 190); }
  grainNoise(g, W, H, r, 22);
  return c;
}

function genBooks(seed) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = '#080503'; g.fillRect(0, 0, W, H);
  const rows = 4, rh = H / rows;
  const cols = [[90, 20, 20], [30, 60, 40], [40, 36, 90], [100, 70, 30], [60, 40, 28], [20, 20, 24], [110, 100, 70]];
  for (let i = 0; i < rows; i++) {
    let x = 2;
    while (x < W - 6) {
      const bw = 6 + r() * 14, bh = rh * (0.62 + r() * 0.33), col = cols[Math.floor(r() * cols.length)], k = 0.55 + r() * 0.6;
      const tilt = r() < 0.06;
      g.fillStyle = rgb(col, k); g.fillRect(x, (i + 1) * rh - bh - 5, bw, bh);
      g.fillStyle = 'rgba(210,175,90,.6)'; g.fillRect(x, (i + 1) * rh - bh + 6 - 5, bw, 2); g.fillRect(x, (i + 1) * rh - 14 - 5, bw, 2);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + bw - 2, (i + 1) * rh - bh - 5, 2, bh);
      x += bw + (tilt ? 10 : 0.5);
    }
    g.fillStyle = 'rgb(35,22,14)'; g.fillRect(0, (i + 1) * rh - 5, W, 5);
  }
  cloud(g, W, H, r, 8, [10, 8, 5], 0.8, 1.0);
  grainNoise(g, W, H, r, 22);
  return c;
}

function genDoor(seed, front) {
  const r = mulberry32(seed), W = 256, H = 512, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = front ? 'rgb(34,22,15)' : 'rgb(52,35,24)'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 110; i++) { const x = r() * W; g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '120,85,55'},${0.1 + r() * 0.2})`; g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 12, H); g.stroke(); }
  const panels = [[30, 36, 80, 190], [146, 36, 80, 190], [30, 262, 80, 210], [146, 262, 80, 210]];
  panels.forEach(([x, y, w, h]) => {
    g.fillStyle = 'rgba(0,0,0,.32)'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    g.strokeStyle = 'rgba(150,110,70,.28)'; g.lineWidth = 2; g.strokeRect(x + 5, y + 5, w - 10, h - 10);
  });
  if (front) {
    g.fillStyle = 'rgba(15,15,15,.9)'; [90, 250, 420].forEach((y) => g.fillRect(0, y, W, 12));
    g.fillStyle = 'rgba(120,110,95,.3)'; [90, 250, 420].forEach((y) => g.fillRect(0, y, W, 2));
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(150,140,125,.5)'; g.beginPath(); g.arc(14 + i * 17.5, 96, 2, 0, 6.3); g.fill(); }
  }
  cloud(g, W, H, r, 6, [6, 4, 2], 0.7, 1.2);
  for (let i = 0; i < 3; i++) { // claw gouges
    const x = 60 + r() * 140, y = 150 + r() * 200; g.strokeStyle = 'rgba(200,165,120,.5)'; g.lineWidth = 1.6;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 7, y); g.lineTo(x + k * 7 + 6, y + 80 + r() * 20); g.stroke(); }
  }
  grainNoise(g, W, H, r, 22);
  return c;
}

function genPaper(seed, scrib = true) {
  const r = mulberry32(seed), W = 128, H = 128, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = 'rgb(172,152,110)'; g.fillRect(0, 0, W, H);
  cloud(g, W, H, r, 5, [90, 60, 20], 0.7, 1.0);
  if (scrib) {
    g.strokeStyle = 'rgba(30,20,10,.75)'; g.lineWidth = 1;
    for (let y = 16; y < H - 8; y += 9) { g.beginPath(); g.moveTo(14, y); for (let x = 14; x < W - 14 - r() * 40; x += 5) g.lineTo(x, y + (r() - 0.5) * 3.2); g.stroke(); }
  }
  grainNoise(g, W, H, r, 26);
  return c;
}

function genMirror(seed) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, 'rgb(70,78,86)'); gr.addColorStop(0.5, 'rgb(40,46,54)'); gr.addColorStop(1, 'rgb(62,70,76)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  cloud(g, W, H, r, 8, [8, 8, 8], 0.9, 1.0);
  blot(g, W, H, r, 10, [120, 120, 100], 40, 0.2);
  for (let i = 0; i < 3; i++) crack(g, r, W / 2 + (r() - 0.5) * 80, H / 2 + (r() - 0.5) * 80, r() * 6.3, 160, 1.3, 'rgba(210,220,230,.65)');
  grainNoise(g, W, H, r, 20);
  return c;
}

// ------------------------------------------------------------------ decals (alpha)
function genDecal(kind, seed) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  if (kind === 'stain') {
    for (let i = 0; i < 4; i++) {
      const rad = 50 + r() * 70, x = 128 + (r() - 0.5) * 60, y = 128 + (r() - 0.5) * 60;
      const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      gr.addColorStop(0, 'rgba(40,24,8,.25)'); gr.addColorStop(0.75, 'rgba(30,18,6,.34)'); gr.addColorStop(0.9, 'rgba(14,8,3,.55)'); gr.addColorStop(1, 'rgba(14,8,3,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, 6.3); g.fill();
    }
    for (let i = 0; i < 6; i++) { const x = 60 + r() * 140; const gr = g.createLinearGradient(0, 128, 0, 256); gr.addColorStop(0, 'rgba(30,18,6,.4)'); gr.addColorStop(1, 'rgba(30,18,6,0)'); g.fillStyle = gr; g.fillRect(x, 128, 2 + r() * 6, 60 + r() * 68); }
  } else if (kind === 'mold') {
    cloud(g, W, H, r, 10, [8, 14, 6], 1.0, 0.8);
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (x - 128) / 128, dy = (y - 128) / 128; d[(y * W + x) * 4 + 3] *= Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)); }
    g.putImageData(img, 0, 0);
  } else if (kind === 'peel') {
    g.fillStyle = 'rgba(165,155,132,.9)'; g.beginPath();
    let a = 0; const pts = [];
    while (a < 6.28) { const rad = 60 + r() * 55; pts.push([128 + Math.cos(a) * rad * 1.1, 128 + Math.sin(a) * rad * 0.8]); a += 0.3 + r() * 0.25; }
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(10,6,3,.85)'; g.lineWidth = 3; g.stroke();
    cloud(g, W, H, r, 10, [40, 28, 12], 0.5, 1.2);
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = '#000'; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
  } else if (kind === 'crackwall') {
    crack(g, r, 128, 10, 1.57, 300, 2.2, 'rgba(8,5,3,.9)');
    crack(g, r, 128, 10, 1.57, 200, 1, 'rgba(210,200,175,.25)');
  } else if (kind === 'hand') {
    g.fillStyle = 'rgba(95,10,10,.85)';
    g.beginPath(); g.ellipse(128, 160, 44, 52, 0, 0, 6.3); g.fill();
    [[-38, 90, -0.45, 50], [-14, 70, -0.15, 60], [12, 66, 0.05, 64], [38, 84, 0.3, 54], [58, 128, 1.0, 42]].forEach(([dx, dy, rot, len]) => {
      g.save(); g.translate(128 + dx, dy + 40); g.rotate(rot); g.beginPath(); g.ellipse(0, 0, 11, len / 2, 0, 0, 6.3); g.fill(); g.restore();
    });
    for (let i = 0; i < 7; i++) { const x = 90 + r() * 80, y = 190; const gr = g.createLinearGradient(0, y, 0, y + 60); gr.addColorStop(0, 'rgba(95,10,10,.8)'); gr.addColorStop(1, 'rgba(95,10,10,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 3, 20 + r() * 40); }
    cloud(g, W, H, r, 12, [0, 0, 0], 0.55, 1.4);
  } else if (kind === 'scratch') {
    for (let k = 0; k < 5; k++) {
      const x0 = 70 + k * 22 + r() * 8; g.strokeStyle = 'rgba(8,5,3,.9)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x0, 14);
      for (let y = 14; y < 242; y += 12) g.lineTo(x0 + (y - 14) * 0.22 + (r() - 0.5) * 3, y); g.stroke();
      g.strokeStyle = 'rgba(210,190,150,.3)'; g.lineWidth = 0.8; g.stroke();
    }
  } else if (kind.startsWith('scrawl:')) {
    const txt = kind.slice(7);
    g.font = 'bold 54px "Segoe Script","Brush Script MT","Comic Sans MS",cursive';
    g.fillStyle = 'rgba(105,8,8,.92)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = txt.split('|'); const lh = H / (lines.length + 1);
    g.save(); g.scale(1, 1);
    lines.forEach((l, i) => { g.save(); g.translate(128, lh * (i + 1)); g.rotate((r() - 0.5) * 0.08); g.fillText(l, 0, 0, 250); g.restore(); });
    g.restore();
    for (let i = 0; i < 16; i++) { const x = 20 + r() * 216, y = 60 + r() * 130; const gr = g.createLinearGradient(0, y, 0, y + 70); gr.addColorStop(0, 'rgba(105,8,8,.85)'); gr.addColorStop(1, 'rgba(105,8,8,0)'); g.fillStyle = gr; g.fillRect(x, y, 1.5 + r() * 1.5, 20 + r() * 50); }
  }
  return c;
}

// ------------------------------------------------------------------ entity skins
function genCloth(seed) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = 'rgb(34,34,40)'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) { const x = r() * W; g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '90,90,100'},${0.06 + r() * 0.18})`; g.lineWidth = 0.6 + r() * 1.4; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 20, H); g.stroke(); }
  cloud(g, W, H, r, 6, [4, 4, 6], 0.8, 1.1);
  cloud(g, W, H, r, 20, [120, 120, 130], 0.18, 1.8);
  grainNoise(g, W, H, r, 30);
  return c;
}
function genRibs(seed) {
  const r = mulberry32(seed), W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgb(46,44,42)'); gr.addColorStop(1, 'rgb(22,21,22)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) {
    const y = 34 + i * 24;
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, y + 6, W, 8);
    g.fillStyle = `rgba(${130 + r() * 30},${128 + r() * 25},${116 + r() * 20},.9)`; g.fillRect(0, y - 4, W, 9);
    g.fillStyle = 'rgba(255,255,240,.18)'; g.fillRect(0, y - 4, W, 2);
  }
  g.fillStyle = 'rgba(110,108,98,.9)'; g.fillRect(W / 2 - 4, 0, 8, H);
  cloud(g, W, H, r, 6, [8, 6, 6], 0.7, 1.1);
  grainNoise(g, W, H, r, 22);
  return c;
}

// ------------------------------------------------------------------ cobweb, sprites
function genCobweb() {
  const r = mulberry32(7), S = 256, c = cv(S, S), g = c.getContext('2d');
  g.translate(0, S); g.scale(1, -1); // apex at the plane's bottom-left corner
  g.strokeStyle = 'rgba(235,235,230,.7)'; g.lineWidth = 1.3;
  const rays = 7;
  for (let i = 0; i <= rays; i++) { const a = (i / rays) * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * S, Math.sin(a) * S); g.stroke(); }
  g.lineWidth = 0.9; g.strokeStyle = 'rgba(235,235,230,.55)';
  for (let ring = 1; ring < 9; ring++) {
    const rad = ring * 30 + r() * 6;
    g.beginPath();
    for (let i = 0; i < rays; i++) {
      const a0 = (i / rays) * Math.PI / 2, a1 = ((i + 1) / rays) * Math.PI / 2, am = (a0 + a1) / 2;
      const sag = 0.78 - r() * 0.06;
      g.moveTo(Math.cos(a0) * rad, Math.sin(a0) * rad);
      g.quadraticCurveTo(Math.cos(am) * rad * sag, Math.sin(am) * rad * sag, Math.cos(a1) * rad, Math.sin(a1) * rad);
    }
    g.stroke();
  }
  return c;
}

function radialSprite(S, stops) {
  const c = cv(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  stops.forEach(([t, col]) => gr.addColorStop(t, col));
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}

function genFlame() {
  const W = 64, H = 128, c = cv(W, H), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 92, 2, 32, 82, 56);
  gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.18, 'rgba(255,200,90,.95)');
  gr.addColorStop(0.5, 'rgba(255,110,20,.45)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = gr; g.save(); g.translate(32, 90); g.scale(0.55, 1.15); g.translate(-32, -90); g.fillRect(0, 0, W, H * 1.5); g.restore();
  return c;
}

function genGlint() {
  const S = 128, c = cv(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,245,200,1)'); gr.addColorStop(0.1, 'rgba(255,220,120,.7)'); gr.addColorStop(0.4, 'rgba(255,180,60,.12)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  [[64, 2, 128, 2], [2, 64, 2, 128]].forEach(() => {});
  const h = g.createLinearGradient(0, 0, S, 0); h.addColorStop(0, 'rgba(255,230,160,0)'); h.addColorStop(0.5, 'rgba(255,240,190,.95)'); h.addColorStop(1, 'rgba(255,230,160,0)');
  g.fillStyle = h; g.fillRect(0, 62, S, 4);
  const v = g.createLinearGradient(0, 0, 0, S); v.addColorStop(0, 'rgba(255,230,160,0)'); v.addColorStop(0.5, 'rgba(255,240,190,.95)'); v.addColorStop(1, 'rgba(255,230,160,0)');
  g.fillStyle = v; g.fillRect(62, 0, 4, S);
  return c;
}

function genSmoke(seed) {
  const r = mulberry32(seed), S = 128, c = cv(S, S), g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 22 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(0,0,0,.34)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  return c;
}

function genCookie() {
  const S = 512, c = cv(S, S), g = c.getContext('2d'), r = mulberry32(99);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgb(255,250,236)'); gr.addColorStop(0.32, 'rgb(244,236,214)'); gr.addColorStop(0.62, 'rgb(190,178,150)');
  gr.addColorStop(0.82, 'rgb(98,90,72)'); gr.addColorStop(0.93, 'rgb(40,36,28)'); gr.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 6.3); g.fill();
  // lens artifacts: faint ring + radial streaks + a darker filament shadow
  { const rg = g.createRadialGradient(S / 2, S / 2, 120, S / 2, S / 2, 190); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.5, 'rgba(0,0,0,.16)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, S, S); }
  g.strokeStyle = 'rgba(255,255,240,.05)'; g.lineWidth = 2;
  for (let i = 0; i < 48; i++) { const a = r() * 6.3; g.beginPath(); g.moveTo(S / 2 + Math.cos(a) * 20, S / 2 + Math.sin(a) * 20); g.lineTo(S / 2 + Math.cos(a) * 250, S / 2 + Math.sin(a) * 250); g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,.07)'; g.beginPath(); g.ellipse(S / 2, S / 2, 22, 56, 0.35, 0, 6.3); g.fill();
  grainNoise(g, S, S, r, 14);
  return c;
}

function genSky() {
  const W = 1024, H = 256, c = cv(W, H), g = c.getContext('2d'), r = mulberry32(31);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgb(150,170,210)'); gr.addColorStop(0.7, 'rgb(235,240,255)'); gr.addColorStop(1, 'rgb(255,255,255)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  cloud(g, W, H, r, 8, [40, 50, 80], 0.8, 1.0);
  g.strokeStyle = '#000'; g.fillStyle = '#000';
  const tree = (x, base, h) => {
    const branch = (bx, by, ang, len, wd) => {
      if (len < 5) return;
      const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
      g.lineWidth = wd; g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
      branch(ex, ey, ang - 0.25 - r() * 0.5, len * (0.68 + r() * 0.1), wd * 0.7);
      branch(ex, ey, ang + 0.25 + r() * 0.5, len * (0.68 + r() * 0.1), wd * 0.7);
    };
    branch(x, base, -Math.PI / 2 + (r() - 0.5) * 0.15, h * 0.34, h * 0.07);
  };
  for (let i = 0; i < 22; i++) tree(r() * W, H + 6, 90 + r() * 110);
  g.fillRect(0, H - 30, W, 30);
  return c;
}

// ------------------------------------------------------------------ creepy faces
function genPortrait(seed) {
  const r = mulberry32(seed), W = 256, H = 320, c = cv(W, H), g = c.getContext('2d');
  const kind = seed % 5;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, rgb([42, 38, 26], 0.9 + r() * 0.3)); bg.addColorStop(1, rgb([20, 16, 10]));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  cloud(g, W, H, r, 6, [10, 8, 4], 0.8, 1.0);
  // shoulders / coat
  g.fillStyle = rgb([14 + r() * 10, 12 + r() * 8, 10]);
  g.beginPath(); g.moveTo(10, H); g.quadraticCurveTo(24, 235, 100, 218); g.lineTo(156, 218); g.quadraticCurveTo(232, 235, 246, H); g.closePath(); g.fill();
  g.fillStyle = 'rgb(160,152,132)'; g.beginPath(); g.moveTo(104, 218); g.lineTo(128, 252); g.lineTo(152, 218); g.lineTo(140, 214); g.lineTo(128, 232); g.lineTo(116, 214); g.closePath(); g.fill();
  // neck + face
  const skin = [172 - r() * 24, 150 - r() * 20, 128 - r() * 16];
  g.fillStyle = rgb(skin, 0.7); g.fillRect(110, 190, 36, 36);
  const fw = 52 + r() * 6, fh = 78 + r() * 14;
  const fg = g.createRadialGradient(120, 120, 10, 128, 130, 90);
  fg.addColorStop(0, rgb(skin, 1.05)); fg.addColorStop(1, rgb(skin, 0.45));
  g.fillStyle = fg; g.beginPath(); g.ellipse(128, 128, fw, fh, 0, 0, 6.3); g.fill();
  // hair / hat
  g.fillStyle = rgb([14, 10, 8]);
  if (kind === 0) { g.beginPath(); g.ellipse(128, 70, fw + 10, 34, 0, Math.PI, 0); g.fill(); g.fillRect(70, 70, 14, 110); g.fillRect(172, 70, 14, 110); }
  else if (kind === 1) { g.beginPath(); g.ellipse(128, 62, fw + 4, 28, 0, Math.PI, 0); g.fill(); g.beginPath(); g.arc(128, 38, 20, 0, 6.3); g.fill(); }
  else if (kind === 2) { g.fillRect(84, 24, 88, 44); g.fillRect(70, 62, 116, 8); }
  else if (kind === 3) { g.beginPath(); g.ellipse(128, 76, fw + 14, 40, 0, Math.PI, 0); g.fill(); g.beginPath(); g.ellipse(76, 150, 12, 80, 0.1, 0, 6.3); g.ellipse(180, 150, 12, 80, -0.1, 0, 6.3); g.fill(); }
  else { g.beginPath(); g.ellipse(128, 78, fw - 8, 18, 0, Math.PI, 0); g.fill(); }
  // eyes — the paintings are wrong
  const ey = 118 + (r() - 0.5) * 6;
  if (kind === 0 || kind === 3) { // hollow sockets with a pinprick
    g.fillStyle = '#050302'; [100, 156].forEach((x) => { g.beginPath(); g.ellipse(x, ey, 13, 17, 0, 0, 6.3); g.fill(); });
    g.fillStyle = 'rgba(230,230,210,.85)'; [100, 156].forEach((x) => { g.beginPath(); g.arc(x + 1, ey + 2, 1.6, 0, 6.3); g.fill(); });
  } else if (kind === 1) { // too-wide eyes
    g.fillStyle = 'rgb(210,205,185)'; [100, 156].forEach((x) => { g.beginPath(); g.ellipse(x, ey, 14, 11, 0, 0, 6.3); g.fill(); });
    g.fillStyle = '#080604'; [100, 156].forEach((x) => { g.beginPath(); g.arc(x, ey, 4, 0, 6.3); g.fill(); });
  } else if (kind === 2) { // scratched out
    g.fillStyle = '#0a0705'; [100, 156].forEach((x) => { g.beginPath(); g.ellipse(x, ey, 14, 9, 0, 0, 6.3); g.fill(); });
    g.strokeStyle = 'rgba(20,10,6,.95)'; g.lineWidth = 2;
    for (let i = 0; i < 18; i++) { g.beginPath(); const x = 78 + r() * 100, y = ey - 20 + r() * 40; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 30); g.stroke(); }
  } else { // closed, stitched
    g.strokeStyle = '#150a06'; g.lineWidth = 2.5; [100, 156].forEach((x) => { g.beginPath(); g.moveTo(x - 14, ey); g.quadraticCurveTo(x, ey + 7, x + 14, ey); g.stroke(); for (let s = -10; s <= 10; s += 5) { g.beginPath(); g.moveTo(x + s, ey - 3); g.lineTo(x + s, ey + 5); g.stroke(); } });
  }
  g.strokeStyle = 'rgba(40,20,12,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(128, 124); g.lineTo(122, 152); g.lineTo(134, 154); g.stroke();
  // mouth
  g.strokeStyle = '#2a0c0a'; g.lineWidth = 2.5;
  if (kind === 1 || kind === 4) { g.beginPath(); g.moveTo(88, 176); g.quadraticCurveTo(128, 214, 168, 176); g.stroke(); g.strokeStyle = 'rgba(230,225,205,.7)'; g.lineWidth = 1; for (let x = 96; x < 162; x += 5) { g.beginPath(); g.moveTo(x, 186 + Math.sin((x - 88) / 80 * 3.14) * 14 - 8); g.lineTo(x, 188 + Math.sin((x - 88) / 80 * 3.14) * 14); g.stroke(); } }
  else { g.beginPath(); g.moveTo(110, 176); g.lineTo(146, 176); g.stroke(); }
  // age, craquelure, smears
  cloud(g, W, H, r, 7, [15, 10, 5], 0.75, 1.1);
  for (let i = 0; i < 14; i++) crack(g, r, r() * W, r() * H, r() * 6.3, 60 + r() * 100, 0.8, 'rgba(10,6,3,.55)');
  if (r() < 0.6) { g.fillStyle = 'rgba(8,5,3,.55)'; g.beginPath(); g.ellipse(70 + r() * 120, 100 + r() * 80, 20 + r() * 30, 12 + r() * 20, r(), 0, 6.3); g.fill(); }
  const vg = g.createRadialGradient(128, 150, 40, 128, 160, 220); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.8)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  grainNoise(g, W, H, r, 20);
  return c;
}

// the entity's face — three expressions. Eye sockets are fixed; glowing eye meshes sit in them.
export function entityFaceCanvas(expr) {
  const W = 256, H = 320, c = cv(W, H), g = c.getContext('2d'), r = mulberry32(500 + expr);
  const sk = g.createRadialGradient(128, 130, 20, 128, 150, 170);
  sk.addColorStop(0, 'rgb(122,124,118)'); sk.addColorStop(0.6, 'rgb(78,80,76)'); sk.addColorStop(1, 'rgb(22,24,26)');
  g.fillStyle = sk; g.fillRect(0, 0, W, H);
  cloud(g, W, H, r, 8, [20, 22, 28], 0.8, 1.0);
  g.strokeStyle = 'rgba(40,50,70,.5)'; g.lineWidth = 1;
  for (let i = 0; i < 30; i++) crack(g, r, r() * W, r() * H, r() * 6.3, 30 + r() * 50, 0.7, 'rgba(30,36,50,.45)');
  // brow shadow
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(128, 95, 96, 24, 0, 0, 6.3); g.fill();
  // sockets
  const sock = (x, y, rx, ry, rot) => {
    const sg = g.createRadialGradient(x, y, 2, x, y, rx * 1.9); sg.addColorStop(0, 'rgba(0,0,0,.95)'); sg.addColorStop(0.5, 'rgba(0,0,0,.6)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg; g.beginPath(); g.ellipse(x, y, rx * 1.9, ry * 1.6, rot, 0, 6.3); g.fill();
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, 6.3); g.fill();
  };
  const big = expr === 2 ? 1.2 : 1;
  sock(86, 124, 24 * big, 32 * big, 0.12); sock(170, 124, 24 * big, 32 * big, -0.12);
  // nose: two slits
  g.fillStyle = 'rgba(0,0,0,.85)'; g.beginPath(); g.ellipse(120, 188, 2.4, 8, 0.2, 0, 6.3); g.ellipse(136, 188, 2.4, 8, -0.2, 0, 6.3); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 6; g.beginPath(); g.moveTo(128, 140); g.lineTo(128, 182); g.stroke();
  // mouth
  if (expr === 0) {
    g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.moveTo(96, 244); g.quadraticCurveTo(128, 238, 160, 246); g.stroke();
    g.lineWidth = 1.6; for (let x = 100; x < 160; x += 6) { g.beginPath(); g.moveTo(x, 236); g.lineTo(x + 2, 254); g.stroke(); }
  } else if (expr === 1) {
    g.fillStyle = '#000'; g.beginPath(); g.moveTo(34, 214); g.quadraticCurveTo(128, 300, 222, 214); g.quadraticCurveTo(128, 250, 34, 214); g.fill();
    g.strokeStyle = 'rgba(220,220,205,.9)'; g.lineWidth = 1.4;
    for (let t = 0.06; t < 0.95; t += 0.04) { const x = 34 + t * 188, yb = 214 + Math.sin(t * Math.PI) * 38 - 2; g.beginPath(); g.moveTo(x, yb - 12 * Math.sin(t * Math.PI) - 6); g.lineTo(x, yb + 4); g.stroke(); }
  } else {
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(128, 262, 40, 58, 0, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(215,215,200,.9)';
    for (let i = 0; i < 9; i++) { const a = Math.PI + (i / 8) * Math.PI; const x = 128 + Math.cos(a) * 36, y = 262 + Math.sin(a) * 52; g.beginPath(); g.moveTo(x - 2.5, y); g.lineTo(x, y + 12 + r() * 6); g.lineTo(x + 2.5, y); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(88, 200); g.lineTo(80, 300); g.moveTo(168, 200); g.lineTo(176, 300); g.stroke();
  }
  grainNoise(g, W, H, r, 18);
  return c;
}

// ------------------------------------------------------------------ public cache
const cache = new Map();
function memo(key, fn) {
  if (!cache.has(key)) { cache.set(key, fn()); }
  return cache.get(key);
}

export const Tex = {
  woodFloor: (v = 0) => memo('woodFloor' + v, () => toTex(genWoodFloor(11 + v * 7, v ? [72, 52, 38] : [86, 60, 40]))),
  tile: () => memo('tile', () => toTex(genTile(21, [30, 30, 34], [150, 142, 124]))),
  wallTile: () => memo('wallTile', () => toTex(genWallTile(23))),
  wallpaper: (name) => memo('wp' + name, () => {
    const defs = {
      green: [31, [58, 74, 52], [48, 62, 44], [170, 170, 120]],
      burgundy: [32, [96, 42, 46], [80, 34, 38], [190, 150, 120]],
      ochre: [33, [124, 104, 58], [104, 86, 48], [60, 44, 20]],
      slate: [34, [70, 82, 98], [58, 68, 84], [170, 180, 195]],
      cream: [35, [134, 124, 98], [116, 106, 82], [70, 56, 34]],
      rose: [36, [112, 70, 74], [96, 58, 62], [200, 170, 160]],
    };
    const d = defs[name] || defs.cream;
    return toTex(genWallpaper(d[0], d[1], d[2], d[3]));
  }),
  plaster: () => memo('plaster', () => toTex(genPlaster(41, [128, 122, 108]))),
  darkWood: () => memo('darkWood', () => toTex(genDarkWood(51, [66, 44, 30]))),
  lightWood: () => memo('lightWood', () => toTex(genDarkWood(52, [98, 72, 48]))),
  panel: () => memo('panel', () => toTex(genPanel(61))),
  sofa: () => memo('sofa', () => toTex(genFabric(71, [52, 66, 50], [20, 28, 14]))),
  bedding: () => memo('bedding', () => toTex(genFabric(72, [138, 124, 96], [60, 40, 20]))),
  rug: (v = 0) => memo('rug' + v, () => toTex(v ? genRug(82, [66, 26, 28], [112, 86, 50]) : genRug(81, [34, 44, 54], [104, 76, 46]))),
  enamel: () => memo('enamel', () => toTex(genEnamel(91, [140, 138, 126]))),
  books: () => memo('books', () => toTex(genBooks(101))),
  door: () => memo('door', () => toTex(genDoor(111, false), { repeat: false })),
  doorFront: () => memo('doorFront', () => toTex(genDoor(112, true), { repeat: false })),
  paper: (seed = 1) => memo('paper' + seed, () => toTex(genPaper(120 + seed), { repeat: false })),
  mirror: () => memo('mirror', () => toTex(genMirror(131), { repeat: false })),
  decal: (kind, seed = 1) => memo('decal' + kind + seed, () => toTex(genDecal(kind, 140 + seed), { repeat: false })),
  portrait: (seed) => memo('portrait' + seed, () => toTex(genPortrait(seed), { repeat: false })),
  cloth: () => memo('cloth', () => toTex(genCloth(601))),
  ribs: () => memo('ribs', () => toTex(genRibs(602))),
  cobweb: () => memo('cobweb', () => toTex(genCobweb(), { repeat: false })),
  flame: () => memo('flame', () => toTex(genFlame(), { repeat: false })),
  glint: () => memo('glint', () => toTex(genGlint(), { repeat: false })),
  smoke: (v = 0) => memo('smoke' + v, () => toTex(genSmoke(150 + v), { repeat: false })),
  dust: () => memo('dust', () => toTex(radialSprite(64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]), { repeat: false })),
  glow: () => memo('glow', () => toTex(radialSprite(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]), { repeat: false })),
  cookie: () => memo('cookie', () => toTex(genCookie(), { repeat: false })),
  sky: () => memo('sky', () => toTex(genSky(), { repeat: true })),
  entityFace: (expr) => memo('ent' + expr, () => toTex(entityFaceCanvas(expr), { repeat: false })),
};
