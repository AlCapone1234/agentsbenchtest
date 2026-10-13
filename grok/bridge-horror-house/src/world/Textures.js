import * as THREE from 'three';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function makeNoise(rng) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const s = p[i];
    p[i] = p[j];
    p[j] = s;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function grad(h, x, y) {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  }
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  return function noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = grad(aa, xf, yf) + (grad(ba, xf - 1, yf) - grad(aa, xf, yf)) * u;
    const x2 = grad(ab, xf, yf - 1) + (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1)) * u;
    return x1 + (x2 - x1) * v;
  };
}

function fbm(noise, x, y, octaves = 5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / norm;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fillNoise(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = clampByte(c[0]);
      d[i + 1] = clampByte(c[1]);
      d[i + 2] = clampByte(c[2]);
      d[i + 3] = c.length > 3 ? clampByte(c[3]) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function luminanceNormal(src, strength) {
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    height[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.5 + data[i * 4 + 2] * 0.2) / 255;
  }
  const out = canvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)];
      const r = height[y * w + ((x + 1) % w)];
      const u = height[((y - 1 + h) % h) * w + x];
      const dn = height[((y + 1) % h) * w + x];
      const dx = (l - r) * strength;
      const dy = (u - dn) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx / len) * 127.5 + 127.5;
      d[i + 1] = (-dy / len) * 127.5 + 127.5;
      d[i + 2] = (1 / len) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function roughnessFrom(src, invert = false) {
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const lum = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    let rough = invert ? lum : 255 - lum * 0.35;
    rough = 150 + (rough / 255) * 100;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = clampByte(rough);
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function woodFloor(rng) {
  const noise = makeNoise(rng);
  const c = canvas(512, 512);
  const ctx = c.getContext('2d');
  const plankH = 64;
  fillNoise(ctx, 512, 512, (x, y) => {
    const plank = Math.floor(y / plankH);
    const local = (y % plankH) / plankH;
    const seam = local < 0.045 || local > 0.97;
    const knotN = fbm(noise, x * 0.02 + plank * 3.1, y * 0.008, 4);
    const grain = fbm(noise, x * 0.15 + plank, y * 0.004, 3);
    const streak = Math.sin(y * 0.35 + plank) * 0.5 + fbm(noise, x * 0.05, plank * 2, 2);
    let base = 78 + (noise(plank * 1.7, 0.2) * 0.5 + 0.5) * 36;
    base += grain * 22 + streak * 8;
    const knot = Math.hypot((x % 170) - 80, (y % plankH) - plankH * 0.5) < 7 + noise(plank, x * 0.01) * 4;
    if (knot) base *= 0.55;
    if (seam) base *= 0.35;
    const scratch = noise(x * 0.9, y * 0.9) > 0.72 ? -18 : 0;
    const dirt = fbm(noise, x * 0.01, y * 0.01, 3);
    base += dirt * 18 + scratch;
    const g = base * 0.78;
    const b = base * 0.5;
    return [base, g, b];
  });
  return c;
}

function wallpaper(rng, opts) {
  const noise = makeNoise(rng);
  const c = canvas(512, 512);
  const ctx = c.getContext('2d');
  const { stripe, a, b, motif } = opts;
  fillNoise(ctx, 512, 512, (x, y) => {
    const period = stripe;
    const sx = x % period;
    const band = sx < period * 0.42;
    let col = band ? a.slice() : b.slice();
    const n = fbm(noise, x * 0.02, y * 0.02, 5);
    const stain = fbm(noise, x * 0.008 + 4, y * 0.008, 4);
    for (let i = 0; i < 3; i++) col[i] += n * 16;
    if (stain > 0.18) {
      const k = (stain - 0.18) * 1.6;
      col[0] *= 1 - k * 0.55;
      col[1] *= 1 - k * 0.45;
      col[2] *= 1 - k * 0.35;
    }
    if (motif === 'panel') {
      if (y % 86 < 3 || sx < 2) {
        col[0] *= 0.55;
        col[1] *= 0.55;
        col[2] *= 0.55;
      }
    }
    if (motif === 'floral') {
      const cx = (x % 96) - 48;
      const cy = (y % 96) - 48;
      const petal = Math.hypot(cx, cy);
      if (petal > 10 && petal < 18) {
        col[0] *= 0.72;
        col[1] *= 0.62;
        col[2] *= 0.6;
      }
    }
    if (motif === 'damask') {
      const dx = Math.abs((x % 80) - 40);
      const dy = Math.abs((y % 80) - 40);
      if (dx + dy > 28 && dx + dy < 34) {
        col[0] *= 0.8;
        col[1] *= 0.85;
        col[2] *= 0.75;
      }
    }
    const peel = noise(x * 0.05, y * 0.05) > 0.62 && stain > 0;
    if (peel) {
      col[0] += 28;
      col[1] += 24;
      col[2] += 18;
    }
    const grime = y > 430 ? (y - 430) / 82 : y < 24 ? (24 - y) / 24 : 0;
    for (let i = 0; i < 3; i++) col[i] *= 1 - grime * 0.45;
    return col;
  });
  return c;
}

function plaster(rng) {
  const noise = makeNoise(rng);
  const c = canvas(512, 512);
  const ctx = c.getContext('2d');
  fillNoise(ctx, 512, 512, (x, y) => {
    const n = fbm(noise, x * 0.02, y * 0.02, 5);
    const pit = fbm(noise, x * 0.08, y * 0.08, 3);
    let v = 118 + n * 28 + (pit > 0.35 ? -30 : 0);
    const leak = fbm(noise, x * 0.006, y * 0.01, 3);
    if (leak > 0.22) v -= (leak - 0.22) * 160;
    const crack = Math.abs(fbm(noise, x * 0.03, y * 0.015, 2)) < 0.02;
    if (crack) v *= 0.45;
    return [v, v * 0.96, v * 0.88];
  });
  return c;
}

function woodDark(rng, vertical = true) {
  const noise = makeNoise(rng);
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  fillNoise(ctx, 256, 256, (x, y) => {
    const grain = vertical
      ? fbm(noise, x * 0.02, y * 0.12, 4)
      : fbm(noise, x * 0.12, y * 0.02, 4);
    let v = 42 + grain * 18 + noise(x * 0.3, y * 0.3) * 6;
    if (vertical && x % 64 < 2) v *= 0.6;
    return [v * 1.15, v * 0.82, v * 0.55];
  });
  return c;
}

function doorWood(rng) {
  const base = woodDark(rng, false);
  const ctx = base.getContext('2d');
  ctx.strokeStyle = 'rgba(20,12,8,0.85)';
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, 220, 220);
  ctx.lineWidth = 5;
  ctx.strokeRect(36, 36, 184, 78);
  ctx.strokeRect(36, 132, 184, 88);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(36, 36, 184, 78);
  return base;
}

function siding(rng) {
  const noise = makeNoise(rng);
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  fillNoise(ctx, 256, 256, (x, y) => {
    const board = y % 28;
    let v = 18 + fbm(noise, x * 0.03, y * 0.01, 3) * 8;
    if (board < 2) v *= 0.4;
    return [v, v * 1.02, v * 0.9];
  });
  return c;
}

function groundTex(rng) {
  const noise = makeNoise(rng);
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  fillNoise(ctx, 256, 256, (x, y) => {
    const n = fbm(noise, x * 0.03, y * 0.03, 4);
    const v = 10 + n * 8;
    return [v * 0.7, v, v * 0.6];
  });
  return c;
}

function books(rng) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a120c';
  ctx.fillRect(0, 0, 256, 256);
  let x = 4;
  while (x < 250) {
    const w = 7 + (rng() * 14) | 0;
    const h = 70 + (rng() * 50) | 0;
    const y = 20 + (rng() * 16) | 0;
    const r = 30 + (rng() * 50) | 0;
    const g = 18 + (rng() * 30) | 0;
    const b = 14 + (rng() * 24) | 0;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, w - 1, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, 1, h);
    x += w;
  }
  let x2 = 6;
  while (x2 < 250) {
    const w = 8 + (rng() * 16) | 0;
    const h = 64 + (rng() * 40) | 0;
    const r = 24 + (rng() * 40) | 0;
    ctx.fillStyle = `rgb(${r},${r * 0.7},${r * 0.45})`;
    ctx.fillRect(x2, 150, w - 1, h);
    x2 += w;
  }
  return c;
}

function rug(rng) {
  const noise = makeNoise(rng);
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  fillNoise(ctx, 256, 256, (x, y) => {
    const border = x < 14 || y < 14 || x > 241 || y > 241;
    const inner = x > 28 && y > 28 && x < 228 && y < 228;
    let col = border ? [46, 18, 16] : inner ? [62, 22, 22] : [36, 14, 14];
    const n = fbm(noise, x * 0.04, y * 0.04, 3);
    col = col.map((v) => v + n * 12);
    if (((x / 20) | 0) % 2 === 0 && ((y / 20) | 0) % 2 === 0 && !border) {
      col[0] *= 0.8;
    }
    return col;
  });
  return c;
}

function fabric(rng, tint) {
  const noise = makeNoise(rng);
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  fillNoise(ctx, 256, 256, (x, y) => {
    const n = fbm(noise, x * 0.05, y * 0.05, 4);
    const weave = ((x + y) & 3) === 0 ? 6 : 0;
    return [
      tint[0] + n * 16 + weave,
      tint[1] + n * 14 + weave,
      tint[2] + n * 12,
    ];
  });
  return c;
}

function paper(rng) {
  const noise = makeNoise(rng);
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  fillNoise(ctx, 256, 256, (x, y) => {
    const n = fbm(noise, x * 0.03, y * 0.03, 3);
    let v = 168 + n * 20;
    if (y > 40 && y < 210 && x > 28 && x < 230 && Math.floor(y / 14) % 1 === 0 && y % 14 < 2) {
      v *= 0.75;
    }
    const age = fbm(noise, x * 0.01, y * 0.01, 2);
    return [v, v * 0.9 - age * 10, v * 0.7];
  });
  ctx.strokeStyle = 'rgba(40,30,24,0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(36, 58 + i * 22);
    ctx.lineTo(200 + rng() * 24, 58 + i * 22);
    ctx.stroke();
  }
  return c;
}

function cobweb() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(220,220,210,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120);
  }
  ctx.stroke();
  for (let r = 20; r <= 110; r += 16) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}

function tatter(rng) {
  const c = canvas(128, 256);
  const ctx = c.getContext('2d');
  const noise = makeNoise(rng);
  fillNoise(ctx, 128, 256, (x, y) => {
    const edge = Math.abs(x - 64) / 64;
    const n = fbm(noise, x * 0.08, y * 0.04, 3);
    const alpha = edge > 0.72 + n * 0.2 ? 0 : 210;
    const v = 16 + n * 10;
    return [v, v * 0.9, v * 0.85, alpha];
  });
  return c;
}

function flame() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 28, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,240,200,1)');
  g.addColorStop(0.35, 'rgba(255,150,40,0.9)');
  g.addColorStop(0.7, 'rgba(180,40,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

function softDot() {
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return c;
}

function cookie() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  const g = ctx.createRadialGradient(126, 122, 4, 128, 128, 128);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.28, '#f4f4f4');
  g.addColorStop(0.55, '#9a9a9a');
  g.addColorStop(0.78, '#2c2c2c');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(128, 128, 74, 0.5, 2.1);
  ctx.stroke();
  return c;
}

function rainStreaks() {
  const c = canvas(128, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 256);
  ctx.strokeStyle = 'rgba(180,200,220,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = (i * 37) % 128;
    ctx.beginPath();
    ctx.moveTo(x, (i * 53) % 256);
    ctx.lineTo(x + 2, ((i * 53) % 256) + 28);
    ctx.stroke();
  }
  return c;
}

function paintFace(seed, expression, portrait) {
  const rng = mulberry32(seed);
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = portrait ? '#24180f' : '#100e0c';
  g.fillRect(0, 0, 512, 512);

  const skin = portrait ? '#8a7058' : '#6e6760';
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(256, portrait ? 270 : 248, portrait ? 132 : 118, portrait ? 175 : 168, 0.03, 0, Math.PI * 2);
  g.fill();

  const shade = g.createRadialGradient(230, 200, 30, 260, 280, 230);
  shade.addColorStop(0, 'rgba(255,236,210,0.12)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.08)');
  shade.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = shade;
  g.beginPath();
  g.ellipse(256, portrait ? 270 : 248, portrait ? 132 : 118, portrait ? 175 : 168, 0, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = '#070605';
  if (expression === 'scream') {
    g.beginPath();
    g.ellipse(196, 214, 36, 30, -0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(324, 208, 34, 32, 0.25, 0, Math.PI * 2);
    g.fill();
  } else if (expression === 'snarl') {
    g.beginPath();
    g.ellipse(190, 220, 34, 16, 0.4, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(328, 214, 36, 15, -0.25, 0, Math.PI * 2);
    g.fill();
  } else {
    const droop = portrait ? 8 : 0;
    g.beginPath();
    g.ellipse(198, 224 + droop, 26, 16, 0.05, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(322, 230 + droop, 24, 18, -0.08, 0, Math.PI * 2);
    g.fill();
  }

  if (!portrait) {
    g.fillStyle = '#c9c2b6';
    g.beginPath();
    g.ellipse(198, 224, 7, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(322, 226, 6, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a0505';
    g.beginPath();
    g.arc(199, 224, 2.2, 0, Math.PI * 2);
    g.arc(323, 226, 2.2, 0, Math.PI * 2);
    g.fill();
  }

  g.fillStyle = 'rgba(40,24,22,0.55)';
  g.beginPath();
  g.moveTo(256, 250);
  g.lineTo(246, 310);
  g.lineTo(266, 312);
  g.fill();

  g.fillStyle = '#140e0e';
  if (expression === 'scream') {
    g.beginPath();
    g.ellipse(256, 348, 46, 68, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1414';
    g.fillRect(232, 318, 48, 10);
  } else if (expression === 'snarl') {
    g.beginPath();
    g.moveTo(188, 328);
    g.quadraticCurveTo(256, 300, 332, 322);
    g.lineTo(316, 362);
    g.quadraticCurveTo(256, 348, 206, 366);
    g.fill();
    g.strokeStyle = '#d9d0c4';
    g.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.moveTo(210 + i * 14, 326);
      g.lineTo(216 + i * 14, 346);
      g.stroke();
    }
  } else {
    g.strokeStyle = portrait ? '#3a2420' : '#1a1010';
    g.lineWidth = portrait ? 2 : 4;
    g.beginPath();
    g.moveTo(200, 340);
    g.quadraticCurveTo(256, portrait ? 356 : 372, 318, portrait ? 338 : 332);
    g.stroke();
  }

  const img = g.getImageData(0, 0, 512, 512);
  const d = img.data;
  const noise = makeNoise(rng);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      const n = fbm(noise, x * 0.03, y * 0.03, 3) * 28;
      d[i] = clampByte(d[i] + n);
      d[i + 1] = clampByte(d[i + 1] + n * 0.92);
      d[i + 2] = clampByte(d[i + 2] + n * 0.8);
    }
  }
  g.putImageData(img, 0, 0);

  g.strokeStyle = 'rgba(12,8,8,0.7)';
  g.lineWidth = 1;
  for (let i = 0; i < (portrait ? 6 : 10); i++) {
    g.beginPath();
    let x = rng() * 512;
    let y = rng() * 200;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * 70;
      y += rng() * 48;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  const vig = g.createRadialGradient(256, 256, 120, 256, 256, 300);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = vig;
  g.fillRect(0, 0, 512, 512);
  return c;
}

function toMap(cvs, srgb, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(cvs);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function std(mapCanvas, opts = {}) {
  const map = toMap(mapCanvas, true);
  const normalCanvas = opts.normal === false ? null : luminanceNormal(mapCanvas, opts.normalStrength || 2.4);
  const roughCanvas = opts.rough === false ? null : roughnessFrom(mapCanvas, !!opts.roughInvert);
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalCanvas ? toMap(normalCanvas, false) : null,
    roughnessMap: roughCanvas ? toMap(roughCanvas, false) : null,
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0,
    side: opts.side ?? THREE.FrontSide,
    bumpScale: 1,
  });
}

export function createMaterials() {
  const floorC = woodFloor(mulberry32(11));
  const ceilC = plaster(mulberry32(12));
  const woodC = woodDark(mulberry32(13), true);
  const doorC = doorWood(mulberry32(14));
  const sideC = siding(mulberry32(15));
  const groundC = groundTex(mulberry32(16));
  const bookC = books(mulberry32(17));
  const rugC = rug(mulberry32(18));
  const clothC = fabric(mulberry32(19), [48, 28, 26]);
  const sheetC = fabric(mulberry32(20), [70, 66, 60]);
  const paperC = paper(mulberry32(21));

  const papers = {
    hall: wallpaper(mulberry32(31), {
      stripe: 46,
      a: [58, 28, 28],
      b: [36, 20, 20],
      motif: 'none',
    }),
    living: wallpaper(mulberry32(32), {
      stripe: 64,
      a: [52, 48, 36],
      b: [34, 36, 30],
      motif: 'damask',
    }),
    dining: wallpaper(mulberry32(33), {
      stripe: 40,
      a: [48, 32, 28],
      b: [32, 24, 22],
      motif: 'damask',
    }),
    study: wallpaper(mulberry32(34), {
      stripe: 36,
      a: [28, 36, 30],
      b: [18, 24, 20],
      motif: 'none',
    }),
    bed: wallpaper(mulberry32(35), {
      stripe: 72,
      a: [70, 58, 52],
      b: [48, 38, 36],
      motif: 'floral',
    }),
    kitchen: wallpaper(mulberry32(36), {
      stripe: 32,
      a: [78, 72, 60],
      b: [62, 56, 46],
      motif: 'panel',
    }),
    foyer: wallpaper(mulberry32(37), {
      stripe: 52,
      a: [50, 32, 28],
      b: [30, 20, 20],
      motif: 'none',
    }),
  };

  const portraits = [1, 2, 3, 4, 5, 6].map((i) =>
    toMap(paintFace(100 + i * 17, 'calm', true), true),
  );
  const entityCanvases = {
    calm: paintFace(7, 'calm', false),
    snarl: paintFace(8, 'snarl', false),
    scream: paintFace(9, 'scream', false),
  };

  return {
    floor: std(floorC, { roughness: 0.84, normalStrength: 3.2 }),
    ceiling: std(ceilC, { roughness: 1, normalStrength: 2.2 }),
    wood: std(woodC, { roughness: 0.78, normalStrength: 2.2 }),
    door: std(doorC, { roughness: 0.8, normalStrength: 1.6 }),
    siding: std(sideC, { roughness: 0.95 }),
    ground: std(groundC, { roughness: 1, normal: false, rough: false }),
    books: std(bookC, { roughness: 0.9, normal: false, rough: false }),
    rug: std(rugC, { roughness: 1, normal: false, rough: false }),
    cloth: std(clothC, { roughness: 0.95, normal: false, rough: false }),
    sheet: std(sheetC, { roughness: 0.92, normal: false, rough: false }),
    paper: std(paperC, { roughness: 0.95, normal: false, rough: false }),
    wall: {
      hall: std(papers.hall, { roughness: 0.96, normalStrength: 1.8 }),
      living: std(papers.living, { roughness: 0.96, normalStrength: 1.8 }),
      dining: std(papers.dining, { roughness: 0.96, normalStrength: 1.8 }),
      study: std(papers.study, { roughness: 0.96, normalStrength: 1.8 }),
      bed: std(papers.bed, { roughness: 0.94, normalStrength: 1.8 }),
      kitchen: std(papers.kitchen, { roughness: 0.9, normalStrength: 1.6 }),
      foyer: std(papers.foyer, { roughness: 0.96, normalStrength: 1.8 }),
    },
    trim: new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 0.85, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({
      color: 0xb6914e,
      metalness: 0.82,
      roughness: 0.32,
      emissive: 0x6a4a16,
      emissiveIntensity: 0.45,
    }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2420, metalness: 0.55, roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x071018,
      metalness: 0.05,
      roughness: 0.08,
      transparent: true,
      opacity: 0.45,
    }),
    flame: new THREE.SpriteMaterial({
      map: toMap(flame(), true),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    dust: toMap(softDot(), true),
    cookie: toMap(cookie(), false),
    cobweb: new THREE.MeshStandardMaterial({
      map: toMap(cobweb(), true),
      transparent: true,
      alphaTest: 0.2,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    tatter: new THREE.MeshStandardMaterial({
      map: toMap(tatter(mulberry32(44)), true),
      transparent: true,
      alphaTest: 0.25,
      roughness: 0.95,
      side: THREE.DoubleSide,
      color: 0x2a2624,
    }),
    rain: new THREE.MeshBasicMaterial({
      map: toMap(rainStreaks(), true, 1, 2),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    portraits,
    entityFaces: {
      calm: toMap(entityCanvases.calm, true),
      snarl: toMap(entityCanvases.snarl, true),
      scream: toMap(entityCanvases.scream, true),
    },
    entityCanvas: entityCanvases.scream,
    stone: new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.95, metalness: 0 }),
    mattress: new THREE.MeshStandardMaterial({ color: 0x3e3a38, roughness: 0.92, metalness: 0 }),
    bulb: new THREE.MeshStandardMaterial({
      color: 0xffe2b0,
      emissive: 0xffc888,
      emissiveIntensity: 1.15,
      roughness: 0.4,
    }),
    led: new THREE.MeshStandardMaterial({
      color: 0x143322,
      emissive: 0x1f8a4c,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    }),
    eye: new THREE.MeshStandardMaterial({
      color: 0x220000,
      emissive: 0xff1a1a,
      emissiveIntensity: 4.5,
      roughness: 0.25,
    }),
    ghostSkin: new THREE.MeshStandardMaterial({
      color: 0x3c3836,
      roughness: 0.82,
      metalness: 0,
    }),
    ghostDark: new THREE.MeshStandardMaterial({
      color: 0x141210,
      roughness: 0.9,
      metalness: 0,
    }),
  };
}

export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}
