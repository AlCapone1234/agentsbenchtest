import * as THREE from 'three';

// Procedural canvas textures. Everything is generated at boot: no image files, no network.

// Seeded PRNG so the look of each texture is stable run to run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

function toTexture(canvas, { color = false, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
  return tex;
}

// Adds per-pixel grain so flat fills read as worn surfaces.
function addGrain(ctx, w, h, amount, rand) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blotch(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${alpha})`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Wandering crack / grain line from (x, y).
function wanderLine(ctx, x, y, len, step, rand, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let angle = rand() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    angle += (rand() - 0.5) * 0.9;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---- Aged wood plank floor (tile = 2m x 2m, 12 planks per tile) ----
function drawPlankFloor(seed) {
  const rand = rng(seed);
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const planks = 12;
  const pw = S / planks;
  for (let i = 0; i < planks; i++) {
    const shade = 0.75 + rand() * 0.5;
    const r = Math.round(58 * shade), g = Math.round(38 * shade), b = Math.round(22 * shade);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(i * pw, 0, pw, S);
    // grain
    for (let k = 0; k < 26; k++) {
      const x0 = i * pw + rand() * pw;
      ctx.strokeStyle = `rgba(20,12,6,${0.15 + rand() * 0.25})`;
      ctx.lineWidth = 0.6 + rand() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      for (let y = 0; y <= S; y += 32) {
        ctx.lineTo(x0 + Math.sin(y * 0.02 + k) * 2.5 + (rand() - 0.5) * 1.5, y);
      }
      ctx.stroke();
    }
    // staggered end joints
    let y = rand() * S;
    while (y < S + 200) {
      ctx.fillStyle = 'rgba(10,6,3,0.9)';
      ctx.fillRect(i * pw, y, pw, 2);
      y += 200 + rand() * 260;
    }
    // seam between planks
    ctx.fillStyle = 'rgba(8,5,3,0.95)';
    ctx.fillRect(i * pw, 0, 2, S);
  }
  // stains, scuffs and dirt
  for (let k = 0; k < 40; k++) {
    blotch(ctx, rand() * S, rand() * S, 14 + rand() * 46, '8,4,2', 0.25 + rand() * 0.3);
  }
  for (let k = 0; k < 60; k++) {
    wanderLine(ctx, rand() * S, rand() * S, 6 + rand() * 6, 3, rand, 'rgba(120,100,80,0.18)', 1);
  }
  addGrain(ctx, S, S, 22, rand);
  return { canvas, ctx };
}

// Bump map derived from the floor's seams and grain.
function drawPlankBump(seed) {
  const rand = rng(seed + 1);
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  const pw = S / 12;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = '#202020';
    ctx.fillRect(i * pw, 0, 3, S);
  }
  for (let k = 0; k < 220; k++) {
    wanderLine(ctx, rand() * S, rand() * S, 10 + rand() * 12, 2, rand, 'rgba(60,60,60,0.35)', 1.2);
  }
  addGrain(ctx, S, S, 40, rand);
  return canvas;
}

// ---- Striped, stained, peeling wallpaper (tile = 1m x 1m) ----
function drawWallpaper(seed) {
  const rand = rng(seed);
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#2b3730';
  ctx.fillRect(0, 0, S, S);
  const stripe = S / 8;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(74,92,78,0.9)' : 'rgba(36,46,40,0.9)';
    ctx.fillRect(i * stripe, 0, stripe, S);
    // thin pinstripe at the edge of each stripe
    ctx.fillStyle = 'rgba(160,150,120,0.12)';
    ctx.fillRect(i * stripe + 3, 0, 2, S);
  }
  // faint damask-like motif: staggered rosettes on a grid
  ctx.strokeStyle = 'rgba(150,140,110,0.09)';
  ctx.lineWidth = 2;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = col * stripe + stripe / 2;
      const cy = row * 64 + (col % 2) * 32 + 16;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // damp stains that run down from the top
  for (let k = 0; k < 14; k++) {
    const x = rand() * S;
    blotch(ctx, x, rand() * S * 0.4, 40 + rand() * 60, '70,52,30', 0.25 + rand() * 0.2);
    ctx.fillStyle = 'rgba(70,52,30,0.12)';
    ctx.fillRect(x - 3, 0, 6, S * (0.3 + rand() * 0.6));
  }
  // peeled corner: bare plaster with a torn edge
  ctx.fillStyle = 'rgba(120,112,96,0.85)';
  ctx.beginPath();
  ctx.moveTo(S * 0.72, 0);
  ctx.lineTo(S, 0);
  ctx.lineTo(S, S * 0.22);
  ctx.lineTo(S * 0.9, S * 0.2);
  ctx.lineTo(S * 0.86, S * 0.31);
  ctx.lineTo(S * 0.78, S * 0.27);
  ctx.lineTo(S * 0.74, S * 0.12);
  ctx.closePath();
  ctx.fill();
  addGrain(ctx, S, S, 18, rand);
  return { canvas, ctx };
}

function drawWallpaperBump(seed) {
  const rand = rng(seed + 7);
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = '#8c8c8c';
    ctx.fillRect(i * (S / 8), 0, S / 16, S);
  }
  addGrain(ctx, S, S, 30, rand);
  return canvas;
}

// ---- Cracked plaster ceiling (tile = 2m x 2m) ----
function drawCeiling(seed) {
  const rand = rng(seed);
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#4e4b45';
  ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 18; k++) {
    blotch(ctx, rand() * S, rand() * S, 30 + rand() * 80, '20,18,14', 0.22);
  }
  // water stains with a dark tide-line
  for (let k = 0; k < 3; k++) {
    const x = rand() * S, y = rand() * S, r = 35 + rand() * 45;
    ctx.strokeStyle = 'rgba(40,34,22,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    blotch(ctx, x, y, r, '90,80,50', 0.12);
  }
  // hairline cracks branching out
  for (let k = 0; k < 24; k++) {
    const x = rand() * S, y = rand() * S;
    wanderLine(ctx, x, y, 14 + rand() * 18, 4, rand, 'rgba(12,10,8,0.7)', 1.2);
    wanderLine(ctx, x, y, 6 + rand() * 8, 3, rand, 'rgba(12,10,8,0.5)', 0.8);
  }
  addGrain(ctx, S, S, 16, rand);
  return { canvas, ctx };
}

// ---- Dark furniture wood (tile = 1m x 1m) ----
function drawDarkWood(seed) {
  const rand = rng(seed);
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 70; k++) {
    const y0 = rand() * S;
    ctx.strokeStyle = `rgba(${rand() < 0.5 ? '10,6,3' : '70,44,26'},${0.2 + rand() * 0.25})`;
    ctx.lineWidth = 0.7 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    for (let x = 0; x <= S; x += 16) {
      ctx.lineTo(x, y0 + Math.sin(x * 0.03 + k) * 3 + (rand() - 0.5) * 2);
    }
    ctx.stroke();
  }
  for (let k = 0; k < 10; k++) {
    blotch(ctx, rand() * S, rand() * S, 12 + rand() * 30, '6,3,1', 0.3);
  }
  addGrain(ctx, S, S, 14, rand);
  return canvas;
}

// ---- Faded rug (tile = 2m x 3m, drawn square) ----
function drawRug(seed) {
  const rand = rng(seed);
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#4a0f12';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(20,8,6,0.9)';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, S - 28, S - 28);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(160,120,60,0.35)';
  ctx.strokeRect(30, 30, S - 60, S - 60);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 50, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 16; k++) {
    blotch(ctx, rand() * S, rand() * S, 10 + rand() * 24, '15,4,4', 0.35);
  }
  addGrain(ctx, S, S, 20, rand);
  return canvas;
}

// ---- Cobweb corner decal (transparent) ----
function drawCobweb(seed) {
  const rand = rng(seed);
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.strokeStyle = 'rgba(210,210,200,0.55)';
  ctx.lineWidth = 1.2;
  const spokes = 9;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * (Math.PI / 2) + 0.05;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * S * 0.95, Math.sin(a) * S * 0.95);
    ctx.stroke();
  }
  for (let ring = 1; ring <= 7; ring++) {
    ctx.beginPath();
    const r0 = ring * 30;
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * (Math.PI / 2) + 0.05;
      const r = r0 + (rand() - 0.5) * 6;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return canvas;
}

// ---- Rain streaks for window glass (transparent) ----
function drawRain(seed) {
  const rand = rng(seed);
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  for (let k = 0; k < 90; k++) {
    const x = rand() * S, y = rand() * S, len = 10 + rand() * 30;
    ctx.strokeStyle = `rgba(190,210,240,${0.12 + rand() * 0.25})`;
    ctx.lineWidth = 0.8 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.18, y + len);
    ctx.stroke();
  }
  return canvas;
}

// ---- Soft dark vapor puff (transparent) ----
function drawVapor(seed) {
  const rand = rng(seed);
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  for (let k = 0; k < 7; k++) {
    blotch(ctx, S / 2 + (rand() - 0.5) * 40, S / 2 + (rand() - 0.5) * 40, 22 + rand() * 24, '6,6,8', 0.5);
  }
  return canvas;
}

// ---- Flashlight lens cookie: aperture, falloff and dust on the lens ----
function drawLensCookie() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 8, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#d9d9d9');
  g.addColorStop(0.55, '#c8c8c8');
  g.addColorStop(0.85, '#5a5a5a');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  // lens dust and a faint reflector ring
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  const rand = rng(99);
  for (let k = 0; k < 14; k++) {
    blotch(ctx, rand() * S, rand() * S, 3 + rand() * 6, '0,0,0', 0.5);
  }
  return canvas;
}

// ---- Candle flame sprite (additive) ----
function drawFlame() {
  const W = 64, H = 96;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.6, 2, W / 2, H * 0.55, H * 0.5);
  g.addColorStop(0, 'rgba(255,240,190,1)');
  g.addColorStop(0.35, 'rgba(255,160,60,0.8)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return canvas;
}

// ---- Portrait painting: dark varnish, a face, cracks ----
function drawPortrait(seed) {
  const rand = rng(seed);
  const W = 256, H = 320;
  const { canvas, ctx } = makeCanvas(W, H);
  const bg = ctx.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H / 2, H * 0.8);
  bg.addColorStop(0, '#3a3a2c');
  bg.addColorStop(1, '#0c0b08');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const skin = [`rgb(${150 + rand() * 30},${128 + rand() * 20},${104 + rand() * 16})`, '#7d7266', '#9a8f7e'][Math.floor(rand() * 3)];
  const fw = 70 + rand() * 18;
  const fh = 96 + rand() * 20;
  const cx = W / 2 + (rand() - 0.5) * 16;
  const cy = H * 0.46;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy, fw, fh, 0, 0, Math.PI * 2);
  ctx.fill();
  // shadowed jaw
  blotch(ctx, cx, cy + fh * 0.7, fh * 0.6, '20,14,10', 0.45);
  // eyes: pale irises, too-dark pupils, slightly mismatched
  const eyeY = cy - fh * 0.12;
  const spread = fw * (0.42 + rand() * 0.08);
  for (const side of [-1, 1]) {
    const ex = cx + side * spread;
    const ey = eyeY + (side > 0 ? 3 : 0);
    ctx.fillStyle = '#e8e3d6';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16120e';
    ctx.beginPath();
    ctx.arc(ex + side * 1.5, ey, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a140e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ex - 16, ey - 11 - rand() * 3);
    ctx.lineTo(ex + 16, ey - 12);
    ctx.stroke();
  }
  // nose
  ctx.strokeStyle = 'rgba(30,20,12,0.6)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + 6);
  ctx.lineTo(cx - 4, cy + fh * 0.3);
  ctx.lineTo(cx + 3, cy + fh * 0.32);
  ctx.stroke();
  // mouth: a smile that never reaches the eyes
  const my = cy + fh * 0.5;
  const curve = 6 + rand() * 6;
  ctx.strokeStyle = '#3a1a18';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 24, my);
  ctx.quadraticCurveTo(cx, my + curve, cx + 26, my - 2);
  ctx.stroke();
  // varnish cracks and grime
  for (let k = 0; k < 16; k++) {
    wanderLine(ctx, rand() * W, rand() * H, 10 + rand() * 14, 3, rand, 'rgba(10,8,6,0.55)', 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, W, 6);
  addGrain(ctx, W, H, 12, rand);
  return canvas;
}

// ---- Entity face: pale stretched skin, three expressions ----
// expr: 'neutral' | 'grin' | 'scream'
function drawEntityFace(expr) {
  const W = 256, H = 320;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const skin = ctx.createRadialGradient(cx, cy - 30, 10, cx, cy, 140);
  skin.addColorStop(0, '#b6b2a0');
  skin.addColorStop(0.7, '#7d7a6c');
  skin.addColorStop(1, '#2a2824');
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 92, 130, 0, 0, Math.PI * 2);
  ctx.fill();
  // hollow cheeks
  for (const side of [-1, 1]) {
    blotch(ctx, cx + side * 52, cy + 30, 34, '20,18,16', 0.55);
  }
  // eye sockets
  const eyeY = cy - 38;
  for (const side of [-1, 1]) {
    const ex = cx + side * 40;
    ctx.fillStyle = '#050403';
    ctx.beginPath();
    if (expr === 'scream') {
      ctx.ellipse(ex, eyeY, 26, 22, 0, 0, Math.PI * 2);
    } else if (expr === 'grin') {
      ctx.ellipse(ex, eyeY + 4, 22, 9, side * 0.15, 0, Math.PI * 2);
    } else {
      ctx.ellipse(ex, eyeY, 20, 15, side * 0.12, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // nose: a sliver
  ctx.fillStyle = '#16140f';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx - 9, cy + 22);
  ctx.lineTo(cx + 5, cy + 24);
  ctx.closePath();
  ctx.fill();
  // mouth
  const my = cy + 70;
  if (expr === 'scream') {
    ctx.fillStyle = '#030201';
    ctx.beginPath();
    ctx.ellipse(cx, my, 38, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9c4b0';
    for (let i = -3; i <= 3; i++) {
      ctx.fillRect(cx + i * 9 - 2, my - 42, 4, 12);
      ctx.fillRect(cx + i * 9 - 2, my + 30, 4, 12);
    }
  } else if (expr === 'grin') {
    ctx.fillStyle = '#040303';
    ctx.beginPath();
    ctx.moveTo(cx - 64, my - 10);
    ctx.quadraticCurveTo(cx, my + 58, cx + 64, my - 10);
    ctx.quadraticCurveTo(cx, my + 18, cx - 64, my - 10);
    ctx.fill();
    ctx.fillStyle = '#d9d3bb';
    for (let i = -5; i <= 5; i++) {
      ctx.fillRect(cx + i * 6 - 1.5, my + 2, 3, 12 - Math.abs(i));
    }
  } else {
    ctx.strokeStyle = '#1b1814';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 36, my + 6);
    ctx.quadraticCurveTo(cx, my + 14, cx + 36, my + 4);
    ctx.stroke();
  }
  // gaunt grime and stretch marks
  for (let k = 0; k < 14; k++) {
    wanderLine(ctx, cx + (Math.random() - 0.5) * 120, cy + (Math.random() - 0.5) * 220, 6, 4, Math.random, 'rgba(20,18,14,0.35)', 1.2);
  }
  return canvas;
}

// Cache: all textures are built once and shared.
let cache = null;

export function getTextures() {
  if (cache) return cache;
  const floor = drawPlankFloor(11);
  const ceiling = drawCeiling(23);
  const wallpaper = drawWallpaper(37);
  cache = {
    floor: toTexture(floor.canvas, { color: true }),
    floorBump: toTexture(drawPlankBump(11)),
    ceiling: toTexture(ceiling.canvas, { color: true }),
    wall: toTexture(wallpaper.canvas, { color: true }),
    wallBump: toTexture(drawWallpaperBump(37)),
    wood: toTexture(drawDarkWood(53), { color: true }),
    rug: toTexture(drawRug(61), { color: true }),
    cobweb: toTexture(drawCobweb(71), { color: true, repeat: false }),
    rain: toTexture(drawRain(83), { color: true }),
    vapor: toTexture(drawVapor(91), { color: true, repeat: false }),
    lens: toTexture(drawLensCookie(), { repeat: false }),
    flame: toTexture(drawFlame(), { color: true, repeat: false }),
    portraits: [101, 137, 173, 211].map((s) => toTexture(drawPortrait(s), { color: true, repeat: false })),
    faces: {
      neutral: toTexture(drawEntityFace('neutral'), { color: true, repeat: false }),
      grin: toTexture(drawEntityFace('grin'), { color: true, repeat: false }),
      scream: toTexture(drawEntityFace('scream'), { color: true, repeat: false }),
    },
  };
  return cache;
}

// Canvas versions of the entity face, for the full-screen jumpscare overlay.
export function entityFaceCanvas(expr) {
  return drawEntityFace(expr);
}
