// The house: floor plan, walls, hinged doors, furniture, set dressing, items and light sources.
// Static geometry is merged per material (a handful of draw calls); everything animated stays separate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tex, mulberry32 } from './Textures.js';

export const WALL_H = 3;
export const T = 0.24; // wall thickness
const WH = 0.95; // wainscot height
const AMBIENT_BASE = 0.05;

export const ROOMS = {
  study:   { x0: -10, x1: -4, z0: -8, z1: -2, label: 'the study' },
  bedroom: { x0: -4,  x1: 4,  z0: -8, z1: -2, label: 'the bedroom' },
  kitchen: { x0: 4,   x1: 10, z0: -8, z1: -2, label: 'the kitchen' },
  hallway: { x0: -10, x1: 10, z0: -2, z1: 1,  label: 'the hallway' },
  living:  { x0: -10, x1: -4, z0: 1,  z1: 8,  label: 'the living room' },
  foyer:   { x0: -4,  x1: 4,  z0: 1,  z1: 8,  label: 'the foyer' },
  dining:  { x0: 4,   x1: 10, z0: 1,  z1: 8,  label: 'the dining room' },
};
export function roomAt(x, z) {
  for (const k in ROOMS) { const r = ROOMS[k]; if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return k; }
  return null;
}

const WP = { foyer: 'wp_cream', hallway: 'wp_ochre', living: 'wp_green', dining: 'wp_rose', study: 'wp_burgundy', bedroom: 'wp_slate', kitchen: 'wp_cream' };
const FLOOR = { foyer: 'floorWood0', hallway: 'floorWood1', living: 'floorWood0', dining: 'floorWood1', study: 'floorWood0', bedroom: 'floorWood1', kitchen: 'floorTile' };

// ------------------------------------------------------------------ materials
const MD = {
  floorWood0: { map: () => Tex.woodFloor(0), tile: [2, 2], rough: 0.8, bump: 0.7 },
  floorWood1: { map: () => Tex.woodFloor(1), tile: [2, 2], rough: 0.8, bump: 0.7 },
  floorTile:  { map: () => Tex.tile(), tile: [2, 2], rough: 0.5, bump: 0.5 },
  ceiling:    { map: () => Tex.plaster(), tile: [2, 2], rough: 0.95, bump: 0.5, color: 0xbdb7ab },
  panel:      { map: () => Tex.panel(), tile: [1, 1], rough: 0.7, bump: 0.7 },
  wallTile:   { map: () => Tex.wallTile(), tile: [1, 1], rough: 0.35, bump: 0.5 },
  edge:       { map: () => Tex.plaster(), tile: [2, 2], rough: 1, color: 0x8a847a },
  ext:        { color: 0x06080b, rough: 1 },
  trim:       { map: () => Tex.darkWood(), tile: [1, 1], rough: 0.6, color: 0x9a8f86 },
  wood:       { map: () => Tex.darkWood(), tile: [1, 1], rough: 0.55, bump: 0.5 },
  woodLight:  { map: () => Tex.lightWood(), tile: [1, 1], rough: 0.6, bump: 0.5 },
  sofa:       { map: () => Tex.sofa(), tile: [0.8, 0.8], rough: 0.95 },
  bedding:    { map: () => Tex.bedding(), tile: [0.8, 0.8], rough: 1, color: 0xb8b0a4 },
  blanket:    { map: () => Tex.bedding(), tile: [0.8, 0.8], rough: 1, color: 0x8a5a5a },
  enamel:     { map: () => Tex.enamel(), tile: [0.8, 0.8], rough: 0.4, bump: 0.3 },
  books:      { map: () => Tex.books(), tile: [1, 1], rough: 0.9 },
  rug0:       { map: () => Tex.rug(0), tile: [1, 1], rough: 1 },
  rug1:       { map: () => Tex.rug(1), tile: [1, 1], rough: 1 },
  wax:        { color: 0xcfc3a0, rough: 0.7 },
  brass:      { color: 0xb8923a, metal: 0.55, rough: 0.4, emissive: 0x241804 },
  iron:       { color: 0x1a1b1e, metal: 0.4, rough: 0.5 },
  black:      { color: 0x020202, rough: 1 },
  cloth:      { color: 0x2d2020, rough: 1 },
  curtain:    { map: () => Tex.bedding(), tile: [0.8, 0.8], rough: 1, color: 0x5a2428 },
  glass:      { color: 0x1c2a3a, rough: 0.5, opacity: 0.16 },
  cabglass:   { color: 0x0b141c, rough: 0.1, opacity: 0.5 },
  mirror:     { map: () => Tex.mirror(), tile: [1, 1], rough: 0.2, metal: 0.4 },
  plant:      { color: 0x2b2412, rough: 1 },
  skin:       { color: 0x9a8e82, rough: 0.7 },
  dress:      { color: 0x6b5a5a, rough: 0.9 },
  web:        { map: () => Tex.cobweb(), color: 0xd8d8d0, rough: 1, transparent: true, double: true },
};
for (const k of ['green', 'burgundy', 'ochre', 'slate', 'cream', 'rose']) {
  MD['wp_' + k] = { map: () => Tex.wallpaper(k), tile: [1.5, 1.5], rough: 0.92, bump: 0.8 };
}

const matCache = new Map();
function getMat(key) {
  if (matCache.has(key)) return matCache.get(key);
  let m;
  if (key.startsWith('decal:')) {
    const [, kind, seed] = key.split(':');
    m = new THREE.MeshStandardMaterial({ map: Tex.decal(kind, +seed), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  } else {
    const d = MD[key];
    if (!d) throw new Error('unknown material ' + key);
    m = new THREE.MeshStandardMaterial({
      map: d.map ? d.map() : null, color: d.color ?? 0xffffff, roughness: d.rough ?? 0.9, metalness: d.metal ?? 0,
      emissive: d.emissive ?? 0x000000, transparent: !!(d.opacity || d.transparent), opacity: d.opacity ?? 1,
      side: d.double ? THREE.DoubleSide : THREE.FrontSide, depthWrite: !(d.opacity || d.transparent),
    });
    if (d.bump) { m.bumpMap = m.map; m.bumpScale = d.bump; }
  }
  matCache.set(key, m);
  return m;
}
export function disposeSharedMaterials() { /* shared across restarts on purpose */ }

// ------------------------------------------------------------------ geometry builder
function projectUV(geo, tile) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / tile[0], v / tile[1]);
  }
  uv.needsUpdate = true;
}

class Builder {
  constructor() { this.buckets = new Map(); }
  add(geo, key, cast = false, keepUV = false) {
    if (!keepUV) projectUV(geo, (MD[key] && MD[key].tile) || [1, 1]);
    const k = key + (cast ? '|c' : '|n');
    let b = this.buckets.get(k);
    if (!b) { b = { key, cast, geos: [] }; this.buckets.set(k, b); }
    b.geos.push(geo);
  }
  flush(group) {
    const meshes = [];
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, getMat(b.key));
      mesh.castShadow = b.cast; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      if (b.key.startsWith('decal:') || b.key === 'web') mesh.renderOrder = 1;
      group.add(mesh); meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

// smooth pseudo-noise for flicker
const flick = (ph) => (t) => 0.8 + 0.1 * Math.sin(t * 13 + ph) + 0.07 * Math.sin(t * 29.7 + ph * 2.1) + 0.05 * Math.sin(t * 5.3 + ph * 0.7) - Math.max(0, Math.sin(t * 0.43 + ph * 3) - 0.93) * 6;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------ Door
class Door {
  constructor(house, o) {
    this.house = house;
    this.id = o.id; this.cx = o.cx; this.cz = o.cz; this.width = o.width; this.height = o.height;
    this.locked = !!o.locked;
    this.openAngle = o.openAngle ?? 1.75;
    const hinge = o.hinge ?? -1, toward = o.toward ?? -1; // hinge -1 = left (min x); toward = swing -z / +z
    this.sign = hinge === -1 ? (toward < 0 ? 1 : -1) : (toward < 0 ? -1 : 1);
    this.angle = 0; this.target = 0; this.speed = 2.2; this.slamming = false;
    const hx = o.cx + hinge * (o.width / 2);
    this.pivot = new THREE.Group(); this.pivot.position.set(hx, 0, o.cz);
    const w = o.width - 0.03, h = o.height - 0.02;
    const edge = getMat('wood');
    const face = new THREE.MeshStandardMaterial({ map: o.front ? Tex.doorFront() : Tex.door(), roughness: 0.65, bumpMap: o.front ? Tex.doorFront() : Tex.door(), bumpScale: 0.6 });
    this.leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), [edge, edge, edge, edge, face, face]);
    this.leaf.position.set((hinge === -1 ? 1 : -1) * (w / 2 + 0.015), h / 2 + 0.01, 0);
    this.leaf.castShadow = true; this.leaf.receiveShadow = true;
    this.pivot.add(this.leaf);
    const knobX = (hinge === -1 ? 1 : -1) * (w - 0.1);
    for (const zz of [0.06, -0.06]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), getMat('brass'));
      knob.position.set(knobX, 1.0, zz); this.pivot.add(knob);
    }
    if (o.front) { // iron lock plate
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.02), getMat('iron')); plate.position.set(knobX + 0.02, 1.15, 0.05); this.pivot.add(plate);
      const plate2 = plate.clone(); plate2.position.z = -0.05; this.pivot.add(plate2);
    }
    this.leaf.userData.interact = { type: o.front ? 'frontdoor' : 'door', door: this };
    house.group.add(this.pivot);
    house.interactMeshes.push(this.leaf);
    this.collider = { minX: o.cx - o.width / 2, maxX: o.cx + o.width / 2, minZ: o.cz - 0.1, maxZ: o.cz + 0.1, tag: 'door', active: true, light: true, door: this };
    house.colliders.push(this.collider);
    this.pos = new THREE.Vector3(o.cx, 1.2, o.cz);
  }
  get isOpen() { return Math.abs(this.target) > 0.1; }
  open(quiet) {
    if (this.locked) return;
    this.target = this.openAngle * this.sign; this.speed = 2.2; this.slamming = false;
    if (!quiet) this.house.audio?.creak(this.pos, true);
  }
  close(quiet) {
    this.target = 0; this.speed = 2.2; this.slamming = false;
    if (!quiet) this.house.audio?.creak(this.pos, false);
  }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  slam() { this.target = 0; this.speed = 10; this.slamming = true; if (Math.abs(this.angle) < 0.05) this._slammed(); }
  _slammed() { this.slamming = false; this.house.audio?.slam(this.pos); this.house.onSlam?.(this); }
  update(dt) {
    const diff = this.target - this.angle;
    if (Math.abs(diff) > 0.0008) {
      const v = THREE.MathUtils.clamp(diff * (this.slamming ? 8 : 3.2), -this.speed, this.speed);
      this.angle += v * dt;
      if (Math.abs(this.target - this.angle) < 0.004) this.angle = this.target;
      this.pivot.rotation.y = this.angle;
      if (this.slamming && Math.abs(this.angle) < 0.03) { this.angle = 0; this.pivot.rotation.y = 0; this._slammed(); }
    }
    this.collider.active = Math.abs(this.angle) < 0.35;
  }
}

// ------------------------------------------------------------------ House
export class House {
  constructor({ audio = null, seed = Math.random() } = {}) {
    this.audio = audio;
    this.rng = mulberry32(Math.floor(seed * 1e9));
    this.group = new THREE.Group();
    this.colliders = [];
    this.interactMeshes = [];
    this.doors = [];
    this.sources = [];
    this.flames = [];
    this.glints = [];
    this.items = [];
    this.anim = [];
    this.windowSpots = [];
    this.B = new Builder();
    this.lightning = 0; this.blackout = false; this.flickerUntil = 0; this.time = 0;
    this.onSlam = null;
    this.playerStart = new THREE.Vector3(0, 0, 6.5);
    this.studyDoorway = new THREE.Vector3(-7, 0, -2.1);

    this.buildShell();
    this.buildFoyer();
    this.buildHallway();
    this.buildLiving();
    this.buildDining();
    this.buildKitchen();
    this.buildStudy();
    this.buildBedroom();
    this.buildDecals();
    this.buildCobwebs();
    this.staticMeshes = this.B.flush(this.group);
    this.buildOutside();
    this.buildItems();

    this.ambient = new THREE.AmbientLight(0x5a74a8, AMBIENT_BASE);
    this.group.add(this.ambient);
    this.pool = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffffff, 0, 8, 2); l.castShadow = false; this.group.add(l); this.pool.push(l); }
  }

  // ---------------------------------------------------------------- primitives
  addCol(x, z, w, d, rot, tag = 'furn', light = false) {
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const ex = (w / 2) * c + (d / 2) * s, ez = (w / 2) * s + (d / 2) * c;
    const col = { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, tag, active: true, light };
    this.colliders.push(col);
    return col;
  }
  // box by plan centre (x,z) and base height y0
  fb(x, y0, z, w, h, d, mat, o = {}) {
    const { rot = 0, cast = true, col = true, euler = null, light = false, tag = 'furn' } = o;
    const g = new THREE.BoxGeometry(w, h, d);
    if (euler) g.applyQuaternion(new THREE.Quaternion().setFromEuler(euler)); else if (rot) g.rotateY(rot);
    g.translate(x, y0 + h / 2, z);
    this.B.add(g, mat, cast);
    if (col && !euler) return this.addCol(x, z, w, d, rot, tag, light);
    return null;
  }
  fcyl(x, y0, z, rt, rb, h, mat, o = {}) {
    const { seg = 12, cast = true, col = false } = o;
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y0 + h / 2, z);
    this.B.add(g, mat, cast);
    if (col) this.addCol(x, z, Math.max(rt, rb) * 2, Math.max(rt, rb) * 2, 0);
  }
  fsph(x, y, z, r, mat, o = {}) {
    const g = new THREE.SphereGeometry(r, o.seg || 12, o.seg ? o.seg - 4 : 8);
    if (o.sy) g.scale(1, o.sy, 1);
    g.translate(x, y, z);
    this.B.add(g, mat, o.cast ?? true);
  }
  // a part positioned relative to an item's centre/rotation
  part(cx, cz, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return (lx, y0, lz, w, h, d, mat, cast = true) => this.fb(cx + lx * c + lz * s, y0, cz - lx * s + lz * c, w, h, d, mat, { rot, cast, col: false });
  }
  quadH(x, y, z, w, d, mat, up = true) { // horizontal plane
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate(x, y, z);
    this.B.add(g, mat, false);
  }
  rug(cx, cz, w, d, mat, repU = 1, repV = 1) {
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(cx, 0.012, cz);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repU, uv.getY(i) * repV);
    this.B.add(g, mat, false, true);
  }
  decal(kind, seed, x, y, z, face, size, rotZ = 0, aspect = 1) {
    const g = new THREE.PlaneGeometry(size, size * aspect);
    if (rotZ) g.rotateZ(rotZ);
    const rotY = { pz: 0, nz: Math.PI, px: Math.PI / 2, nx: -Math.PI / 2 }[face];
    if (face === 'down') g.rotateX(Math.PI / 2); else if (face === 'up') g.rotateX(-Math.PI / 2); else g.rotateY(rotY);
    g.translate(x, y, z);
    this.B.add(g, `decal:${kind}:${seed}`, false, true);
  }
  portrait(x, y, z, face, seed, w = 0.62) {
    const h = w * 1.25;
    const rotY = { pz: 0, nz: Math.PI, px: Math.PI / 2, nx: -Math.PI / 2 }[face];
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: Tex.portrait(seed), roughness: 0.6, bumpMap: Tex.portrait(seed), bumpScale: 0.4 }));
    art.position.z = 0.025; g.add(art);
    const fm = getMat('woodLight'); const ft = 0.07;
    const mk = (bw, bh, px, py) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), fm); m.position.set(px, py, 0.03); m.castShadow = false; g.add(m); };
    mk(w + ft * 2, ft, 0, h / 2 + ft / 2); mk(w + ft * 2, ft, 0, -h / 2 - ft / 2); mk(ft, h, -w / 2 - ft / 2, 0); mk(ft, h, w / 2 + ft / 2, 0);
    this.group.add(g);
    return g;
  }

  // ---------------------------------------------------------------- sources & dressing
  addSource(o) {
    const s = { pos: new THREE.Vector3(o.x, o.y, o.z), color: new THREE.Color(o.color), intensity: o.intensity, dist: o.dist, kind: o.kind, room: roomAt(o.x, o.z), on: true, flicker: o.flicker || null, gain: o.gain || 0, mult: 1 };
    this.sources.push(s);
    return s;
  }
  candle(x, y0, z, { h = 0.12, lit = true, intensity = 1.1 } = {}) {
    this.fcyl(x, y0, z, 0.016, 0.018, h, 'wax', { seg: 8, cast: false });
    if (!lit) return;
    const mat = new THREE.SpriteMaterial({ map: Tex.flame(), color: new THREE.Color(3.2, 1.7, 0.55), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(mat); sp.scale.set(0.055, 0.11, 1); sp.position.set(x, y0 + h + 0.05, z);
    this.group.add(sp);
    const ph = this.rng() * 40;
    const src = this.addSource({ x, y: y0 + h + 0.1, z, color: 0xff9a45, intensity, dist: 6.5, kind: 'candle', flicker: flick(ph) });
    this.flames.push({ sp, src, ph, base: new THREE.Vector3(x, y0 + h + 0.05, z) });
  }
  bulb(x, y, z, intensity = 2.6) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, WALL_H - y, 4), getMat('black')); cord.position.set(x, (WALL_H + y) / 2, z); this.group.add(cord);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.07, 8), getMat('iron')); sock.position.set(x, y + 0.06, z); this.group.add(sock);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.1, 0.9), toneMapped: true }));
    glass.position.set(x, y, z); this.group.add(glass);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.glow(), color: new THREE.Color(1.6, 0.9, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3 }));
    halo.scale.set(0.9, 0.9, 1); halo.position.set(x, y, z); this.group.add(halo);
    const ph = this.rng() * 50;
    const src = this.addSource({ x, y: y - 0.1, z, color: 0xffa95c, intensity, dist: 9, kind: 'bulb', flicker: null });
    src.bulb = { glass, halo, ph };
  }
  web(x, z, rot, size = 0.9, y = WALL_H - 0.03) {
    const g = new THREE.PlaneGeometry(size, size); g.translate(size / 2, size / 2, 0); g.rotateX(Math.PI / 2); g.rotateY(rot); g.translate(x, y, z);
    this.B.add(g, 'web', false, true);
  }

  // ---------------------------------------------------------------- walls
  wallLine(axis, fixed, a0, a1, openings = []) {
    const ops = openings.slice().sort((p, q) => p.c - q.c);
    let cur = a0;
    for (const op of ops) {
      const o0 = op.c - op.w / 2, o1 = op.c + op.w / 2;
      if (o0 > cur + 0.001) this.solidSeg(axis, fixed, cur, o0);
      this.openingSeg(axis, fixed, op, o0, o1);
      cur = o1;
    }
    if (cur < a1 - 0.001) this.solidSeg(axis, fixed, cur, a1);
  }
  wbox(axis, fixed, s0, s1, y0, y1, faces, cast = true) {
    // faces: {pos, neg, top, bot, end0, end1} -> material keys (or null)
    const w = axis === 'x' ? s1 - s0 : T, d = axis === 'x' ? T : s1 - s0;
    const cx = axis === 'x' ? (s0 + s1) / 2 : fixed, cz = axis === 'x' ? fixed : (s0 + s1) / 2;
    const h = y1 - y0, cy = (y0 + y1) / 2;
    const quad = (pw, ph, mat, rx, ry, tx, ty, tz) => {
      if (!mat) return;
      const g = new THREE.PlaneGeometry(pw, ph);
      if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(tx, ty, tz);
      this.B.add(g, mat, cast);
    };
    const M = { px: null, nx: null, pz: null, nz: null };
    if (axis === 'x') { M.pz = faces.pos; M.nz = faces.neg; M.nx = faces.end0; M.px = faces.end1; }
    else { M.px = faces.pos; M.nx = faces.neg; M.nz = faces.end0; M.pz = faces.end1; }
    quad(w, h, M.pz, 0, 0, cx, cy, cz + d / 2);
    quad(w, h, M.nz, 0, Math.PI, cx, cy, cz - d / 2);
    quad(d, h, M.px, 0, Math.PI / 2, cx + w / 2, cy, cz);
    quad(d, h, M.nx, 0, -Math.PI / 2, cx - w / 2, cy, cz);
    quad(w, d, faces.top, -Math.PI / 2, 0, cx, y1, cz);
    quad(w, d, faces.bot, Math.PI / 2, 0, cx, y0, cz);
  }
  sideRooms(axis, fixed, s0, s1) {
    const m = (s0 + s1) / 2;
    return axis === 'x' ? [roomAt(m, fixed + 0.5), roomAt(m, fixed - 0.5)] : [roomAt(fixed + 0.5, m), roomAt(fixed - 0.5, m)];
  }
  wallSlab(axis, fixed, s0, s1, y0, y1) {
    const [rp, rn] = this.sideRooms(axis, fixed, s0, s1);
    const lower = (r) => (r ? (r === 'kitchen' ? 'wallTile' : 'panel') : 'ext');
    const upper = (r) => (r ? WP[r] : 'ext');
    const edge = 'edge';
    if (y0 < WH) this.wbox(axis, fixed, s0, s1, y0, Math.min(y1, WH), { pos: lower(rp), neg: lower(rn), top: y1 <= WH ? edge : null, bot: y0 > 0 ? edge : null, end0: edge, end1: edge });
    if (y1 > WH) this.wbox(axis, fixed, s0, s1, Math.max(y0, WH), y1, { pos: upper(rp), neg: upper(rn), top: edge, bot: y0 > WH ? edge : null, end0: edge, end1: edge });
  }
  solidSeg(axis, fixed, s0, s1) {
    this.wallSlab(axis, fixed, s0, s1, 0, WALL_H);
    this.trimStrip(axis, fixed, s0, s1, 0, 0.15, 0.05); // baseboard
    this.trimStrip(axis, fixed, s0, s1, WH - 0.03, 0.06, 0.04); // chair rail
    this.wallCol(axis, fixed, s0, s1);
  }
  trimStrip(axis, fixed, s0, s1, y0, h, out) {
    const w = axis === 'x' ? s1 - s0 : T + out * 2, d = axis === 'x' ? T + out * 2 : s1 - s0;
    const cx = axis === 'x' ? (s0 + s1) / 2 : fixed, cz = axis === 'x' ? fixed : (s0 + s1) / 2;
    const g = new THREE.BoxGeometry(w, h, d); g.translate(cx, y0 + h / 2, cz);
    this.B.add(g, 'trim', false);
  }
  wallCol(axis, fixed, s0, s1, light = true) {
    if (axis === 'x') this.colliders.push({ minX: s0, maxX: s1, minZ: fixed - T / 2, maxZ: fixed + T / 2, tag: 'wall', active: true, light });
    else this.colliders.push({ minX: fixed - T / 2, maxX: fixed + T / 2, minZ: s0, maxZ: s1, tag: 'wall', active: true, light });
  }
  frameBox(axis, fixed, s0, s1, y0, y1) {
    const w = axis === 'x' ? s1 - s0 : T + 0.08, d = axis === 'x' ? T + 0.08 : s1 - s0;
    const cx = axis === 'x' ? (s0 + s1) / 2 : fixed, cz = axis === 'x' ? fixed : (s0 + s1) / 2;
    const g = new THREE.BoxGeometry(w, y1 - y0, d); g.translate(cx, (y0 + y1) / 2, cz); this.B.add(g, 'trim', true);
  }
  openingSeg(axis, fixed, op, o0, o1) {
    const type = op.type || 'door';
    if (type === 'door' || type === 'arch') {
      const h = op.h || (type === 'arch' ? 2.5 : 2.2);
      this.wallSlab(axis, fixed, o0, o1, h, WALL_H);
      this.frameBox(axis, fixed, o0 - 0.07, o0, 0, h + 0.07); this.frameBox(axis, fixed, o1, o1 + 0.07, 0, h + 0.07);
      this.frameBox(axis, fixed, o0 - 0.07, o1 + 0.07, h, h + 0.07);
      if (type === 'arch') { // chunky corner brackets
        for (const [sx, sd] of [[o0, 1], [o1, -1]]) this.frameBox(axis, fixed, sx + (sd > 0 ? 0 : -0.22), sx + (sd > 0 ? 0.22 : 0), h - 0.22, h);
      }
    } else if (type === 'window') {
      const sill = op.sill ?? 1.0, top = op.top ?? 2.35;
      this.wallSlab(axis, fixed, o0, o1, 0, sill);
      this.trimStrip(axis, fixed, o0, o1, 0, 0.15, 0.05);
      this.trimStrip(axis, fixed, o0, o1, WH - 0.03, 0.06, 0.04);
      this.wallSlab(axis, fixed, o0, o1, top, WALL_H);
      this.wallCol(axis, fixed, o0, o1, true);
      this.windowDressing(axis, fixed, op, o0, o1, sill, top);
    }
  }
  windowDressing(axis, fixed, op, o0, o1, sill, top) {
    const c = op.c, w = o1 - o0, h = top - sill, cy = (sill + top) / 2;
    // frame + muntins
    this.frameBox(axis, fixed, o0 - 0.05, o0 + 0.03, sill - 0.05, top + 0.05); this.frameBox(axis, fixed, o1 - 0.03, o1 + 0.05, sill - 0.05, top + 0.05);
    this.frameBox(axis, fixed, o0, o1, top - 0.03, top + 0.05); this.frameBox(axis, fixed, o0, o1, sill - 0.06, sill + 0.02);
    const mun = (s0, s1, y0, y1) => { const bw = axis === 'x' ? s1 - s0 : 0.05, bd = axis === 'x' ? 0.05 : s1 - s0; const cx = axis === 'x' ? (s0 + s1) / 2 : fixed, cz = axis === 'x' ? fixed : (s0 + s1) / 2; const g = new THREE.BoxGeometry(bw, y1 - y0, bd); g.translate(cx, (y0 + y1) / 2, cz); this.B.add(g, 'trim', true); };
    mun(c - 0.02, c + 0.02, sill, top); mun(o0, o1, cy - 0.02, cy + 0.02);
    // dirty glass
    const gg = new THREE.PlaneGeometry(w, h); if (axis === 'z') gg.rotateY(Math.PI / 2); gg.translate(axis === 'x' ? c : fixed, cy, axis === 'x' ? fixed : c);
    this.B.add(gg, 'glass', false, true);
    // sill shelf
    const sw = axis === 'x' ? w + 0.1 : 0.3, sd = axis === 'x' ? 0.3 : w + 0.1;
    const sg = new THREE.BoxGeometry(sw, 0.04, sd); sg.translate(axis === 'x' ? c : fixed, sill - 0.02, axis === 'x' ? fixed : c); this.B.add(sg, 'trim', true);
    // boards
    if (op.boards) {
      const n = 3, rr = this.rng;
      for (let i = 0; i < n; i++) {
        const along = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        const len = w + 0.5, g = new THREE.BoxGeometry(axis === 'x' ? len : 0.05, 0.16, axis === 'x' ? 0.05 : len);
        const ang = (rr() - 0.5) * 0.9;
        const q = new THREE.Quaternion().setFromAxisAngle(axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), axis === 'x' ? ang : -ang);
        g.applyQuaternion(q);
        const off = (i - 1) * 0.33 + (rr() - 0.5) * 0.06;
        const inw = (fixed < 0 ? 1 : -1) * 0.14;
        g.translate(axis === 'x' ? c : fixed + inw, cy + off, axis === 'x' ? fixed + inw : c);
        this.B.add(g, 'wood', true);
      }
    }
    // curtains (tattered, hang beside the opening)
    if (op.curtains) {
      const side = (axis === 'x' ? (fixed < 0 ? 1 : -1) : (fixed < 0 ? 1 : -1)) * 0.17;
      for (const sgn of [-1, 1]) {
        const cw = 0.4, ch = 2.1 - this.rng() * 0.3;
        const px = axis === 'x' ? c + sgn * (w / 2 + 0.12) : fixed + side, pz = axis === 'x' ? fixed + side : c + sgn * (w / 2 + 0.12);
        this.fb(px, 3.0 - 0.15 - ch, pz, axis === 'x' ? cw : 0.06, ch, axis === 'x' ? 0.06 : cw, 'curtain', { col: false, cast: false });
      }
    }
    // moonlight source just inside the window
    // (placed OUTSIDE the glass so it only lights surfaces that face the window, and never hot-spots the frame)
    const inward = fixed < 0 ? 1 : -1;
    const ox = axis === 'x' ? c : fixed - inward * 0.7, oz = axis === 'x' ? fixed - inward * 0.7 : c;
    const ix = axis === 'x' ? c : fixed + inward * 0.6, iz = axis === 'x' ? fixed + inward * 0.6 : c;
    const src = this.addSource({ x: ox, y: cy + 0.15, z: oz, color: 0x6f8fd0, intensity: op.moon ?? 3.2, dist: 8, kind: 'moon', gain: 48 });
    src.room = roomAt(ix, iz);
    this.windowSpots.push(new THREE.Vector3(ix, cy, iz));
  }

  // ---------------------------------------------------------------- shell
  buildShell() {
    // floors + ceilings
    for (const k in ROOMS) {
      const r = ROOMS[k], w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      this.quadH(cx, 0, cz, w, d, FLOOR[k], true);
      this.quadH(cx, WALL_H, cz, w, d, 'ceiling', false);
    }
    const hx = T / 2;
    // exterior (windows everywhere, some boarded)
    this.wallLine('x', -8, -10 + hx, 10 - hx, [
      { c: -7, w: 1.3, type: 'window', curtains: true },
      { c: -1.8, w: 1.3, type: 'window', curtains: true },
      { c: 7.3, w: 1.2, type: 'window', sill: 1.1 },
    ]);
    this.wallLine('x', 8, -10 + hx, 10 - hx, [
      { c: -7, w: 1.3, type: 'window', boards: true },
      { c: -2.45, w: 0.55, type: 'window', sill: 0.9, top: 2.5 },
      { c: 0, w: 1.3, type: 'door', h: 2.4 },
      { c: 2.45, w: 0.55, type: 'window', sill: 0.9, top: 2.5 },
      { c: 7, w: 1.3, type: 'window', boards: true, curtains: true },
    ]);
    this.wallLine('z', -10, -8 - hx, 8 + hx, [
      { c: -5, w: 1.2, type: 'window' },
      { c: -0.5, w: 0.9, type: 'window', moon: 4 },
      { c: 4.5, w: 1.4, type: 'window', curtains: true },
    ]);
    this.wallLine('z', 10, -8 - hx, 8 + hx, [
      { c: -4.6, w: 1.2, type: 'window' },
      { c: -0.5, w: 0.9, type: 'window', moon: 4 },
      { c: 5.3, w: 1.4, type: 'window', boards: true },
    ]);
    // interior
    this.wallLine('x', -2, -10 + hx, 10 - hx, [
      { c: -7, w: 1.1, type: 'door' }, { c: 0, w: 1.1, type: 'door' }, { c: 7, w: 1.8, type: 'arch' },
    ]);
    this.wallLine('x', 1, -10 + hx, 10 - hx, [
      { c: -7, w: 1.8, type: 'arch' }, { c: 0, w: 2.6, type: 'arch', h: 2.6 }, { c: 7, w: 1.8, type: 'arch' },
    ]);
    this.wallLine('z', -4, -8 + hx, -2 - hx, []);
    this.wallLine('z', 4, -8 + hx, -2 - hx, []);
    this.wallLine('z', -4, 1 + hx, 8 - hx, [{ c: 5, w: 1.8, type: 'arch' }]);
    this.wallLine('z', 4, 1 + hx, 8 - hx, [{ c: 5, w: 1.8, type: 'arch' }]);

    // doors
    this.studyDoor = new Door(this, { id: 'study', cx: -7, cz: -2, width: 1.1, height: 2.2, hinge: -1, toward: -1 });
    this.bedroomDoor = new Door(this, { id: 'bedroom', cx: 0, cz: -2, width: 1.1, height: 2.2, hinge: 1, toward: -1 });
    this.frontDoor = new Door(this, { id: 'front', cx: 0, cz: 8, width: 1.3, height: 2.4, hinge: -1, toward: 1, locked: true, front: true, openAngle: 1.75 });
    this.doors.push(this.studyDoor, this.bedroomDoor, this.frontDoor);

    // ceiling beams in hallway / dining
    for (let x = -8; x <= 8; x += 4) this.fb(x, WALL_H - 0.26, -0.5, 0.22, 0.26, 2.76, 'trim', { col: false, cast: false });
    for (let z = 2.5; z <= 7; z += 2.25) this.fb(7, WALL_H - 0.24, z, 5.76, 0.24, 0.2, 'trim', { col: false, cast: false });
  }

  // ---------------------------------------------------------------- foyer
  buildFoyer() {
    this.rug(0, 4.6, 3.2, 4.6, 'rug0');
    this.bulb(0, 2.35, 4.4, 3.2);
    // console table + note + candle
    this.table(-2.9, 7.55, 1.5, 0.45, 0.8, { collide: true });
    this.candle(-3.35, 0.8, 7.5, { h: 0.1, intensity: 1.3 });
    this.fcyl(-2.45, 0.8, 7.55, 0.07, 0.05, 0.22, 'woodLight', { seg: 8, cast: false }); // vase
    this.noteSpot = new THREE.Vector3(-2.85, 0.805, 7.5);
    // grandfather clock
    this.fb(3.2, 0, 7.62, 0.55, 2.25, 0.42, 'wood', { light: true });
    this.fb(3.2, 1.5, 7.4, 0.36, 0.5, 0.02, 'black', { col: false, cast: false });
    this.fb(3.2, 0.3, 7.4, 0.26, 0.9, 0.02, 'black', { col: false, cast: false });
    // coat rack
    this.fcyl(3.35, 0, 2.0, 0.025, 0.04, 1.85, 'iron', { seg: 6, col: true });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; this.fb(3.35 + Math.cos(a) * 0.12, 1.65, 2.0 + Math.sin(a) * 0.12, 0.2, 0.02, 0.02, 'iron', { rot: -a, col: false, cast: false }); }
    this.fb(3.5, 0.9, 2.05, 0.1, 0.85, 0.3, 'cloth', { col: false }); // hanging coat
    this.fb(3.2, 1.0, 1.85, 0.08, 0.7, 0.26, 'cloth', { col: false });
    // dead plant
    this.fcyl(-3.4, 0, 1.75, 0.16, 0.12, 0.35, 'woodLight', { seg: 8 , col: true});
    for (let i = 0; i < 5; i++) this.fb(-3.4 + (this.rng() - 0.5) * 0.2, 0.35, 1.75 + (this.rng() - 0.5) * 0.2, 0.02, 0.5 + this.rng() * 0.3, 0.02, 'plant', { col: false, euler: new THREE.Euler((this.rng() - 0.5) * 0.8, 0, (this.rng() - 0.5) * 0.8) });
    // mirror on east wall
    this.fb(3.8, 1.0, 2.8, 0.05, 1.3, 0.9, 'mirror', { col: false, cast: false });
    this.fb(3.83, 0.95, 2.8, 0.03, 1.4, 1.0, 'trim', { col: false, cast: false });
    this.portrait(-3.86, 1.75, 3.0, 'px', 1);
    this.portrait(-3.86, 1.75, 6.6, 'px', 3);
    this.portrait(3.86, 1.75, 6.0, 'nx', 4);
  }

  table(x, z, w, d, h, { mat = 'wood', rot = 0, collide = true } = {}) {
    const p = this.part(x, z, rot);
    p(0, h - 0.05, 0, w, 0.05, d, mat);
    const lx = w / 2 - 0.06, lz = d / 2 - 0.06;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(sx * lx, 0, sz * lz, 0.07, h - 0.05, 0.07, mat, false);
    if (collide) this.addCol(x, z, w, d, rot, 'furn', false);
  }
  chair(x, z, rot, { tipped = false } = {}) {
    if (tipped) {
      this.fb(x, 0.2, z, 0.45, 0.05, 0.45, 'wood', { euler: new THREE.Euler(Math.PI / 2 - 0.1, rot, 0), col: false });
      this.fb(x, 0.0, z + 0.2, 0.45, 0.5, 0.05, 'wood', { rot, col: false });
      this.addCol(x, z, 0.6, 0.6, 0, 'furn');
      return;
    }
    const p = this.part(x, z, rot);
    p(0, 0.43, 0, 0.44, 0.05, 0.44, 'wood');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(sx * 0.19, 0, sz * 0.19, 0.04, 0.43, 0.04, 'wood', false);
    p(0, 0.48, -0.2, 0.44, 0.5, 0.04, 'wood');
    this.addCol(x, z, 0.46, 0.46, rot, 'furn');
  }

  // ---------------------------------------------------------------- hallway
  buildHallway() {
    const L = 17.6;
    this.rug(0, -0.5, L, 1.2, 'rug1', L / 1.2, 1);
    this.bulb(-5.2, 2.5, -0.5, 2.8);
    this.bulb(5.2, 2.5, -0.5, 2.8);
    // console tables
    this.table(-3.7, 0.66, 1.4, 0.4, 0.8, {});
    this.fcyl(-4.2, 0.8, 0.66, 0.07, 0.05, 0.24, 'woodLight', { seg: 8, cast: false });
    this.table(3.7, 0.66, 1.4, 0.4, 0.8, {});
    this.fb(3.7, 0.8, 0.66, 0.5, 0.18, 0.2, 'black', { col: false, cast: false }); // dead radio
    // bench near west end
    this.fb(-9.0, 0, -0.9, 0.5, 0.45, 1.2, 'woodLight', { light: false });
    this.fb(-9.0, 0.45, -0.9, 0.5, 0.06, 1.2, 'sofa', { col: false });
    // portraits along the hall (north wall faces +z)
    [[-5.4, 11], [-3.8, 12], [-2.2, 13], [2.2, 14], [3.9, 15], [5.5, 16]].forEach(([x, s]) => this.portrait(x, 1.75, -1.86, 'pz', s, 0.55));
    // south wall faces -z, above tables
    this.portrait(-3.7, 1.8, 0.86, 'nz', 17, 0.7);
    this.portrait(3.7, 1.8, 0.86, 'nz', 18, 0.7);
    // wall sconces (dead)
    [-8.2, 8.2].forEach((x) => { this.fb(x, 1.8, -1.82, 0.08, 0.25, 0.08, 'iron', { col: false, cast: false }); this.fb(x, 2.0, -1.78, 0.14, 0.04, 0.14, 'iron', { col: false, cast: false }); });
    // overturned chair near the study door
    this.chair(-4.9, -1.1, 0.4, { tipped: true });
  }

  // ---------------------------------------------------------------- living room
  buildLiving() {
    this.rug(-7.1, 4.5, 3.4, 2.8, 'rug0');
    // fireplace
    this.fb(-9.55, 0, 3.5, 0.66, WALL_H, 2.2, 'edge', { light: true });
    this.fb(-9.2, 0.0, 3.5, 0.12, 0.98, 1.1, 'black', { col: false, cast: false });
    this.fb(-9.12, 1.0, 3.5, 0.22, 0.09, 1.7, 'wood', { col: false });
    this.fb(-9.2, 0, 2.78, 0.1, 1.0, 0.12, 'trim', { col: false }); this.fb(-9.2, 0, 4.22, 0.1, 1.0, 0.12, 'trim', { col: false });
    this.candle(-9.1, 1.09, 3.0, { h: 0.16, intensity: 1.2 });
    this.candle(-9.1, 1.09, 3.95, { h: 0.1, lit: false });
    this.portrait(-9.2, 1.95, 3.5, 'px', 2, 0.8);
    // sofa facing the fireplace
    this.sofa(-5.6, 3.5, -Math.PI / 2);
    // coffee table + battery
    this.table(-7.6, 3.5, 0.65, 1.1, 0.45, { collide: true });
    this.batterySpotLiving = new THREE.Vector3(-7.6, 0.45 + 0.035, 3.3);
    this.fb(-7.6, 0.45, 3.9, 0.2, 0.03, 0.28, 'bedding', { col: false, rot: 0.3, cast: false }); // dusty book/paper
    // armchair
    this.armchair(-8.5, 6.1, 0.55);
    // bookcase on north wall
    this.bookcase(-9.0, 1.12 + 0.2, 1.5, 2.4, 'z+');
    // piano on south wall
    const pp = this.part(-5.3, 7.55, Math.PI);
    pp(0, 0, 0, 1.55, 1.15, 0.62, 'woodLight'); pp(0, 0.75, 0.38, 1.45, 0.05, 0.22, 'bedding', false);
    for (let i = 0; i < 20; i++) pp(-0.66 + i * 0.07, 0.8, 0.40, 0.035, 0.02, 0.2, i % 7 === 2 || i % 7 === 6 ? 'black' : 'bedding', false);
    this.addCol(-5.3, 7.55, 1.55, 0.62, 0, 'furn');
    this.chair(-5.3, 6.7, 0);
    this.candle(-4.7, 1.15, 7.55, { h: 0.1, intensity: 0.9 });
    // dead plant + junk
    this.fcyl(-9.4, 0, 7.4, 0.2, 0.15, 0.45, 'woodLight', { seg: 8, col: true });
    this.fb(-8.2, 0, 7.2, 0.5, 0.35, 0.4, 'woodLight', { rot: 0.4 }); // crate
    this.portrait(-4.14, 1.75, 2.2, 'px', 5, 0.6); // wall between living/foyer faces +x... (placed on the living side: normal -x)
  }
  sofa(x, z, rot) {
    const p = this.part(x, z, rot);
    p(0, 0.12, 0, 2.1, 0.3, 0.9, 'sofa'); p(0, 0.42, -0.35, 2.1, 0.5, 0.2, 'sofa');
    p(-1.0, 0.12, 0, 0.2, 0.55, 0.9, 'sofa'); p(1.0, 0.12, 0, 0.2, 0.55, 0.9, 'sofa');
    p(-0.45, 0.42, 0.05, 0.8, 0.12, 0.7, 'sofa', false); p(0.45, 0.42, 0.05, 0.8, 0.12, 0.7, 'sofa', false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(sx * 0.95, 0, sz * 0.38, 0.06, 0.12, 0.06, 'wood', false);
    this.addCol(x, z, 2.1, 0.9, rot, 'furn');
  }
  armchair(x, z, rot) {
    const p = this.part(x, z, rot);
    p(0, 0.12, 0, 0.85, 0.3, 0.85, 'sofa'); p(0, 0.42, -0.35, 0.85, 0.55, 0.18, 'sofa');
    p(-0.4, 0.12, 0, 0.14, 0.55, 0.85, 'sofa'); p(0.4, 0.12, 0, 0.14, 0.55, 0.85, 'sofa');
    p(0, 0.42, 0.05, 0.62, 0.1, 0.62, 'sofa', false);
    this.addCol(x, z, 0.9, 0.9, rot, 'furn');
  }
  bookcase(x, z, w, h, facing) {
    // facing: which way the open front points ('z+', 'z-', 'x+', 'x-'); (x,z) is the centre of the case footprint
    const rot = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 }[facing];
    const p = this.part(x, z, rot), d = 0.4;
    p(0, 0, -d / 2 + 0.02, w, h, 0.04, 'wood', false);
    p(-w / 2 + 0.03, 0, 0, 0.06, h, d, 'wood'); p(w / 2 - 0.03, 0, 0, 0.06, h, d, 'wood');
    p(0, h - 0.05, 0, w, 0.05, d, 'wood', false); p(0, 0, 0, w, 0.1, d, 'wood', false);
    p(0, 0.1, -0.02, w - 0.1, h - 0.15, d - 0.1, 'books', false);
    this.addCol(x, z, facing[0] === 'z' ? w : d, facing[0] === 'z' ? d : w, 0, 'furn', true);
  }

  // ---------------------------------------------------------------- dining room
  buildDining() {
    this.rug(7.0, 4.5, 3.4, 4.6, 'rug1');
    this.table(7.0, 4.5, 1.2, 3.4, 0.78, { collide: true });
    [3.4, 4.5, 5.6].forEach((z) => { this.chair(5.78, z, Math.PI / 2); this.chair(8.25, z, -Math.PI / 2 + (z === 5.6 ? 0.45 : 0)); });
    this.chair(7.0, 2.5, 0); this.chair(7.0, 6.5, Math.PI);
    this.chair(6.0, 7.25, 0.9, { tipped: true });
    // candelabra
    this.fcyl(7.0, 0.78, 4.5, 0.05, 0.07, 0.04, 'brass', { seg: 8, cast: false });
    this.fcyl(7.0, 0.8, 4.5, 0.012, 0.012, 0.28, 'brass', { seg: 6, cast: false });
    this.fb(7.0, 1.04, 4.5, 0.4, 0.015, 0.015, 'brass', { col: false, cast: false });
    this.candle(6.8, 1.05, 4.5, { h: 0.12, intensity: 1.2 }); this.candle(7.2, 1.05, 4.5, { h: 0.1, intensity: 1.0 });
    this.candle(7.0, 1.09, 4.5, { h: 0.14, lit: false });
    // plates & goblets
    [[6.65, 3.5], [7.35, 3.5], [6.65, 5.5], [7.35, 5.5]].forEach(([x, z]) => this.fcyl(x, 0.78, z, 0.1, 0.08, 0.015, 'bedding', { seg: 10, cast: false }));
    // china cabinet (east wall)
    this.fb(9.62, 0, 2.4, 0.5, 2.1, 1.4, 'wood', { light: true });
    this.fb(9.36, 0.35, 2.4, 0.03, 1.5, 1.2, 'cabglass', { col: false, cast: false });
    for (let i = 0; i < 6; i++) this.fcyl(9.5, 0.4 + (i % 3) * 0.45, 1.95 + (i % 2) * 0.5, 0.06, 0.05, 0.08, 'bedding', { seg: 8, cast: false });
    // sideboard + battery
    this.fb(5.5, 0, 7.55, 1.6, 0.9, 0.5, 'wood', { light: false });
    this.fb(5.5, 0.9, 7.55, 1.66, 0.04, 0.54, 'woodLight', { col: false });
    this.batterySpotDining = new THREE.Vector3(5.2, 0.94 + 0.035, 7.55);
    this.fcyl(6.1, 0.94, 7.6, 0.07, 0.06, 0.2, 'woodLight', { seg: 8, cast: false });
    this.portrait(5.2, 1.8, 1.14, 'pz', 6, 0.6); this.portrait(8.9, 1.8, 1.14, 'pz', 7, 0.6);
    this.portrait(5.1, 1.8, 7.86, 'nz', 8, 0.5);
    this.fb(9.4, 0, 7.2, 0.6, 0.5, 0.6, 'woodLight', { rot: 0.3 }); // crates
  }

  // ---------------------------------------------------------------- kitchen
  buildKitchen() {
    // counters along the north wall
    const cz = -7.55, ct = 0.9;
    this.fb(4.52, 0, -7.5, 0.8, 1.95, 0.76, 'enamel', { light: true });                       // fridge
    this.fb(4.52, 1.2, -7.1, 0.74, 0.02, 0.02, 'iron', { col: false, cast: false });
    this.fb(5.76, 0, cz, 1.68, ct, 0.65, 'wood', { light: false });                          // left run
    this.fb(5.76, ct, cz, 1.72, 0.04, 0.68, 'enamel', { col: false });
    this.fb(7.3, 0, cz, 1.4, ct, 0.65, 'wood', { light: false });                           // sink run
    this.fb(7.3, ct, cz, 1.44, 0.04, 0.68, 'enamel', { col: false });
    this.fb(7.3, ct + 0.04, cz, 0.7, 0.01, 0.4, 'black', { col: false, cast: false });       // basin
    this.fcyl(7.3, ct + 0.04, -7.78, 0.02, 0.02, 0.3, 'iron', { seg: 6, cast: false });      // tap
    this.fb(8.45, 0, cz, 0.9, ct, 0.65, 'enamel', { light: false });                         // stove
    for (const [bx, bz] of [[8.25, -7.42], [8.65, -7.42], [8.25, -7.7], [8.65, -7.7]]) this.fcyl(bx, ct, bz, 0.07, 0.07, 0.01, 'iron', { seg: 10, cast: false });
    this.fb(9.4, 0, cz, 0.96, ct, 0.65, 'wood', { light: false });
    this.fb(9.4, ct, cz, 1.0, 0.04, 0.68, 'enamel', { col: false });
    this.batterySpotKitchen = new THREE.Vector3(5.5, ct + 0.04 + 0.035, -7.4);
    this.fb(5.9, ct + 0.04, -7.5, 0.18, 0.2, 0.18, 'iron', { col: false, cast: false }); // kettle-ish
    // upper cabinets (left has the animated door)
    this.fb(5.75, 1.55, -7.72, 1.6, 0.8, 0.33, 'wood', { col: false });
    this.fb(9.0, 1.55, -7.72, 1.75, 0.8, 0.33, 'wood', { col: false });
    this.cabinetDoor = this.makeCabinetDoor(6.45, 1.57, -7.54, 0.76, 0.76);
    this.fb(5.35, 1.57, -7.54, 0.76, 0.76, 0.02, 'trim', { col: false, cast: false });
    for (const x of [8.55, 9.4]) this.fb(x, 1.57, -7.54, 0.82, 0.76, 0.02, 'trim', { col: false, cast: false });
    // table + chairs
    this.rug(6.8, -4.6, 2.6, 2.2, 'rug0');
    this.table(6.8, -4.6, 1.4, 0.9, 0.8, { collide: true });
    this.slideChair = this.makeSlideChair(5.78, -4.6);
    this.chair(6.8, -5.55, 0); this.chair(6.8, -3.65, Math.PI); this.chair(7.92, -4.6, -Math.PI / 2);
    this.fcyl(6.5, 0.8, -4.55, 0.1, 0.08, 0.015, 'bedding', { seg: 10, cast: false });
    this.candle(7.1, 0.8, -4.7, { h: 0.1, intensity: 1.0 });
    // shelf on the east wall with jars
    this.fb(9.75, 1.55, -6.2, 0.26, 0.05, 1.5, 'wood', { col: false });
    for (let i = 0; i < 5; i++) this.fcyl(9.72, 1.6, -6.75 + i * 0.28, 0.05, 0.05, 0.14 + (i % 2) * 0.04, 'glass', { seg: 8, cast: false });
    this.fb(9.3, 0, -3.2, 0.4, 0.45, 0.4, 'woodLight', { rot: 0.3 });  // stool
    this.fcyl(5.0, 0, -3.1, 0.18, 0.14, 0.3, 'iron', { seg: 10 });     // bucket
    this.fb(9.4, 0, -5.2, 0.6, 0.55, 0.9, 'woodLight', { rot: 0 });    // crate under window
  }
  makeCabinetDoor(hx, y, z, w, h) {
    const pivot = new THREE.Group(); pivot.position.set(hx, y, z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), getMat('trim'));
    m.position.set(-w / 2, h / 2, 0.015); m.castShadow = true; pivot.add(m);
    this.group.add(pivot);
    return { pivot, angle: 0, target: 0, vel: 0 };
  }
  makeSlideChair(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.PI / 2;
    const wm = getMat('wood');
    const add = (px, py, pz, w, h, d, cast = true) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wm); m.position.set(px, py + h / 2, pz); m.castShadow = cast; m.receiveShadow = true; g.add(m); };
    add(0, 0.43, 0, 0.44, 0.05, 0.44); for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(sx * 0.19, 0, sz * 0.19, 0.04, 0.43, 0.04, false);
    add(0, 0.48, -0.2, 0.44, 0.5, 0.04);
    this.group.add(g);
    const col = { minX: x - 0.23, maxX: x + 0.23, minZ: z - 0.23, maxZ: z + 0.23, tag: 'furn', active: true, light: false };
    this.colliders.push(col);
    return { g, col, from: x, to: x, t: 1, x0: x, x1: x, z };
  }

  // ---------------------------------------------------------------- study
  buildStudy() {
    this.rug(-6.8, -4.9, 3.0, 2.4, 'rug1');
    for (const z of [-7.1, -5.5, -3.9]) this.bookcase(-9.68, z, 1.5, 2.6, 'x+');
    // desk, chair, lamp, note
    this.table(-6.6, -6.7, 1.7, 0.8, 0.76, { collide: true });
    this.fb(-6.2, 0.14, -6.7, 0.5, 0.6, 0.7, 'wood', { col: false, cast: false });
    this.chair(-6.6, -7.45, Math.PI);
    this.fcyl(-5.95, 0.76, -6.95, 0.07, 0.09, 0.03, 'brass', { seg: 8, cast: false });
    this.fcyl(-5.95, 0.79, -6.95, 0.012, 0.012, 0.28, 'brass', { seg: 6, cast: false });
    this.fb(-5.95, 1.04, -6.95, 0.16, 0.08, 0.1, 'iron', { col: false, cast: false });
    this.noteSpotStudy = new THREE.Vector3(-6.95, 0.765, -6.6);
    this.candle(-7.3, 0.76, -6.95, { h: 0.1, intensity: 1.2 });
    // fireplace on the east wall
    this.fb(-4.4, 0, -5.0, 0.56, WALL_H, 1.9, 'edge', { light: true });
    this.fb(-4.1, 0, -5.0, 0.12, 0.95, 1.0, 'black', { col: false, cast: false });
    this.fb(-4.12, 1.0, -5.0, 0.2, 0.08, 1.7, 'wood', { col: false });
    this.portrait(-4.12, 2.0, -5.0, 'nx', 9, 0.75);
    // armchair in the corner
    this.armchair(-5.0, -3.15, -2.33);
    // filing cabinet
    this.fb(-9.58, 0, -2.5, 0.6, 1.3, 0.78, 'enamel', { light: false });
    // globe table
    this.fcyl(-5.25, 0, -7.25, 0.22, 0.22, 0.05, 'wood', { seg: 12, col: false });
    this.fcyl(-5.25, 0.05, -7.25, 0.03, 0.03, 0.75, 'wood', { seg: 8, col: true });
    this.fsph(-5.25, 0.98, -7.25, 0.2, 'woodLight');
    this.fcyl(-5.25, 0.5, -7.25, 0.3, 0.3, 0.03, 'wood', { seg: 12, cast: false });
  }

  // ---------------------------------------------------------------- bedroom
  buildBedroom() {
    this.rug(-0.4, -4.9, 3.2, 2.3, 'rug0');
    // bed
    this.fb(1.3, 0, -6.8, 1.64, 0.4, 2.1, 'wood');
    this.fb(1.3, 0.4, -6.8, 1.56, 0.22, 2.0, 'bedding', { col: false });
    this.fb(1.3, 0.62, -6.0, 1.58, 0.07, 1.1, 'blanket', { col: false, cast: false });
    this.fb(0.88, 0.62, -7.45, 0.55, 0.12, 0.34, 'bedding', { col: false, cast: false, rot: 0.08 });
    this.fb(1.72, 0.62, -7.45, 0.55, 0.12, 0.34, 'bedding', { col: false, cast: false, rot: -0.1 });
    this.fb(1.3, 0, -7.82, 1.72, 1.3, 0.1, 'wood', { col: false });
    this.fb(1.3, 0, -5.74, 1.72, 0.55, 0.08, 'wood', { col: false });
    // nightstands
    this.fb(0.0, 0, -7.62, 0.5, 0.58, 0.44, 'woodLight');
    this.fb(2.65, 0, -7.62, 0.5, 0.58, 0.44, 'woodLight');
    this.candle(2.65, 0.58, -7.62, { h: 0.1, intensity: 1.3 });
    // wardrobe
    this.fb(-3.55, 0, -4.8, 0.6, 2.3, 1.5, 'wood', { light: true });
    this.fb(-3.24, 0.1, -4.8, 0.02, 2.1, 0.03, 'black', { col: false, cast: false });
    // vanity + mirror
    this.fb(-3.6, 0, -7.0, 0.5, 0.78, 1.2, 'woodLight');
    this.fb(-3.84, 0.95, -7.0, 0.04, 1.1, 0.8, 'mirror', { col: false, cast: false });
    this.fb(-3.83, 0.9, -7.0, 0.03, 1.2, 0.9, 'trim', { col: false, cast: false });
    this.chair(-2.85, -7.0, Math.PI / 2 + 3.14);
    // dresser + doll
    this.fb(3.6, 0, -4.0, 0.5, 0.95, 1.4, 'woodLight');
    this.doll(3.6, 0.95, -3.7);
    this.portrait(3.86, 1.8, -5.6, 'nx', 19, 0.55);
    this.portrait(-3.86, 1.7, -2.9, 'px', 20, 0.5);
    // rocking chair
    const p = this.part(-1.7, -3.9, 0.6);
    p(0, 0.35, 0, 0.5, 0.05, 0.5, 'wood'); p(0, 0.4, -0.23, 0.5, 0.65, 0.04, 'wood');
    for (const sx of [-1, 1]) { p(sx * 0.22, 0.02, 0, 0.03, 0.04, 0.7, 'wood', false); p(sx * 0.22, 0.05, -0.18, 0.03, 0.32, 0.03, 'wood', false); p(sx * 0.22, 0.05, 0.18, 0.03, 0.32, 0.03, 'wood', false); }
    this.addCol(-1.7, -3.9, 0.6, 0.7, 0.6, 'furn');
  }
  doll(x, y0, z) {
    this.fb(x, y0, z, 0.12, 0.2, 0.1, 'dress', { col: false, cast: false });
    this.fsph(x, y0 + 0.27, z, 0.055, 'skin', { cast: false });
    this.fb(x - 0.08, y0 + 0.08, z, 0.03, 0.14, 0.03, 'skin', { col: false, cast: false, euler: new THREE.Euler(0, 0, 0.5) });
    this.fb(x + 0.08, y0 + 0.08, z, 0.03, 0.14, 0.03, 'skin', { col: false, cast: false, euler: new THREE.Euler(0, 0, -0.5) });
  }

  // ---------------------------------------------------------------- decals & webs
  buildDecals() {
    const r = this.rng;
    // ceiling stains / mould
    const rooms = Object.keys(ROOMS);
    rooms.forEach((k, i) => {
      const rm = ROOMS[k];
      for (let n = 0; n < 2; n++) this.decal(n ? 'mold' : 'stain', 1 + ((i + n) % 3), rm.x0 + 1 + r() * (rm.x1 - rm.x0 - 2), WALL_H - 0.012, rm.z0 + 1 + r() * (rm.z1 - rm.z0 - 2), 'down', 1.4 + r() * 1.4, r() * 6);
    });
    // wall stains
    [
      [-3.0, 1.8, -7.86, 'pz'], [8.6, 1.9, -7.86, 'pz'], [-9.86, 1.6, 6.0, 'px'], [9.86, 2.0, 3.0, 'nx'], [-0.5, 2.0, 7.86, 'nz'],
      [-5.4, 1.5, 0.88, 'nz'], [6.0, 1.7, 0.88, 'nz'], [-9.86, 1.8, -6.0, 'px'], [3.84, 2.0, -6.5, 'nx'],
    ].forEach(([x, y, z, f], i) => this.decal(i % 3 === 0 ? 'mold' : 'stain', 1 + (i % 3), x, y, z, f, 1.3 + r() * 1.2, r() * 6));
    this.decal('peel', 1, 4.5, 1.9, -1.86, 'pz', 1.2, 0.3);
    this.decal('peel', 2, -2.5, 1.7, 7.86, 'nz', 1.1, 2.1);
    this.decal('peel', 3, -9.86, 1.6, 1.8, 'px', 1.0, 0.9);
    this.decal('crackwall', 1, 2.9, 1.7, 7.86, 'nz', 2.3, 0.1);
    this.decal('crackwall', 1, -9.86, 1.5, -4.3, 'px', 2.0, 0.6);
    this.decal('crackwall', 1, 9.86, 1.5, 6.6, 'nx', 2.2, -0.2);
    // blood-ish messages
    this.decal('hand', 1, -1.6, 1.4, -1.87, 'pz', 0.45, 0.2);   // next to the bedroom door
    this.decal('hand', 1, -5.6, 1.3, -1.87, 'pz', 0.42, -0.3);
    this.decal('hand', 1, 1.2, 1.2, -1.87, 'pz', 0.4, 0.5);
    this.decal('scrawl:DON\'T|LOOK|BACK', 1, 4.14, 1.6, -3.9, 'px', 1.4, 0.05);
    this.decal('scrawl:NOT|ALONE', 1, 3.86, 2.15, -3.2, 'nx', 1.0, 0);
    this.decal('scrawl:LEAVE', 1, -0.3, 2.1, 0.86, 'nz', 1.3, 0.04);
    this.decal('scrawl:IT SEES|THE LIGHT', 1, -9.84, 2.0, -4.6, 'px', 1.0, 0);
    this.decal('scratch', 1, -6.56, 1.0, -1.97, 'nz', 0.6, 0);
    this.decal('scratch', 1, 0.55, 1.1, -1.97, 'nz', 0.55, 0.15);
    this.decal('scratch', 1, -0.3, 1.2, 7.87, 'nz', 0.55, 0);
  }
  buildCobwebs() {
    for (const k in ROOMS) {
      const r = ROOMS[k], h = 0.1;
      this.web(r.x0 + h, r.z0 + h, 0, 0.9 + this.rng() * 0.5);
      this.web(r.x1 - h, r.z0 + h, -Math.PI / 2, 0.8 + this.rng() * 0.5);
      this.web(r.x1 - h, r.z1 - h, Math.PI, 0.9 + this.rng() * 0.4);
      this.web(r.x0 + h, r.z1 - h, Math.PI / 2, 0.8 + this.rng() * 0.5);
    }
  }

  // ---------------------------------------------------------------- outside
  buildOutside() {
    this.skyMat = new THREE.MeshBasicMaterial({ map: Tex.sky(), color: new THREE.Color(0.0, 0.0, 0.0), fog: false, side: THREE.DoubleSide, depthWrite: false });
    const mk = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 12), this.skyMat); m.position.set(x, 3.5, z); m.rotation.y = ry; m.renderOrder = -1; this.group.add(m); };
    mk(70, 0, -22, 0); mk(70, 0, 22, Math.PI); mk(60, -28, 0, Math.PI / 2); mk(60, 28, 0, -Math.PI / 2);
    this.skyMat.map.repeat.set(2, 1);
    // porch glow for the escape
    this.escapeGlow = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 3.2), fog: false, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    this.escapeGlow.position.set(0, 1.6, 9.4); this.group.add(this.escapeGlow);
  }

  // ---------------------------------------------------------------- items
  makeKey() {
    const g = new THREE.Group(); const m = getMat('brass');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 8, 16), m); ring.rotation.x = Math.PI / 2; ring.position.x = -0.07; g.add(ring);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.012), m); shaft.position.x = 0.01; g.add(shaft);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.035), m); t1.position.set(0.055, 0, 0.014); g.add(t1);
    const t2 = t1.clone(); t2.position.set(0.036, 0, 0.012); t2.scale.z = 0.7; g.add(t2);
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    return g;
  }
  makeBattery() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 10), new THREE.MeshStandardMaterial({ color: 0x27434b, roughness: 0.5, metalness: 0.3 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), getMat('brass')); cap.position.y = 0.071;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.025, 10), new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.5 })); band.position.y = 0.03;
    g.add(body, cap, band); g.rotation.z = Math.PI / 2;
    const w = new THREE.Group(); w.add(g); return w;
  }
  makeNote() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.27), new THREE.MeshStandardMaterial({ map: Tex.paper(1), roughness: 1 }));
    m.castShadow = false; return m;
  }
  glint(parent, color, scale) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.glint(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
    s.scale.set(scale, scale, 1); s.position.y = 0.045; parent.add(s);
    const o = { sprite: s, ph: this.rng() * 10, base: scale };
    this.glints.push(o);
    return o;
  }
  placeItem(obj, interact, pos, radius, glintColor, glintScale, yaw = 0) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = yaw;
    grp.add(obj);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(radius, 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.interact = interact; grp.add(hit);
    this.group.add(grp);
    this.interactMeshes.push(hit);
    const gl = this.glint(grp, glintColor, glintScale);
    const item = { group: grp, hit, glint: gl, interact, taken: false };
    interact.item = item;
    this.items.push(item);
    return item;
  }
  buildItems() {
    const r = this.rng;
    const pick = (a) => a[Math.floor(r() * a.length)];
    // keys: one random spot per room
    const spots = {
      kitchen: [[6.1, 0.935, -7.45], [8.45, 0.915, -7.3], [7.3, 0.825, -4.45], [7.3, 1.065, -7.75], [9.72, 1.61, -5.85], [6.4, 0.935, -7.55]],
      study:   [[-5.95, 0.775, -6.35], [-9.55, 1.31, -2.45], [-5.0, 0.55, -3.1], [-4.5, 1.1, -4.55], [-7.0, 1.065, -7.8], [-5.25, 0.545, -7.0]],
      bedroom: [[0.95, 0.76, -7.35], [0.05, 0.6, -7.62], [3.6, 0.97, -3.5], [-3.6, 0.8, -6.6], [1.3, 0.7, -6.0], [2.65, 0.6, -7.5]],
    };
    this.keyRooms = ['kitchen', 'study', 'bedroom'];
    this.keyItems = this.keyRooms.map((room, i) => {
      const s = pick(spots[room]); this.keySpotChosen = this.keySpotChosen || {}; this.keySpotChosen[room] = s;
      const interact = { type: 'key', room, index: i };
      return this.placeItem(this.makeKey(), interact, new THREE.Vector3(s[0], s[1], s[2]), 0.2, new THREE.Color(1.4, 1.0, 0.45), 0.34, r() * 6.28);
    });
    // batteries (fixed)
    [this.batterySpotLiving, this.batterySpotDining, new THREE.Vector3(-3.55, 0.835, 0.66), this.batterySpotKitchen].forEach((p, i) => {
      this.placeItem(this.makeBattery(), { type: 'battery', index: i }, p, 0.17, new THREE.Color(0.5, 1.1, 1.3), 0.2, r() * 6.28);
    });
    // notes
    const n1 = this.makeNote(); n1.rotation.y = 0.3;
    this.placeItem(n1, { type: 'note', id: 'foyer' }, this.noteSpot, 0.22, new THREE.Color(0.8, 0.7, 0.4), 0.0001, 0);
    const n2 = this.makeNote(); n2.rotation.y = -0.5;
    this.placeItem(n2, { type: 'note', id: 'study' }, this.noteSpotStudy, 0.22, new THREE.Color(0.8, 0.7, 0.4), 0.0001, 0);
    this.items.forEach((it) => { if (it.interact.type === 'note') it.glint.sprite.visible = false; });
  }
  removeItem(item) {
    item.taken = true; item.group.visible = false;
    const i = this.interactMeshes.indexOf(item.hit); if (i >= 0) this.interactMeshes.splice(i, 1);
  }

  // ---------------------------------------------------------------- scripted prop actions
  slideChairAway() {
    const c = this.slideChair; c.from = c.g.position.x; c.to = c.from - 1.25; c.t = 0;
    this.audio?.scrape(new THREE.Vector3(c.from, 0.3, c.z), 1.3);
  }
  bangCabinet() {
    const c = this.cabinetDoor; c.bang = true; c.phase = 0; c.vel = 22; c.angle = 0;
  }

  // ---------------------------------------------------------------- queries
  segmentBlocked(ax, az, bx, bz) {
    for (const c of this.colliders) {
      if (!c.active || !c.light) continue;
      if (segAABB(ax, az, bx, bz, c)) return true;
    }
    return false;
  }
  setLightning(v) { this.lightning = v; }
  setBlackout(on) { this.blackout = on; }

  // ---------------------------------------------------------------- per frame
  update(dt, t, playerPos) {
    this.time = t;
    for (const d of this.doors) d.update(dt);
    // cabinet door physics (springy bang)
    const cd = this.cabinetDoor;
    if (cd.bang) {
      if (cd.phase === 0) { cd.angle += cd.vel * dt; if (cd.angle >= 2.1) { cd.angle = 2.1; cd.phase = 1; cd.hold = 0.55; } }
      else if (cd.phase === 1) { cd.hold -= dt; if (cd.hold <= 0) { cd.phase = 2; cd.vel = -3; } }
      else { cd.vel -= 30 * dt; cd.angle += cd.vel * dt; if (cd.angle <= 0) { cd.angle = 0; cd.bang = false; this.audio?.slam(new THREE.Vector3(6, 1.8, -7.4), 0.7); } }
      cd.pivot.rotation.y = cd.angle;
    }
    // chair slide
    const sc = this.slideChair;
    if (sc.t < 1) {
      sc.t = Math.min(1, sc.t + dt / 1.4);
      const e = 1 - Math.pow(1 - sc.t, 3);
      const x = sc.from + (sc.to - sc.from) * e;
      sc.g.position.x = x; sc.g.rotation.y = Math.PI / 2 + Math.sin(sc.t * 3.1) * 0.25;
      sc.col.minX = x - 0.23; sc.col.maxX = x + 0.23;
    }
    // glints: slow pulse, brief flare
    for (const g of this.glints) {
      const k = Math.pow(Math.max(0, Math.sin(t * 1.6 + g.ph)), 12);
      g.sprite.material.opacity = 0.14 + 0.85 * k; const s = g.base * (0.7 + 0.6 * k); g.sprite.scale.set(s, s, 1);
    }
    // flames
    for (const f of this.flames) {
      const on = f.src.on;
      f.sp.visible = on;
      if (!on) continue;
      const k = f.src.flicker(t);
      f.sp.scale.set(0.05 + 0.012 * Math.sin(t * 17 + f.ph), (0.1 + 0.03 * Math.sin(t * 23 + f.ph * 2)) * Math.max(0.45, k), 1);
      f.sp.position.x = f.base.x + Math.sin(t * 9 + f.ph) * 0.003;
      f.sp.material.opacity = 0.65 + 0.35 * Math.min(1, k);
    }
    this.updateLights(t, playerPos);
    this.skyMat.color.setRGB(0.012 + this.lightning * 1.0, 0.016 + this.lightning * 1.1, 0.03 + this.lightning * 1.3);
    this.ambient.intensity = AMBIENT_BASE + this.lightning * 2.2;
  }
  updateLights(t, pp) {
    const flickering = t < this.flickerUntil;
    const cand = [];
    const pr = roomAt(pp.x, pp.z);
    for (const s of this.sources) {
      let k = 1;
      if (s.kind === 'bulb') {
        if (this.blackout) k = 0;
        else {
          const step = Math.floor(t * 17 + s.bulb.ph);
          k = 0.88 + 0.08 * Math.sin(t * 2.3 + s.bulb.ph) + (hash(step) < 0.035 ? -0.65 : 0);
          if (flickering) k = hash(Math.floor(t * 30 + s.bulb.ph * 7)) < 0.55 ? 0.05 : 1.15;
        }
        s.mult = k;
        s.bulb.glass.material.color.setRGB(3.4 * k, 2.1 * k, 0.9 * k);
        s.bulb.halo.material.opacity = 0.3 * k;
      } else if (s.kind === 'candle') {
        if (this.blackout) s.on = false;
        k = s.flicker(t);
      } else if (s.kind === 'moon') {
        k = 1 + this.lightning * s.gain;
      }
      if (!s.on || k <= 0.001) continue;
      const d = Math.hypot(s.pos.x - pp.x, s.pos.z - pp.z);
      const same = s.room === pr;
      cand.push({ s, k: k * (same ? 1 : s.kind === 'moon' ? 0.15 : 0.5), score: d + (same ? 0 : 5) - s.dist * 0.2 });
    }
    cand.sort((a, b) => a.score - b.score);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i], c = cand[i];
      if (!c) { l.intensity = 0; continue; }
      l.position.copy(c.s.pos); l.color.copy(c.s.color); l.distance = c.s.dist; l.intensity = c.s.intensity * c.k;
    }
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.group.removeFromParent();
  }
}

// 2D slab test: does segment (a->b) hit the AABB?
function segAABB(ax, az, bx, bz, c) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q, lo, hi] of [[dx, ax, c.minX, c.maxX], [dz, az, c.minZ, c.maxZ]]) {
    if (Math.abs(p) < 1e-9) { if (q < lo || q > hi) return false; }
    else {
      let u0 = (lo - q) / p, u1 = (hi - q) / p;
      if (u0 > u1) { const tmp = u0; u0 = u1; u1 = tmp; }
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) return false;
    }
  }
  return true;
}
