import * as THREE from 'three';
import { getTextures } from './Textures.js';

export const WALL_H = 3;
const WALL_T = 0.2;
const DOOR_H = 2.2;
const ARCH_H = 2.4;
export const DOOR_SWING = 1.7;

// Room bounds, used for scare trigger volumes.
export const ROOMS = {
  study: { x0: -10, x1: -4.5, z0: -8, z1: -3 },
  bedroom: { x0: -4.5, x1: 4.5, z0: -8, z1: -3 },
  kitchen: { x0: 4.5, x1: 10, z0: -8, z1: -3 },
  hallway: { x0: -10, x1: 10, z0: -3, z1: 2 },
  living: { x0: -10, x1: -4.5, z0: 2, z1: 8 },
  foyer: { x0: -4.5, x1: 4.5, z0: 2, z1: 8 },
  dining: { x0: 4.5, x1: 10, z0: 2, z1: 8 },
};

// Entity pathing grid: 0.5m cells over the full 20m x 16m footprint.
export const GRID = { x0: -10, z0: -8, cell: 0.5, nx: 40, nz: 32 };

// Each run, every key lands on one of these spots in its room.
const KEY_SPOTS = {
  kitchen: [
    { x: 6.8, y: 0.757, z: -5.4 },
    { x: 8.9, y: 0.007, z: -7.4 },
    { x: 9.6, y: 0.947, z: -4.85 },
  ],
  study: [
    { x: -8.6, y: 0.757, z: -6.75 },
    { x: -9.7, y: 2.007, z: -5.6 },
    { x: -9.3, y: 0.007, z: -4.0 },
  ],
  bedroom: [
    { x: -2.75, y: 0.607, z: -6.95 },
    { x: -4.25, y: 0.957, z: -5.0 },
    { x: 3.9, y: 0.007, z: -4.2 },
  ],
};

// Batteries are fixed. y is the resting height of the cylinder on its surface.
const BATTERY_SPOTS = [
  { id: 'living', x: -7.2, y: 0.462, z: 5.4 },
  { id: 'dining', x: 9.6, y: 0.912, z: 4.0 },
  { id: 'hallway', x: -9.7, y: 0.812, z: -0.4 },
  { id: 'kitchen', x: 9.6, y: 0.952, z: -3.9 },
];

const NOTES = {
  foyer: {
    x: 3.4, y: 0.801, z: 5.8, yaw: 0.3,
    text: 'They sealed the doors from the outside the night the house went quiet. Three brass keys were hidden in the dark: one in the kitchen, one in the study, one in the bedroom. Find all three and the front door will open. Do not answer if something calls your name from the hallway.',
  },
  study: {
    x: -7.6, y: 0.751, z: -6.5, yaw: -0.2,
    text: 'It cannot abide the light. Hold the beam on its face and it begins to burn, slowly at first and then all at once. But the lamp drinks batteries while it burns, so do not waste them. It learns where you hide. Keep moving. - E.',
  },
};

const BOOK_COLORS = [0x3a1212, 0x1c2a1c, 0x2e2014, 0x25252b];

const DUST_VS = `
attribute float aPhase;
uniform float uTime;
uniform float uPixel;
uniform float uCosCone;
uniform float uRange;
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
varying float vAlpha;
void main() {
  vec3 p = position + vec3(
    sin(uTime * 0.31 + aPhase) * 0.25,
    sin(uTime * 0.21 + aPhase * 1.7) * 0.12,
    cos(uTime * 0.27 + aPhase * 0.6) * 0.25);
  vec3 d = p - uFlashPos;
  float along = dot(d, uFlashDir);
  float cosA = along / max(length(d), 0.0001);
  float cone = smoothstep(uCosCone - 0.06, uCosCone + 0.02, cosA);
  float falloff = 1.0 - smoothstep(uRange * 0.4, uRange, along);
  vAlpha = cone * falloff * step(0.0, along) * (0.35 + 0.65 * fract(aPhase * 3.7));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixel * (0.6 + 0.8 * fract(aPhase * 7.1)) / max(-mv.z, 0.1);
}`;

const DUST_FS = `
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float a = (1.0 - smoothstep(0.15, 0.5, length(c))) * vAlpha * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(0.62, 0.58, 0.5), a);
}`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Scales a box's 0..1 UVs so the texture tiles at real-world size.
function tileUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

// Distance from a point to an oriented box on the XZ plane. Zero when inside.
// Box local axes: x = (cos a, -sin a), z = (sin a, cos a), matching rotation.y = a.
export function distToBox(px, pz, ob) {
  const c = Math.cos(ob.a), s = Math.sin(ob.a);
  const dx = px - ob.x, dz = pz - ob.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const cx = clamp(lx, -ob.hx, ob.hx);
  const cz = clamp(lz, -ob.hz, ob.hz);
  return Math.hypot(lx - cx, lz - cz);
}

export class House {
  constructor(scene) {
    this.tex = getTextures();
    this.root = new THREE.Group();
    scene.add(this.root);

    this.obstacles = [];        // solid footprints for player collision (includes doors)
    this.staticObstacles = [];  // solid footprints for entity pathing (no doors)
    this.occluders = [];        // meshes that block sight lines and the beam
    this.interactables = [];    // meshes the interaction ray can hit
    this.doors = {};
    this.keys = {};
    this.batteries = [];
    this.moons = [];
    this.bulbs = [];
    this.candles = [];
    this.blackout = false;
    this.lightMul = 1;
    this.flickerT = 0;
    this.lightningT = 0;
    this.chairSlide = null;
    this.cabinetBangT = 0;
    this.fieldStart = -1;

    this.buildMaterials();
    this.buildShell();
    this.buildRooms();
    this.buildPickups();
    this.buildDust();
    this.buildField();
    this.resetDynamic();
  }

  buildMaterials() {
    const t = this.tex;
    t.rain.repeat.set(2, 2);
    this.glassBase = new THREE.Color(0x2a3c66);
    this.m = {
      wall: new THREE.MeshStandardMaterial({ map: t.wall, bumpMap: t.wallBump, bumpScale: 0.8, roughness: 0.92 }),
      floor: new THREE.MeshStandardMaterial({ map: t.floor, bumpMap: t.floorBump, bumpScale: 1.5, roughness: 0.78 }),
      ceiling: new THREE.MeshStandardMaterial({ map: t.ceiling, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ map: t.wood, roughness: 0.5 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7 }),
      fabric: new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 1 }),
      red: new THREE.MeshStandardMaterial({ color: 0x3a1414, roughness: 1 }),
      linen: new THREE.MeshStandardMaterial({ color: 0x6f6b62, roughness: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x2c2c2e, metalness: 0.6, roughness: 0.45 }),
      fridge: new THREE.MeshStandardMaterial({ color: 0x8e8c84, metalness: 0.2, roughness: 0.45 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x4a4f4c, roughness: 0.35 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6 }),
      wax: new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.8 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3, emissive: 0xffa030, emissiveIntensity: 0.5 }),
      paper: new THREE.MeshStandardMaterial({ color: 0xcdc3a3, roughness: 0.95, side: THREE.DoubleSide }),
      battery: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.3, roughness: 0.5 }),
      rug: new THREE.MeshStandardMaterial({ map: t.rug, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      glass: new THREE.MeshBasicMaterial({ color: this.glassBase.clone(), map: t.rain, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      books: BOOK_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })),
    };
  }

  // Floor, ceiling, exterior walls with windows, interior walls with openings.
  buildShell() {
    const floorGeo = new THREE.PlaneGeometry(20, 16);
    tileUV(floorGeo, 10, 8);
    const floor = new THREE.Mesh(floorGeo, this.m.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);

    const ceilGeo = new THREE.PlaneGeometry(20, 16);
    tileUV(ceilGeo, 10, 8);
    const ceil = new THREE.Mesh(ceilGeo, this.m.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    this.root.add(ceil);

    // Exterior
    this.buildWall('x', -8, -10, 10, [
      { kind: 'window', c: -7.25, w: 1.0, y0: 0.9, y1: 2.2 },
      { kind: 'window', c: 0, w: 1.0, y0: 0.9, y1: 2.2 },
      { kind: 'window', c: 7.25, w: 1.0, y0: 0.9, y1: 2.2 },
    ]);
    this.buildWall('x', 8, -10, 10, [{ kind: 'door', c: 0, w: 1.0 }]);
    this.buildWall('z', -10, -8, 8, [{ kind: 'window', c: 5, w: 1.4, y0: 0.9, y1: 2.2 }]);
    this.buildWall('z', 10, -8, 8, [{ kind: 'window', c: 6, w: 1.2, y0: 0.9, y1: 2.2 }]);

    // Interior: the hallway runs the full width between the two room rows
    this.buildWall('x', -3, -10, 10, [
      { kind: 'door', c: -7.25, w: 1.0 },
      { kind: 'door', c: 0, w: 1.0 },
      { kind: 'arch', c: 7.25, w: 1.4 },
    ]);
    this.buildWall('x', 2, -10, 10, [
      { kind: 'arch', c: -7.25, w: 1.6 },
      { kind: 'arch', c: 0, w: 2.2 },
      { kind: 'arch', c: 7.25, w: 1.6 },
    ]);
    for (const x of [-4.5, 4.5]) {
      this.buildWall('z', x, -8, -3, []);
      this.buildWall('z', x, 2, 8, []);
    }
  }

  // axis 'x' runs along X at z = fixed. axis 'z' runs along Z at x = fixed.
  // door/arch leave a gap. window stays solid for collision but shows glass.
  buildWall(axis, fixed, a0, a1, openings) {
    const gaps = openings
      .filter((o) => o.kind !== 'window')
      .map((o) => [o.c - o.w / 2, o.c + o.w / 2])
      .sort((p, q) => p[0] - q[0]);
    const spans = [];
    let cur = a0;
    for (const [g0, g1] of gaps) {
      if (g0 > cur) spans.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (cur < a1) spans.push([cur, a1]);

    for (const [s, e] of spans) {
      this.addWallObstacle(axis, fixed, s, e);
      const wins = openings
        .filter((o) => o.kind === 'window' && o.c - o.w / 2 >= s - 1e-6 && o.c + o.w / 2 <= e + 1e-6)
        .sort((p, q) => p.c - q.c);
      let c = s;
      for (const w of wins) {
        const ws = w.c - w.w / 2, we = w.c + w.w / 2;
        if (ws > c) this.wallPiece(axis, fixed, c, ws, 0, WALL_H);
        this.wallPiece(axis, fixed, ws, we, 0, w.y0);
        this.wallPiece(axis, fixed, ws, we, w.y1, WALL_H);
        this.addWindow(axis, fixed, w);
        c = we;
      }
      if (c < e) this.wallPiece(axis, fixed, c, e, 0, WALL_H);
    }
    for (const o of openings) {
      if (o.kind === 'window') continue;
      const top = o.kind === 'door' ? DOOR_H : ARCH_H;
      this.wallPiece(axis, fixed, o.c - o.w / 2, o.c + o.w / 2, top, WALL_H);
    }
  }

  wallPiece(axis, fixed, a, b, y0, y1) {
    const len = b - a, h = y1 - y0, mid = (a + b) / 2, my = (y0 + y1) / 2;
    const geo = axis === 'x' ? new THREE.BoxGeometry(len, h, WALL_T) : new THREE.BoxGeometry(WALL_T, h, len);
    tileUV(geo, len, h);
    const m = new THREE.Mesh(geo, this.m.wall);
    m.castShadow = true;
    m.receiveShadow = true;
    if (axis === 'x') m.position.set(mid, my, fixed);
    else m.position.set(fixed, my, mid);
    this.root.add(m);
    this.occluders.push(m);

    // Baseboards only on full-height runs, on both faces
    if (y0 === 0 && y1 === WALL_H) {
      for (const side of [-1, 1]) {
        const off = side * (WALL_T / 2 + 0.0125);
        const bg = axis === 'x' ? new THREE.BoxGeometry(len, 0.12, 0.025) : new THREE.BoxGeometry(0.025, 0.12, len);
        const bb = new THREE.Mesh(bg, this.m.trim);
        bb.receiveShadow = true;
        if (axis === 'x') bb.position.set(mid, 0.06, fixed + off);
        else bb.position.set(fixed + off, 0.06, mid);
        this.root.add(bb);
      }
    }
    return m;
  }

  addWallObstacle(axis, fixed, a, b) {
    const ob = axis === 'x'
      ? { x: (a + b) / 2, z: fixed, hx: (b - a) / 2, hz: WALL_T / 2, a: 0 }
      : { x: fixed, z: (a + b) / 2, hx: WALL_T / 2, hz: (b - a) / 2, a: 0 };
    this.obstacles.push(ob);
    this.staticObstacles.push(ob);
  }

  addWindow(axis, fixed, o) {
    const h = o.y1 - o.y0, cy = (o.y0 + o.y1) / 2;
    const g = new THREE.Group();
    g.position.set(axis === 'x' ? o.c : fixed, cy, axis === 'x' ? fixed : o.c);
    if (axis === 'z') g.rotation.y = Math.PI / 2;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(o.w, h), this.m.glass);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.06), this.m.wood);
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.05, 0.06), this.m.wood);
    g.add(glass, vBar, hBar);
    this.root.add(g);
  }

  // Hinged door. Pivot sits at the hinge, slab extends along +x in local space.
  makeDoor(id, hingeX, hingeZ, w, front = false) {
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, hingeZ);
    this.root.add(pivot);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, DOOR_H, 0.06), this.m.wood);
    slab.position.set(w / 2, DOOR_H / 2, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    pivot.add(slab);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), this.m.brass);
    knob.position.set(w - 0.12, 1.0, 0.05);
    pivot.add(knob);

    const door = {
      id, pivot, hingeX, hingeZ, w, front,
      angle: 0, target: 0, speed: 2.6,
      obstacle: { x: 0, z: 0, hx: w / 2, hz: 0.05, a: 0 },
    };
    const interact = front ? { type: 'frontdoor', door } : { type: 'door', door };
    slab.userData.interact = interact;
    knob.userData.interact = interact;
    this.interactables.push(slab, knob);
    this.occluders.push(slab);
    this.obstacles.push(door.obstacle);
    this.doors[id] = door;
    this.updateDoorObstacle(door);
    return door;
  }

  // Opens a closed door, swinging it away from the player. Closes an open one.
  toggleDoor(id, playerZ) {
    const d = this.doors[id];
    if (!d) return null;
    if (Math.abs(d.target) > 0.01) d.target = 0;
    else d.target = playerZ < d.hingeZ ? -DOOR_SWING : DOOR_SWING;
    d.speed = 2.6;
    return d;
  }

  // Slams a door shut. Returns the door only if it was open, so the caller can play a bang.
  slamDoor(id) {
    const d = this.doors[id];
    if (!d) return null;
    const wasOpen = Math.abs(d.angle) > 0.05;
    d.target = 0;
    d.speed = 12;
    return wasOpen ? d : null;
  }

  openFrontDoor() {
    const d = this.doors.front;
    d.target = -DOOR_SWING * 0.95;
    d.speed = 0.9;
    return d;
  }

  updateDoors(dt) {
    for (const d of Object.values(this.doors)) {
      const diff = d.target - d.angle;
      if (Math.abs(diff) < 1e-4) continue;
      const step = d.speed * dt;
      d.angle += clamp(diff, -step, step);
      d.pivot.rotation.y = d.angle;
      this.updateDoorObstacle(d);
    }
  }

  updateDoorObstacle(d) {
    d.obstacle.a = d.angle;
    d.obstacle.x = d.hingeX + (d.w / 2) * Math.cos(d.angle);
    d.obstacle.z = d.hingeZ - (d.w / 2) * Math.sin(d.angle);
  }

  buildPickups() {
    const brass = this.m.brass;

    for (const id of Object.keys(KEY_SPOTS)) {
      const g = new THREE.Group();
      g.rotation.order = 'YXZ';
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 14), brass);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.008, 0.012), brass);
      shaft.position.x = 0.05;
      g.add(ring, shaft);
      // The ring is hollow and thin, so an invisible box makes the key easy to target.
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.05), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.x = 0.02;
      g.add(proxy);
      for (const mesh of [ring, shaft, proxy]) {
        mesh.userData.interact = { type: 'key', id };
        this.interactables.push(mesh);
      }
      this.root.add(g);
      this.keys[id] = g;
    }

    for (const b of BATTERY_SPOTS) {
      const g = new THREE.Group();
      g.rotation.order = 'YXZ';
      g.position.set(b.x, b.y, b.z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 10), this.m.battery);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 10), brass);
      cap.position.y = 0.028;
      g.add(body, cap);
      body.userData.interact = { type: 'battery', id: b.id };
      cap.userData.interact = body.userData.interact;
      this.interactables.push(body, cap);
      this.root.add(g);
      this.batteries.push({ id: b.id, group: g, spot: b });
    }

    for (const [id, n] of Object.entries(NOTES)) {
      const g = new THREE.Group();
      g.rotation.order = 'YXZ';
      g.position.set(n.x, n.y, n.z);
      g.rotation.set(-Math.PI / 2, n.yaw, 0);
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), this.m.paper);
      paper.userData.interact = { type: 'note', id, text: n.text };
      this.interactables.push(paper);
      g.add(paper);
      this.root.add(g);
    }
  }

  // Drifting dust motes, lit only inside the flashlight cone (see DUST_VS).
  buildDust() {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = 0.3 + Math.random() * 2.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 15;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: 10 },
        uCosCone: { value: 0.9 },
        uRange: { value: 9 },
        uFlashPos: { value: new THREE.Vector3() },
        uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
        uOpacity: { value: 0 },
      },
      vertexShader: DUST_VS,
      fragmentShader: DUST_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.root.add(this.dust);
  }

  // Keeps dust particle size consistent across screen sizes.
  setViewport(height, fovDeg) {
    const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
    this.dust.material.uniforms.uPixel.value = focal * 0.014;
  }

  // Walkable cells for the entity. Cell centers must clear every static solid by 0.3m.
  buildField() {
    const { x0, z0, cell, nx, nz } = GRID;
    this.walk = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * cell;
        const cz = z0 + (j + 0.5) * cell;
        let ok = Math.abs(cx) < 9.7 && Math.abs(cz) < 7.7;
        for (const ob of this.staticObstacles) {
          if (!ok) break;
          if (distToBox(cx, cz, ob) < 0.3) ok = false;
        }
        this.walk[j * nx + i] = ok ? 1 : 0;
      }
    }
    this.field = new Int32Array(nx * nz);
    this.queue = new Int32Array(nx * nz);
  }

  // Breadth-first distance field (in cell steps) from the player's cell.
  updateField(px, pz) {
    const { x0, z0, cell, nx, nz } = GRID;
    const si = clamp(Math.floor((px - x0) / cell), 0, nx - 1);
    const sj = clamp(Math.floor((pz - z0) / cell), 0, nz - 1);
    let start = sj * nx + si;
    if (!this.walk[start]) {
      let bd = Infinity;
      for (let k = 0; k < this.walk.length; k++) {
        if (!this.walk[k]) continue;
        const di = (k % nx) - si;
        const dj = Math.floor(k / nx) - sj;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; start = k; }
      }
    }
    if (start === this.fieldStart) return;
    this.fieldStart = start;
    this.field.fill(-1);
    let head = 0, tail = 0;
    this.field[start] = 0;
    this.queue[tail++] = start;
    while (head < tail) {
      const k = this.queue[head++];
      const i = k % nx;
      const j = (k - i) / nx;
      const d = this.field[k] + 1;
      const nbrs = [];
      if (i > 0) nbrs.push(k - 1);
      if (i < nx - 1) nbrs.push(k + 1);
      if (j > 0) nbrs.push(k - nx);
      if (j < nz - 1) nbrs.push(k + nx);
      for (const nk of nbrs) {
        if (this.walk[nk] && this.field[nk] < 0) {
          this.field[nk] = d;
          this.queue[tail++] = nk;
        }
      }
    }
  }

  cellCenter(k) {
    const { x0, z0, cell, nx } = GRID;
    return { x: x0 + ((k % nx) + 0.5) * cell, z: z0 + (Math.floor(k / nx) + 0.5) * cell };
  }

  // Next cell center on the shortest path toward the player, or null when there is none.
  nextStep(x, z) {
    const { x0, z0, cell, nx, nz } = GRID;
    const i = clamp(Math.floor((x - x0) / cell), 0, nx - 1);
    const j = clamp(Math.floor((z - z0) / cell), 0, nz - 1);
    const k = j * nx + i;
    const d0 = this.field[k];
    if (d0 <= 0) return null;
    const cand = [];
    if (i > 0) cand.push(k - 1);
    if (i < nx - 1) cand.push(k + 1);
    if (j > 0) cand.push(k - nx);
    if (j < nz - 1) cand.push(k + nx);
    let best = -1, bd = d0;
    for (const nk of cand) {
      const d = this.field[nk];
      if (d >= 0 && d < bd) { bd = d; best = nk; }
    }
    return best < 0 ? null : this.cellCenter(best);
  }

  // Random reachable cell whose path distance from the player is within [minSteps, maxSteps].
  randomCell(minSteps, maxSteps, rand = Math.random) {
    const cells = [];
    for (let k = 0; k < this.field.length; k++) {
      const d = this.field[k];
      if (d >= minSteps && d <= maxSteps) cells.push(k);
    }
    if (!cells.length) return null;
    return this.cellCenter(cells[Math.floor(rand() * cells.length)]);
  }

  // Puts every key, door and moved prop back for a new run. Keys get new spots.
  resetDynamic(rand = Math.random) {
    for (const id of Object.keys(KEY_SPOTS)) {
      const spots = KEY_SPOTS[id];
      const s = spots[Math.floor(rand() * spots.length)];
      const g = this.keys[id];
      g.position.set(s.x, s.y, s.z);
      g.rotation.set(-Math.PI / 2, rand() * Math.PI * 2, 0);
      g.visible = true;
    }
    for (const b of this.batteries) b.group.visible = true;
    for (const d of Object.values(this.doors)) {
      d.angle = 0;
      d.target = 0;
      d.speed = 2.6;
      d.pivot.rotation.y = 0;
      this.updateDoorObstacle(d);
    }
    this.chairSlide = null;
    const home = this.kitchenChair.userData.home;
    this.kitchenChair.position.set(home.x, 0, home.z);
    this.kitchenChair.rotation.y = home.rot;
    const ob = this.kitchenChair.userData.obstacle;
    ob.x = home.x;
    ob.z = home.z;
    ob.a = home.rot;
    this.cabinetBangT = 0;
    this.flickerT = 0;
    this.lightningT = 0;
    this.blackout = false;
  }

  // Scripted prop moves.
  slideChair() {
    const h = this.kitchenChair.userData.home;
    this.chairSlide = { t: 0, dur: 1.8, x: h.x + 0.55, z: h.z + 0.3, rot: h.rot + 0.4 };
  }

  cabinetBang() {
    this.cabinetBangT = 0.8;
  }

  updateChair(dt) {
    const s = this.chairSlide;
    if (!s) return;
    s.t = Math.min(1, s.t + dt / s.dur);
    const e = 1 - Math.pow(1 - s.t, 3);
    const h = this.kitchenChair.userData.home;
    const x = h.x + (s.x - h.x) * e;
    const z = h.z + (s.z - h.z) * e;
    const rot = h.rot + (s.rot - h.rot) * e;
    this.kitchenChair.position.set(x, 0, z);
    this.kitchenChair.rotation.y = rot;
    const ob = this.kitchenChair.userData.obstacle;
    ob.x = x;
    ob.z = z;
    ob.a = rot;
    if (s.t >= 1) this.chairSlide = null;
  }

  updateCabinet(dt, t) {
    if (this.cabinetBangT <= 0 || !this.cabinet) return;
    this.cabinetBangT = Math.max(0, this.cabinetBangT - dt);
    this.cabinet.position.x = this.cabinet.userData.homeX + Math.sin(t * 65) * 0.02 * this.cabinetBangT;
  }

  flicker(sec) {
    this.flickerT = Math.max(this.flickerT, sec);
  }

  setBlackout(on) {
    this.blackout = on;
  }

  lightning() {
    this.lightningT = 1;
  }

  // Per-frame: light envelope, flicker, lightning, moving props, dust uniforms.
  // flash = { pos, dir, cosCone, range, strength } from the flashlight.
  update(dt, t, flash) {
    const target = this.blackout ? 0 : 1;
    this.lightMul += (target - this.lightMul) * Math.min(1, dt * 10);
    this.flickerT = Math.max(0, this.flickerT - dt);
    this.lightningT = Math.max(0, this.lightningT - dt * 4);
    const dip = this.flickerT > 0 && Math.random() < 0.45 ? Math.random() * 0.5 : 1;
    const L = this.lightMul;

    for (const b of this.bulbs) {
      const wobble = 0.94 + 0.06 * Math.sin(t * 7.3 + b.phase);
      b.light.intensity = b.base * L * dip * wobble * (1 + this.lightningT * 0.5);
      b.mat.emissiveIntensity = 2.2 * L * dip;
    }
    for (const m of this.moons) m.light.intensity = m.base * L * (1 + 3 * this.lightningT);
    for (const c of this.candles) {
      const f = 0.92 + 0.08 * Math.sin(t * 13 + c.phase) + (Math.random() - 0.5) * 0.06;
      c.flame.scale.set(0.12 * f, 0.18 * (0.9 + 0.2 * f), 1);
      c.flame.material.opacity = L;
      if (c.light) c.light.intensity = c.base * L * f;
    }

    this.m.brass.emissiveIntensity = 0.45 + 0.25 * Math.sin(t * 2.2);
    this.m.glass.color.copy(this.glassBase).multiplyScalar(1 + 4 * this.lightningT);
    this.tex.rain.offset.y = (t * 0.7) % 1;
    this.pendulum.rotation.z = Math.sin(t * 2.2) * 0.25;

    this.updateDoors(dt);
    this.updateChair(dt);
    this.updateCabinet(dt, t);

    const u = this.dust.material.uniforms;
    u.uTime.value = t;
    u.uFlashPos.value.copy(flash.pos);
    u.uFlashDir.value.copy(flash.dir);
    u.uCosCone.value = flash.cosCone;
    u.uRange.value = flash.range;
    u.uOpacity.value = flash.strength * L;
  }

  // A furniture piece: a group at (x, z) with an optional solid footprint (fw along local x, fd along local z).
  piece(x, z, rot, fw, fd) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.root.add(g);
    if (fw > 0) {
      const ob = { x, z, hx: fw / 2, hz: fd / 2, a: rot };
      this.obstacles.push(ob);
      this.staticObstacles.push(ob);
      g.userData.obstacle = ob;
    }
    return g;
  }

  part(g, w, h, d, mat, x, y, z, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }

  // w along x, d along z, h = top surface height
  table(x, z, w, d, h) {
    const g = this.piece(x, z, 0, w, d);
    this.part(g, w, 0.05, d, this.m.wood, 0, h - 0.025, 0);
    const lx = w / 2 - 0.06, lz = d / 2 - 0.06;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this.part(g, 0.06, h - 0.05, 0.06, this.m.wood, sx * lx, (h - 0.05) / 2, sz * lz, false);
    }
    return g;
  }

  // Faces local -z by default, so the back sits at +z.
  chair(x, z, rot) {
    const g = this.piece(x, z, rot, 0.45, 0.45);
    this.part(g, 0.45, 0.05, 0.45, this.m.wood, 0, 0.45, 0);
    this.part(g, 0.45, 0.5, 0.05, this.m.wood, 0, 0.7, 0.2);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this.part(g, 0.04, 0.45, 0.04, this.m.wood, sx * 0.19, 0.225, sz * 0.19, false);
    }
    return g;
  }

  sofa(x, z) {
    const g = this.piece(x, z, 0, 2.0, 0.9);
    this.part(g, 2.0, 0.42, 0.9, this.m.fabric, 0, 0.21, 0);
    this.part(g, 2.0, 0.55, 0.22, this.m.fabric, 0, 0.6, 0.34);
    for (const sx of [-1, 1]) this.part(g, 0.22, 0.5, 0.9, this.m.fabric, sx * 0.89, 0.46, 0);
    return g;
  }

  armchair(x, z) {
    const g = this.piece(x, z, 0, 0.9, 0.9);
    this.part(g, 0.9, 0.42, 0.8, this.m.fabric, 0, 0.21, 0.05);
    this.part(g, 0.9, 0.55, 0.16, this.m.fabric, 0, 0.6, 0.37);
    for (const sx of [-1, 1]) this.part(g, 0.14, 0.4, 0.8, this.m.fabric, sx * 0.38, 0.5, 0.05);
    return g;
  }

  // Bookshelf with solid back, sides, shelves and a few books. w = depth along x, d = length along z.
  bookshelf(x, z, w, d, h) {
    const g = this.piece(x, z, 0, w, d);
    const wood = this.m.wood;
    this.part(g, 0.03, h, d, wood, -w / 2 + 0.015, h / 2, 0);
    for (const sz of [-1, 1]) this.part(g, w, h, 0.03, wood, 0, h / 2, sz * (d / 2 - 0.015));
    for (let y = 0.02; y < h; y += 0.45) this.part(g, w, 0.03, d, wood, 0, y, 0, false);
    this.part(g, w, 0.03, d, wood, 0, h - 0.015, 0);
    for (let y = 0.05; y < h - 0.3; y += 0.45) {
      let z0 = -d / 2 + 0.08;
      for (let n = 0; n < 3 && z0 < d / 2 - 0.1; n++) {
        const bw = 0.03 + Math.random() * 0.025;
        const bh = 0.22 + Math.random() * 0.08;
        const mat = this.m.books[Math.floor(Math.random() * this.m.books.length)];
        this.part(g, w * 0.7, bh, bw, mat, 0, y + bh / 2 + 0.015, z0 + bw / 2, false);
        z0 += bw + 0.01 + Math.random() * 0.03;
      }
    }
    return g;
  }

  desk(x, z) {
    const g = this.piece(x, z, 0, 1.3, 0.65);
    this.part(g, 1.3, 0.05, 0.65, this.m.wood, 0, 0.725, 0);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this.part(g, 0.05, 0.7, 0.05, this.m.wood, sx * 0.6, 0.35, sz * 0.28, false);
    }
    this.part(g, 0.5, 0.2, 0.6, this.m.wood, 0.3, 0.6, 0);
    return g;
  }

  // Headboard at -z (north), footboard at +z.
  bed(x, z) {
    const g = this.piece(x, z, 0, 1.6, 2.1);
    this.part(g, 1.6, 0.36, 2.1, this.m.wood, 0, 0.18, 0);
    this.part(g, 1.5, 0.18, 2.0, this.m.linen, 0, 0.45, 0);
    this.part(g, 1.52, 0.04, 1.3, this.m.red, 0, 0.55, 0.35);
    this.part(g, 1.6, 1.2, 0.08, this.m.wood, 0, 0.6, -1.0);
    this.part(g, 1.6, 0.4, 0.08, this.m.wood, 0, 0.2, 1.0);
    for (const sx of [-1, 1]) this.part(g, 0.5, 0.12, 0.3, this.m.linen, sx * 0.36, 0.6, -0.7, false);
    return g;
  }

  // Front faces +x (the room is to the east).
  dresser(x, z) {
    const g = this.piece(x, z, 0, 0.5, 1.4);
    this.part(g, 0.5, 0.95, 1.4, this.m.wood, 0, 0.475, 0);
    for (const y of [0.2, 0.5, 0.8]) this.part(g, 0.01, 0.22, 1.3, this.m.black, 0.255, y, 0, false);
    return g;
  }

  // Front faces -x (the room is to the west).
  wardrobe(x, z) {
    const g = this.piece(x, z, 0, 0.6, 1.2);
    this.part(g, 0.6, 2.0, 1.2, this.m.wood, 0, 1.0, 0);
    this.part(g, 0.02, 1.9, 0.02, this.m.black, -0.31, 1.0, 0, false);
    return g;
  }

  fridge(x, z) {
    const g = this.piece(x, z, 0, 0.7, 0.7);
    this.part(g, 0.7, 1.9, 0.7, this.m.fridge, 0, 0.95, 0);
    return g;
  }

  // Kitchen counter along the east wall. Sink sits at local +z, stove at local -z.
  counter(x, z) {
    const g = this.piece(x, z, 0, 0.6, 3.2);
    this.part(g, 0.6, 0.9, 3.2, this.m.wood, 0, 0.45, 0);
    this.part(g, 0.64, 0.04, 3.24, this.m.stone, 0, 0.92, 0);
    this.part(g, 0.36, 0.03, 0.4, this.m.black, 0, 0.93, 0.3, false);
    this.part(g, 0.5, 0.02, 0.5, this.m.black, 0, 0.95, -1.0, false);
    return g;
  }

  // Wall cabinet. Not solid. Rattles on a cabinet bang.
  upperCabinet(x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.root.add(g);
    this.part(g, 0.36, 0.7, 1.4, this.m.wood, 0, 0, 0);
    g.userData.homeX = x;
    return g;
  }

  // Grandfather clock against the west wall. Front faces +x. The pendulum swings in updates.
  clock(x, z) {
    const g = this.piece(x, z, 0, 0.36, 0.5);
    this.part(g, 0.36, 2.2, 0.5, this.m.wood, 0, 1.1, 0);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), this.m.paper);
    face.position.set(0.185, 1.7, 0);
    face.rotation.y = Math.PI / 2;
    g.add(face);
    this.pendulum = new THREE.Group();
    this.pendulum.position.set(0.22, 1.4, 0);
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.6, 0.01), this.m.brass);
    rod.position.y = -0.3;
    const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), this.m.brass);
    bob.rotation.z = Math.PI / 2;
    bob.position.y = -0.6;
    this.pendulum.add(rod, bob);
    g.add(this.pendulum);
    return g;
  }

  // Hangs a framed procedural portrait. The group sits on the wall face and faces rotY.
  portrait(x, y, z, rotY, idx) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.92, 0.04), this.m.wood);
    frame.castShadow = true;
    g.add(frame);
    const canvas = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.78),
      new THREE.MeshStandardMaterial({ map: this.tex.portraits[idx % this.tex.portraits.length], roughness: 0.75 }),
    );
    canvas.position.z = 0.022;
    g.add(canvas);
    return g;
  }

  candle(x, y, z, withLight) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.root.add(g);
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.12, 8), this.m.wax);
    wax.position.y = 0.06;
    g.add(wax);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex.flame,
      color: new THREE.Color(2.2, 1.5, 0.9),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    flame.position.y = 0.16;
    g.add(flame);
    const c = { flame, phase: Math.random() * 10, base: 0.9, light: null };
    if (withLight) {
      const light = new THREE.PointLight(0xffa860, 0.9, 4.5, 2);
      light.position.set(x, y + 0.2, z);
      this.root.add(light);
      c.light = light;
    }
    this.candles.push(c);
    return g;
  }

  bulb(x, y, z, color, base) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: color, emissiveIntensity: 2.2, roughness: 0.6 });
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.09, 12), mat);
    fixture.position.set(x, y, z);
    this.root.add(fixture);
    const light = new THREE.PointLight(color, base, 9, 2);
    light.position.set(x, y - 0.1, z);
    this.root.add(light);
    this.bulbs.push({ light, mat, base, phase: Math.random() * 10 });
  }

  // Cold moonlight just inside a north window.
  moonLight(x) {
    const light = new THREE.PointLight(0x8fa6d8, 5, 10, 2);
    light.position.set(x, 1.9, -6.6);
    this.root.add(light);
    this.moons.push({ light, base: 5 });
  }

  // Cobweb in a wall corner. (sx, sz) points into the room.
  cobweb(cx, cz, sx, sz, y) {
    const mat = new THREE.MeshBasicMaterial({ map: this.tex.cobweb, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), mat);
    m.position.set(cx + sx * 0.4, y, cz + sz * 0.4);
    m.rotation.y = Math.atan2(sx, sz);
    this.root.add(m);
  }

  buildRooms() {
    this.makeDoor('study', -7.75, -3, 1.0);
    this.makeDoor('bedroom', -0.5, -3, 1.0);
    this.makeDoor('front', -0.5, 8, 1.0, true);
    this.buildFoyer();
    this.buildLiving();
    this.buildDining();
    this.buildHallway();
    this.buildStudy();
    this.buildBedroom();
    this.buildKitchen();
    this.buildCorners();
  }

  buildFoyer() {
    this.portrait(-4.37, 1.8, 4.5, Math.PI / 2, 0);
    this.portrait(4.37, 1.8, 3.6, -Math.PI / 2, 1);
    this.table(3.4, 5.8, 0.8, 0.45, 0.8);
    this.candle(3.1, 0.8, 6.0, true);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.2), this.m.rug);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.006, 5.0);
    rug.receiveShadow = true;
    this.root.add(rug);
    this.bulb(0, 2.7, 5.0, 0xffb56a, 3.4);
  }

  buildLiving() {
    this.sofa(-7.2, 7.45);
    this.armchair(-9.1, 3.0);
    this.table(-7.2, 5.4, 1.1, 0.6, 0.45);
    this.table(-5.4, 3.0, 0.5, 0.5, 0.6);
    this.candle(-5.4, 0.6, 3.0, true);
    this.bookshelf(-9.72, 7.0, 0.35, 1.6, 2.0);
    this.portrait(-7.0, 1.75, 7.87, Math.PI, 2);
  }

  buildDining() {
    this.table(7.4, 5.2, 2.0, 1.0, 0.75);
    this.chair(6.5, 3.9, Math.PI);
    this.chair(8.3, 3.9, Math.PI);
    this.chair(6.5, 6.5, 0);
    this.chair(8.3, 6.5, 0);
    this.candle(7.2, 0.75, 5.2, false);
    this.sideboardAt(9.65, 4.0);
    this.portrait(9.87, 1.85, 4.0, -Math.PI / 2, 3);
  }

  sideboardAt(x, z) {
    const g = this.piece(x, z, 0, 0.5, 1.4);
    this.part(g, 0.5, 0.9, 1.4, this.m.wood, 0, 0.45, 0);
    this.part(g, 0.01, 0.8, 1.3, this.m.black, -0.255, 0.45, 0, false);
    return g;
  }

  buildHallway() {
    this.table(-9.7, -0.4, 0.4, 1.2, 0.8);
    this.clock(-9.72, 1.2);
    this.portrait(-3.6, 1.8, -2.87, 0, 0);
    this.portrait(3.5, 1.8, -2.87, 0, 1);
    this.portrait(-3.78, 1.8, 1.87, Math.PI, 2);
    this.portrait(3.78, 1.8, 1.87, Math.PI, 3);
    this.bulb(-2.5, 2.7, -0.5, 0xffb56a, 3.0);
  }

  buildStudy() {
    this.bookshelf(-9.7, -5.6, 0.4, 2.0, 2.0);
    this.desk(-8.1, -6.5);
    this.chair(-8.1, -5.7, 0);
    this.portrait(-4.63, 1.8, -6.2, -Math.PI / 2, 0);
    this.moonLight(-7.25);
  }

  buildBedroom() {
    this.bed(-1.2, -6.5);
    this.table(-2.9, -7.1, 0.5, 0.5, 0.6);
    this.candle(-3.05, 0.6, -7.2, false);
    this.dresser(-4.25, -5.0);
    this.portrait(-4.37, 1.9, -5.0, Math.PI / 2, 1);
    this.wardrobe(4.18, -6.0);
    this.moonLight(0);
  }

  buildKitchen() {
    this.fridge(9.5, -7.4);
    this.counter(9.6, -5.2);
    this.table(6.8, -5.4, 1.2, 0.8, 0.75);
    this.kitchenChair = this.chair(6.8, -6.4, Math.PI);
    this.kitchenChair.userData.home = { x: 6.8, z: -6.4, rot: Math.PI };
    this.chair(6.8, -4.4, 0);
    this.cabinet = this.upperCabinet(9.73, 2.05, -5.0);
    this.moonLight(7.25);
  }

  buildCorners() {
    this.cobweb(-9.9, -7.9, 1, 1, 2.6);
    this.cobweb(9.9, -7.9, -1, 1, 2.6);
    this.cobweb(-9.9, 7.9, 1, -1, 2.6);
    this.cobweb(9.9, 7.9, -1, -1, 2.6);
    this.cobweb(-9.9, -2.9, 1, 1, 2.6);
  }
}
