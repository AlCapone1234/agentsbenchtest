import * as THREE from 'three';
import { scaleUV } from './Textures.js';

export const LAYOUT = {
  x0: -10,
  x1: -3.55,
  x2: 3.55,
  x3: 10,
  z0: -8,
  zN: -1.75,
  zS: 1.75,
  z3: 8,
  H: 3,
};

const H = LAYOUT.H;

export function roomAt(x, z) {
  const { x1, x2, zN, zS } = LAYOUT;
  if (z < zN) {
    if (x < x1) return 'study';
    if (x < x2) return 'bedroom';
    return 'kitchen';
  }
  if (z > zS) {
    if (x < x1) return 'living';
    if (x < x2) return 'foyer';
    return 'dining';
  }
  return 'hall';
}

export const SAFE_SPOTS = [
  { x: 0, z: 0 },
  { x: -6.2, z: 0 },
  { x: 6.2, z: 0 },
  { x: -6.6, z: -4.7 },
  { x: 0.15, z: -4.5 },
  { x: 6.5, z: -4.2 },
  { x: -6.6, z: 4.6 },
  { x: 0, z: 5.0 },
  { x: 6.8, z: 4.4 },
  { x: -6.78, z: -1.2 },
  { x: 0, z: -1.15 },
  { x: 6.78, z: -1.15 },
  { x: -6.78, z: 2.3 },
  { x: 0, z: 2.35 },
  { x: 6.78, z: 2.3 },
];

const NOTES = {
  foyer: {
    title: 'A torn page',
    body:
      'March 3\n\nThe doors locked themselves. I have walked every room. There are three brass keys — I have seen them, and then they were not where I left them.\n\nKitchen. Study. Bedroom.\n\nIf you find this, do not trust the hallway lights.\n\n— A.',
  },
  study: {
    title: 'The margin of a ledger',
    body:
      'The beam burns it.\n\nHold the light on the thing until it screams and the dark takes it back. It does not stay gone. It is only afraid of being seen.\n\nThere are batteries. I hid them when my hands still worked. Living room. Dining room. The hall table. The kitchen counter.\n\nDo not let the torch die.',
  },
};

function subtract(a, b, holes) {
  const cuts = holes
    .map((h) => ({ a: h.x - h.w / 2, b: h.x + h.w / 2 }))
    .filter((h) => h.b > a && h.a < b)
    .sort((p, q) => p.a - q.a);
  const out = [];
  let c = a;
  for (const h of cuts) {
    const hs = Math.max(h.a, a);
    const he = Math.min(h.b, b);
    if (hs > c + 0.04) out.push([c, hs]);
    c = Math.max(c, he);
  }
  if (b > c + 0.04) out.push([c, b]);
  return out;
}

export function createHouse(scene, mats) {
  const colliders = [];
  const rayMeshes = [];
  const doors = {};
  const bulbs = [];
  const candles = [];
  const windowLights = [];
  const keys = [];
  const batteries = [];

  const world = {
    colliders,
    rayMeshes,
    doors,
    bulbs,
    candles,
    windowLights,
    keys,
    batteries,
    safeSpots: SAFE_SPOTS,
    blackout: false,
    flash: 0,
    flickerT: 0,
    spots: {
      studyDoor: { x: -6.775, z: -1.42 },
    },
    frontHinge: { x: -0.61, z: 7.86 },
  };

  // PlaneGeometry faces +Z. Ry(+PI/2) sends that normal to +X. Ry(PI) sends it to -Z.
  function planeNS(z, x0, x1, y0, y1, normalSign, mat, cast) {
    const w = Math.abs(x1 - x0);
    const h = y1 - y0;
    if (w < 0.04 || h < 0.04) return;
    const geo = new THREE.PlaneGeometry(w, h);
    scaleUV(geo, w / 2.4, h / 2.2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
    mesh.rotation.y = normalSign > 0 ? 0 : Math.PI;
    mesh.receiveShadow = true;
    mesh.castShadow = !!cast;
    scene.add(mesh);
    rayMeshes.push(mesh);
  }

  function planeEW(x, z0, z1, y0, y1, normalSign, mat, cast) {
    const w = Math.abs(z1 - z0);
    const h = y1 - y0;
    if (w < 0.04 || h < 0.04) return;
    const geo = new THREE.PlaneGeometry(w, h);
    scaleUV(geo, w / 2.4, h / 2.2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.rotation.y = normalSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.castShadow = !!cast;
    scene.add(mesh);
    rayMeshes.push(mesh);
  }

  function colNS(z, x0, x1) {
    colliders.push({
      minX: Math.min(x0, x1),
      maxX: Math.max(x0, x1),
      minZ: z - 0.16,
      maxZ: z + 0.16,
      active: true,
    });
  }

  function colEW(x, z0, z1) {
    colliders.push({
      minX: x - 0.16,
      maxX: x + 0.16,
      minZ: Math.min(z0, z1),
      maxZ: Math.max(z0, z1),
      active: true,
    });
  }

  function trimX(z, x0, x1) {
    const len = Math.abs(x1 - x0);
    if (len < 0.1) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.04), mats.trim);
    m.position.set((x0 + x1) / 2, 0.05, z);
    m.receiveShadow = true;
    scene.add(m);
  }

  function trimZ(x, z0, z1) {
    const len = Math.abs(z1 - z0);
    if (len < 0.1) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, len), mats.trim);
    m.position.set(x, 0.05, (z0 + z1) / 2);
    m.receiveShadow = true;
    scene.add(m);
  }

  /**
   * Wall whose length runs along X, sitting on constant z.
   * matPos faces +Z. matNeg faces -Z.
   */
  function wallNS(z, x0, x1, holes, matPos, matNeg, exteriorPos = false, exteriorNeg = false) {
    const segs = subtract(x0, x1, holes);
    for (const [a, b] of segs) {
      planeNS(z + 0.05, a, b, 0, H, +1, matPos, !exteriorPos);
      planeNS(z - 0.05, a, b, 0, H, -1, matNeg, !exteriorNeg);
      colNS(z, a, b);
      if (!exteriorPos) trimX(z + 0.1, a, b);
      if (!exteriorNeg) trimX(z - 0.1, a, b);
    }
    for (const hole of holes) {
      const a = hole.x - hole.w / 2;
      const b = hole.x + hole.w / 2;
      if (hole.sill > 0.05) {
        planeNS(z + 0.05, a, b, 0, hole.sill, +1, matPos, !exteriorPos);
        planeNS(z - 0.05, a, b, 0, hole.sill, -1, matNeg, !exteriorNeg);
        colNS(z, a, b);
        if (!exteriorPos) trimX(z + 0.1, a, b);
        if (!exteriorNeg) trimX(z - 0.1, a, b);
      }
      if (hole.header < H - 0.04) {
        planeNS(z + 0.05, a, b, hole.header, H, +1, matPos, !exteriorPos);
        planeNS(z - 0.05, a, b, hole.header, H, -1, matNeg, !exteriorNeg);
      }
    }
  }

  function wallEW(x, z0, z1, holes, matPos, matNeg, exteriorPos = false, exteriorNeg = false) {
    const segs = subtract(z0, z1, holes.map((h) => ({ x: h.x, w: h.w })));
    // holes for EW walls are specified with x meaning the along-wall coordinate (z). Reuse x field.
    for (const [a, b] of segs) {
      planeEW(x + 0.05, a, b, 0, H, +1, matPos, !exteriorPos);
      planeEW(x - 0.05, a, b, 0, H, -1, matNeg, !exteriorNeg);
      colEW(x, a, b);
      if (!exteriorPos) trimZ(x + 0.1, a, b);
      if (!exteriorNeg) trimZ(x - 0.1, a, b);
    }
    for (const hole of holes) {
      const a = hole.x - hole.w / 2;
      const b = hole.x + hole.w / 2;
      if (hole.sill > 0.05) {
        planeEW(x + 0.05, a, b, 0, hole.sill, +1, matPos, !exteriorPos);
        planeEW(x - 0.05, a, b, 0, hole.sill, -1, matNeg, !exteriorNeg);
        colEW(x, a, b);
        if (!exteriorPos) trimZ(x + 0.1, a, b);
        if (!exteriorNeg) trimZ(x - 0.1, a, b);
      }
      if (hole.header < H - 0.04) {
        planeEW(x + 0.05, a, b, hole.header, H, +1, matPos, !exteriorPos);
        planeEW(x - 0.05, a, b, hole.header, H, -1, matNeg, !exteriorNeg);
      }
    }
  }

  const W = mats.wall;
  const side = mats.siding;
  const { x0, x1, x2, x3, z0, zN, zS, z3 } = LAYOUT;

  const doorHole = (x, w = 1.26) => ({ x, w, sill: 0, header: 2.32 });
  const archHole = (x, w) => ({ x, w, sill: 0, header: 2.7 });
  const winHole = (x, w = 1.1) => ({ x, w, sill: 1.12, header: 2.42 });

  // Outer shell. matPos faces +axis, matNeg faces -axis.
  wallNS(z0, x0, x1, [winHole(-8.0)], W.study, side, false, true);
  wallNS(z0, x1, x2, [winHole(1.55)], W.bed, side, false, true);
  wallNS(z0, x2, x3, [winHole(8.35, 1.25)], W.kitchen, side, false, true);

  wallNS(z3, x0, x1, [], side, W.living, true, false);
  wallNS(z3, x1, x2, [doorHole(0, 1.28), winHole(-2.15, 0.7), winHole(2.15, 0.7)], side, W.foyer, true, false);
  wallNS(z3, x2, x3, [], side, W.dining, true, false);

  // West wall: interior faces +X (matPos). East wall: interior faces -X (matNeg).
  wallEW(x0, z0, zN, [], W.study, side, false, true);
  wallEW(x0, zN, zS, [], W.hall, side, false, true);
  wallEW(x0, zS, z3, [winHole(5.15)], W.living, side, false, true);

  wallEW(x3, z0, zN, [], side, W.kitchen, true, false);
  wallEW(x3, zN, zS, [], side, W.hall, true, false);
  wallEW(x3, zS, z3, [winHole(4.55)], side, W.dining, true, false);

  // Hall / north rooms.
  wallNS(zN, x0, x1, [doorHole(-6.775)], W.hall, W.study);
  wallNS(zN, x1, x2, [doorHole(0)], W.hall, W.bed);
  wallNS(zN, x2, x3, [doorHole(6.775, 1.48)], W.hall, W.kitchen);

  // Hall / south rooms.
  wallNS(zS, x0, x1, [archHole(-6.775, 2.15)], W.living, W.hall);
  wallNS(zS, x1, x2, [archHole(0, 2.5)], W.foyer, W.hall);
  wallNS(zS, x2, x3, [archHole(6.775, 2.15)], W.dining, W.hall);

  // Side partitions, open across the hall.
  wallEW(x1, z0, zN, [], W.bed, W.study);
  wallEW(x1, zS, z3, [], W.foyer, W.living);
  wallEW(x2, z0, zN, [], W.kitchen, W.bed);
  wallEW(x2, zS, z3, [], W.dining, W.foyer);

  function post(x, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, H, 0.22), mats.trim);
    m.position.set(x, H / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    colliders.push({
      minX: x - 0.11, maxX: x + 0.11,
      minZ: z - 0.11, maxZ: z + 0.11,
      active: true,
    });
  }
  post(x1, zN);
  post(x1, zS);
  post(x2, zN);
  post(x2, zS);

  const floorGeo = new THREE.PlaneGeometry(20, 16);
  scaleUV(floorGeo, 20 / 2.15, 16 / 2.15);
  const floor = new THREE.Mesh(floorGeo, mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceilGeo = new THREE.PlaneGeometry(20, 16);
  scaleUV(ceilGeo, 20 / 3.4, 16 / 3.4);
  const ceil = new THREE.Mesh(ceilGeo, mats.ceiling);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  ceil.receiveShadow = true;
  scene.add(ceil);

  const groundGeo = new THREE.PlaneGeometry(90, 90);
  const ground = new THREE.Mesh(groundGeo, mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  function tree(x, z, s) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.5, 5), mats.ghostDark);
    trunk.position.y = 0.75;
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(1.15 * s, 3.4 * s, 6),
      new THREE.MeshStandardMaterial({ color: 0x060806, roughness: 1 }),
    );
    top.position.y = 2.5;
    g.add(trunk, top);
    g.position.set(x, 0, z);
    scene.add(g);
  }
  tree(-14, -6, 1.1);
  tree(-13, 4, 0.85);
  tree(14, -4, 1.2);
  tree(13, 6, 0.9);
  tree(-6, -13, 1);
  tree(5, -14, 1.15);
  tree(0, 13, 0.8);
  tree(8, 13.5, 1);

  function addWindow(x, y, z, rotY, outX, outZ) {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.15), mats.glass);
    glass.position.set(x, y, z);
    glass.rotation.y = rotY;
    scene.add(glass);
    const rain = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.2), mats.rain);
    rain.position.set(x + outX * 0.35, y, z + outZ * 0.35);
    rain.rotation.y = rotY;
    scene.add(rain);
    const light = new THREE.PointLight(0x8eafd4, 1.25, 6.2, 2);
    light.position.set(x + outX * 0.8, y, z + outZ * 0.8);
    scene.add(light);
    windowLights.push({ light, base: 1.25 });
  }

  // North windows sit just inside the wall; outside is -Z.
  addWindow(-8.0, 1.77, -7.9, 0, 0, -1);
  addWindow(1.55, 1.77, -7.9, 0, 0, -1);
  addWindow(8.35, 1.77, -7.9, 0, 0, -1);
  // South foyer windows, outside is +Z. Glass should be seen from inside, normal -Z → rotY PI.
  addWindow(-2.15, 1.77, 7.9, Math.PI, 0, 1);
  addWindow(2.15, 1.77, 7.9, Math.PI, 0, 1);
  // West window, outside -X. Viewer inside looks toward -X, glass normal +X → rotY +PI/2.
  addWindow(-9.9, 1.77, 5.15, Math.PI / 2, -1, 0);
  // East window, outside +X. Normal -X → rotY -PI/2.
  addWindow(9.9, 1.77, 4.55, -Math.PI / 2, 1, 0);

  function box(w, h, d, mat, x, y, z, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const y0 = y - h / 2;
    const y1 = y + h / 2;
    const blocks = opts.block === true || (opts.block !== false && y1 > 0.28 && y0 < 1.45);
    if (blocks) {
      colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        active: true,
      });
    }
    return mesh;
  }

  function rug(w, d, x, z) {
    const geo = new THREE.PlaneGeometry(w, d);
    scaleUV(geo, w / 1.6, d / 1.6);
    const mesh = new THREE.Mesh(geo, mats.rug);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  function portrait(x, y, z, rotY, index) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.96, 0.04), mats.trim);
    frame.castShadow = true;
    const artMat = new THREE.MeshStandardMaterial({
      map: mats.portraits[index % mats.portraits.length],
      roughness: 0.9,
    });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.82), artMat);
    art.position.z = 0.03;
    g.add(frame, art);
    scene.add(g);
    return g;
  }

  function hangingBulb(x, z, base = 0.42) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.85, 4), mats.trim);
    cord.position.set(x, 2.55, z);
    const bulbMat = mats.bulb.clone();
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bulbMat);
    bulb.position.set(x, 2.08, z);
    scene.add(cord, bulb);
    const light = new THREE.PointLight(0xffd0a4, base, 5.2, 2);
    light.position.set(x, 2.05, z);
    scene.add(light);
    bulbs.push({ light, mat: bulbMat, base, seed: Math.random() * 10 });
  }

  function candle(x, y, z) {
    box(0.045, 0.14, 0.045, mats.trim, x, y, z, { block: false, cast: false });
    const mat = mats.flame.clone();
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 0.12, z);
    sprite.scale.set(0.14, 0.2, 1);
    scene.add(sprite);
    const light = new THREE.PointLight(0xff8a3a, 0.32, 2.6, 2);
    light.position.set(x, y + 0.14, z);
    scene.add(light);
    candles.push({ light, sprite, base: 0.32, seed: Math.random() * 20 });
  }

  function makeDoor(id, hingeX, hingeZ, width, locked) {
    const group = new THREE.Group();
    group.position.set(hingeX, 0, hingeZ);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 2.26, 0.06), mats.door);
    slab.position.set(width / 2, 1.15, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), mats.iron);
    handle.position.set(width - 0.12, 1.02, 0.05);
    group.add(slab, handle);
    scene.add(group);
    slab.userData = { kind: 'door', id };
    rayMeshes.push(slab);

    const collider = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, active: true, tag: id };
    colliders.push(collider);

    const door = {
      id,
      group,
      width,
      closedYaw: 0,
      openYaw: 1.72,
      yaw: 0,
      target: 0,
      speed: 2.15,
      locked: !!locked,
      busy: 0,
      collider,
      get openAmount() {
        return Math.abs(this.yaw) / this.openYaw;
      },
      toggle() {
        if (this.locked || this.busy > 0) return false;
        const closed = Math.abs(this.target) < 0.08;
        this.target = closed ? this.openYaw : this.closedYaw;
        this.speed = 2.15;
        return true;
      },
      slam() {
        this.target = this.closedYaw;
        this.speed = 9;
        this.busy = 1.15;
      },
      forceOpen() {
        this.locked = false;
        this.target = this.openYaw;
        this.speed = 2.6;
      },
      update(dt) {
        this.busy = Math.max(0, this.busy - dt);
        const d = this.target - this.yaw;
        if (Math.abs(d) > 0.0008) {
          this.yaw += Math.sign(d) * Math.min(Math.abs(d), this.speed * dt);
          this.group.rotation.y = this.yaw;
        }
        this.sync();
      },
      sync() {
        const yaw = this.yaw;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const x2 = hingeX + width * c;
        const z2 = hingeZ - width * s;
        const tx = Math.sin(yaw) * 0.05;
        const tz = Math.cos(yaw) * 0.05;
        const xs = [hingeX + tx, hingeX - tx, x2 + tx, x2 - tx];
        const zs = [hingeZ + tz, hingeZ - tz, z2 + tz, z2 - tz];
        collider.minX = Math.min(...xs) - 0.02;
        collider.maxX = Math.max(...xs) + 0.02;
        collider.minZ = Math.min(...zs) - 0.02;
        collider.maxZ = Math.max(...zs) + 0.02;
      },
      reset() {
        this.yaw = 0;
        this.target = 0;
        this.speed = 2.15;
        this.busy = 0;
        this.locked = !!locked;
        this.group.rotation.y = 0;
        this.sync();
      },
    };
    door.sync();
    doors[id] = door;
    return door;
  }

  // Hinge on the west jamb. closed yaw 0 extends the slab toward +X.
  // Positive yaw swings the free end toward -Z, into the north rooms / into the foyer.
  makeDoor('study', -6.775 - 0.61, zN, 1.16, false);
  makeDoor('bedroom', -0.61, zN, 1.16, false);
  makeDoor('front', -0.61, 7.86, 1.16, true);

  function makeKey(id, spots) {
    const g = new THREE.Group();
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.012, 6, 10), mats.metal);
    bow.rotation.x = Math.PI / 2;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.13), mats.metal);
    shaft.position.z = 0.07;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.028), mats.metal);
    tooth.position.set(0, -0.02, 0.11);
    g.add(bow, shaft, tooth);
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.castShadow = false;
    hit.layers.set(1);
    g.add(hit);
    g.traverse((o) => {
      if (o.isMesh && o !== hit) o.castShadow = true;
    });
    scene.add(g);
    const key = { id, group: g, spots, taken: false };
    g.userData = { kind: 'key', id, ref: key };
    rayMeshes.push(g);
    keys.push(key);
    return key;
  }

  function makeBattery(id, x, y, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 8), mats.iron);
    body.rotation.z = Math.PI / 2;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), mats.led);
    led.position.x = 0.06;
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 6, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.layers.set(1);
    g.add(body, led, hit);
    g.position.set(x, y, z);
    scene.add(g);
    const item = { id, group: g, home: { x, y, z }, taken: false };
    g.userData = { kind: 'battery', id, ref: item };
    rayMeshes.push(g);
    batteries.push(item);
    return item;
  }

  function makeNote(id, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.26), mats.paper);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const note = NOTES[id];
    mesh.userData = { kind: 'note', id, title: note.title, body: note.body };
    scene.add(mesh);
    rayMeshes.push(mesh);
  }

  // —— Study ——
  box(1.35, 0.74, 0.66, mats.wood, -8.15, 0.37, -6.9);
  box(0.42, 0.46, 0.42, mats.wood, -8.15, 0.23, -6.25, { block: false });
  box(0.4, 1.9, 1.45, mats.wood, -9.55, 0.95, -4.15);
  {
    const books = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.55), mats.books);
    books.position.set(-9.32, 0.98, -4.15);
    books.rotation.y = Math.PI / 2;
    scene.add(books);
  }
  box(0.72, 0.42, 0.72, mats.cloth, -4.55, 0.28, -6.45);
  box(0.72, 0.5, 0.12, mats.cloth, -4.55, 0.62, -6.78);
  {
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mats.iron);
    globe.position.set(-8.55, 0.86, -6.95);
    globe.castShadow = true;
    scene.add(globe);
  }
  candle(-7.7, 0.82, -6.85);
  makeNote('study', -7.65, 0.8, -6.62);
  portrait(-6.2, 1.7, -7.82, 0, 2);

  makeKey('study', [
    { x: -7.85, y: 0.82, z: -6.62 },
    { x: -9.28, y: 1.15, z: -4.15 },
    { x: -4.55, y: 0.55, z: -6.45 },
    { x: -8.0, y: 1.16, z: -7.62 },
  ]);

  // —— Bedroom ——
  box(1.5, 0.32, 2.1, mats.wood, -1.65, 0.2, -6.25);
  box(1.35, 0.16, 1.95, mats.mattress, -1.65, 0.42, -6.25);
  box(0.7, 0.1, 0.38, mats.sheet, -1.65, 0.54, -7.05, { block: false });
  box(1.5, 0.7, 0.08, mats.wood, -1.65, 0.7, -7.28);
  box(0.42, 0.52, 0.4, mats.wood, -0.55, 0.26, -6.95);
  box(0.42, 0.52, 0.4, mats.wood, -2.75, 0.26, -6.95);
  box(0.48, 0.86, 1.15, mats.wood, 2.85, 0.43, -3.85);
  box(0.5, 1.9, 1.05, mats.wood, -2.85, 0.95, -3.35);
  rug(2.2, 1.4, -0.2, -4.6);
  candle(-0.55, 0.58, -6.9);
  portrait(0.4, 1.75, -7.82, 0, 3);
  portrait(3.32, 1.6, -3.85, -Math.PI / 2, 4);

  makeKey('bedroom', [
    { x: -0.55, y: 0.58, z: -6.9 },
    { x: 2.85, y: 0.92, z: -3.85 },
    { x: -1.65, y: 0.56, z: -5.35 },
    { x: -2.85, y: 0.12, z: -2.7 },
  ]);

  // —— Kitchen ——
  box(5.2, 0.92, 0.62, mats.wood, 6.9, 0.46, -7.42);
  box(0.58, 0.92, 3.1, mats.wood, 9.35, 0.46, -5.15);
  box(0.7, 0.08, 0.55, mats.iron, 5.35, 0.96, -7.35, { block: false });
  box(0.5, 0.12, 0.38, mats.iron, 8.5, 0.98, -7.28, { block: false });
  box(1.15, 0.08, 0.7, mats.wood, 7.65, 0.74, -5.15);
  box(0.08, 0.74, 0.08, mats.wood, 7.2, 0.37, -4.9, { block: false });
  box(0.08, 0.74, 0.08, mats.wood, 8.1, 0.37, -4.9, { block: false });
  box(0.08, 0.74, 0.08, mats.wood, 7.2, 0.37, -5.4, { block: false });
  box(0.08, 0.74, 0.08, mats.wood, 8.1, 0.37, -5.4, { block: false });

  const chair = new THREE.Group();
  chair.position.set(5.85, 0, -5.15);
  {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), mats.wood);
    seat.position.y = 0.48;
    seat.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.05), mats.wood);
    back.position.set(0, 0.74, -0.18);
    back.castShadow = true;
    chair.add(seat, back);
    for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.48, 0.045), mats.wood);
      leg.position.set(lx, 0.24, lz);
      leg.castShadow = true;
      chair.add(leg);
    }
  }
  scene.add(chair);
  const chairCol = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, active: true };
  colliders.push(chairCol);
  world.chair = {
    group: chair,
    collider: chairCol,
    from: { x: 5.85, z: -5.15 },
    to: { x: 4.35, z: -5.15 },
    t: 1,
    sync() {
      const x = chair.position.x;
      const z = chair.position.z;
      chairCol.minX = x - 0.24;
      chairCol.maxX = x + 0.24;
      chairCol.minZ = z - 0.24;
      chairCol.maxZ = z + 0.24;
    },
    start() { this.t = 0; },
    reset() {
      this.t = 1;
      chair.position.set(this.from.x, 0, this.from.z);
      this.sync();
    },
  };
  world.chair.sync();

  const cabinetDoor = new THREE.Group();
  cabinetDoor.position.set(7.55, 2.05, -7.55);
  {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.62, 0.32), mats.wood);
    shell.position.set(0.52, 0, 0);
    shell.castShadow = true;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.035), mats.door);
    leaf.position.set(0.25, 0, 0.18);
    leaf.castShadow = true;
    const hinge = new THREE.Group();
    hinge.add(leaf);
    cabinetDoor.add(shell, hinge);
    world.cabinetHinge = hinge;
  }
  scene.add(cabinetDoor);
  world.cabinetOpen = 0;
  world.cabinetTarget = 0;

  candle(7.65, 0.86, -5.15);
  makeBattery('kitchen', 9.25, 1.0, -5.55);
  makeKey('kitchen', [
    { x: 8.7, y: 1.0, z: -7.28 },
    { x: 7.65, y: 0.84, z: -5.15 },
    { x: 9.32, y: 1.0, z: -4.05 },
    { x: 5.45, y: 1.02, z: -7.22 },
  ]);

  // —— Living ——
  box(2.15, 0.42, 0.78, mats.cloth, -6.85, 0.28, 7.05);
  box(2.15, 0.42, 0.14, mats.cloth, -6.85, 0.62, 7.38);
  box(1.05, 0.36, 0.58, mats.wood, -6.85, 0.2, 5.95);
  box(0.7, 0.4, 0.7, mats.cloth, -4.55, 0.28, 6.55);
  box(0.7, 0.45, 0.12, mats.cloth, -4.55, 0.6, 6.86);
  box(0.5, 1.15, 1.35, mats.stone, -9.5, 0.58, 6.45);
  box(0.7, 0.08, 1.5, mats.trim, -9.35, 1.2, 6.45, { block: false });
  box(0.38, 1.85, 1.2, mats.wood, -4.05, 0.92, 6.55);
  box(0.48, 0.58, 0.48, mats.wood, -9.15, 0.29, 3.25);
  rug(2.4, 1.6, -6.85, 6.4);
  candle(-6.85, 0.46, 5.95);
  portrait(-9.15, 1.85, 6.45, Math.PI / 2, 0);
  makeBattery('living', -9.15, 0.64, 3.25);
  {
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.1), mats.iron);
    radio.position.set(-9.15, 0.66, 3.05);
    scene.add(radio);
  }

  // —— Dining ——
  box(1.55, 0.08, 0.9, mats.wood, 6.85, 0.74, 5.45);
  box(0.08, 0.74, 0.08, mats.wood, 6.2, 0.37, 5.1, { block: false });
  box(0.08, 0.74, 0.08, mats.wood, 7.5, 0.37, 5.1, { block: false });
  box(0.08, 0.74, 0.08, mats.wood, 6.2, 0.37, 5.8, { block: false });
  box(0.08, 0.74, 0.08, mats.wood, 7.5, 0.37, 5.8, { block: false });
  box(0.42, 0.46, 0.42, mats.wood, 6.85, 0.23, 4.75, { block: false });
  box(0.42, 0.46, 0.42, mats.wood, 6.85, 0.23, 6.15, { block: false });
  box(0.42, 0.46, 0.42, mats.wood, 5.9, 0.23, 5.45, { block: false });
  box(0.42, 0.46, 0.42, mats.wood, 7.8, 0.23, 5.45, { block: false });
  box(0.46, 0.88, 1.45, mats.wood, 9.25, 0.44, 6.5);
  rug(2.2, 1.5, 6.85, 5.45);
  candle(6.85, 0.86, 5.45);
  portrait(3.72, 1.7, 6.2, Math.PI / 2, 1);
  makeBattery('dining', 9.05, 0.94, 6.5);

  // —— Hall ——
  box(0.86, 0.64, 0.34, mats.wood, -4.35, 0.32, -1.28);
  makeBattery('hall', -4.35, 0.7, -1.28);
  rug(12, 1.15, 0, 0);
  world.hallPortrait = portrait(-2.15, 1.65, -1.58, 0, 5);
  portrait(3.15, 1.65, -1.58, 0, 2);
  portrait(-5.4, 1.65, 1.58, Math.PI, 4);
  hangingBulb(-5.2, 0, 0.16);
  hangingBulb(4.6, 0.2, 0.14);

  // —— Foyer ——
  box(1.15, 0.74, 0.46, mats.wood, -2.25, 0.37, 5.7);
  makeNote('foyer', -2.25, 0.8, 5.5);
  candle(-2.55, 0.82, 5.85);
  box(0.1, 1.7, 0.1, mats.wood, 2.4, 0.85, 6.7);
  box(0.42, 2.05, 0.36, mats.wood, 2.45, 1.02, 3.3);
  rug(2.2, 3.0, 0.1, 5.6);
  portrait(3.38, 1.7, 5.3, -Math.PI / 2, 0);
  hangingBulb(0.1, 4.7, 0.2);
  {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.22, 7), mats.iron);
    pot.position.set(-2.45, 0.11, 3.5);
    pot.castShadow = true;
    scene.add(pot);
  }

  function cobweb(x, y, z, ry) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), mats.cobweb);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
  }
  cobweb(-9.6, 2.55, 7.5, 0.4);
  cobweb(9.5, 2.6, 7.4, -0.5);
  cobweb(-9.6, 2.55, -7.4, 0.8);
  cobweb(9.4, 2.6, -3.2, 2.2);
  cobweb(-2.8, 2.65, -6.4, 0.2);
  cobweb(2.2, 2.6, 1.4, 1.2);

  const lightning = new THREE.DirectionalLight(0xc5d7ef, 0);
  lightning.position.set(8, 20, 6);
  scene.add(lightning);
  world.lightning = lightning;

  const hemi = new THREE.HemisphereLight(0x1a2433, 0x000000, 0.045);
  scene.add(hemi);
  world.hemi = hemi;
  const amb = new THREE.AmbientLight(0x0c1016, 0.03);
  scene.add(amb);
  world.amb = amb;

  // Dust caught in the beam.
  const dustCount = 160;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 8;
    dustPos[i * 3 + 1] = Math.random() * 2.4;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 8;
    dustSeed[i] = Math.random() * 10;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uDir: { value: new THREE.Vector3(0, 0, -1) },
      uAngle: { value: Math.cos(0.52) },
      uOn: { value: 0 },
      uMap: { value: mats.dust },
    },
    vertexShader: `
      attribute float aSeed;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        vSeed = aSeed;
        vec4 wpos = vec4(position, 1.0);
        vWorld = wpos.xyz;
        vec4 mv = viewMatrix * wpos;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 22.0 * (0.35 / max(0.15, -mv.z));
      }
    `,
    fragmentShader: `
      uniform vec3 uCam;
      uniform vec3 uDir;
      uniform float uAngle;
      uniform float uOn;
      uniform sampler2D uMap;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        float sprite = texture2D(uMap, gl_PointCoord).a;
        vec3 toP = vWorld - uCam;
        float dist = length(toP);
        vec3 dir = toP / max(dist, 0.001);
        float d = dot(dir, normalize(uDir));
        float cone = smoothstep(uAngle - 0.02, uAngle + 0.14, d);
        float range = smoothstep(8.5, 1.2, dist) * smoothstep(0.25, 0.8, dist);
        float tw = 0.55 + 0.45 * sin(vSeed * 12.0 + vWorld.y * 6.0);
        float alpha = sprite * cone * range * tw * uOn * 0.45;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(1.0, 0.93, 0.8, alpha);
      }
    `,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  world.dust = { points: dust, pos: dustPos, mat: dustMat };

  const _eye = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function syncChair() {
    world.chair.sync();
  }

  world.flickerBulbs = (seconds) => {
    world.flickerT = Math.max(world.flickerT, seconds);
  };

  world.tiltPortrait = () => {
    world.tilt = 0.001;
  };
  world.tilt = 0;

  world.popCabinet = () => {
    world.cabinetTarget = -1.15;
  };

  world.slideChair = () => {
    world.chair.t = 0;
  };

  world.rollKeys = () => {
    for (const key of keys) {
      const spot = key.spots[(Math.random() * key.spots.length) | 0];
      key.group.position.set(spot.x, spot.y, spot.z);
      key.group.visible = true;
      key.taken = false;
    }
  };

  world.reset = () => {
    world.blackout = false;
    world.flash = 0;
    world.flickerT = 0;
    world.tilt = 0;
    world.cabinetTarget = 0;
    world.cabinetOpen = 0;
    if (world.cabinetHinge) world.cabinetHinge.rotation.y = 0;
    if (world.hallPortrait) world.hallPortrait.rotation.z = 0;
    world.chair.reset();
    for (const door of Object.values(doors)) door.reset();
    for (const bat of batteries) {
      bat.taken = false;
      bat.group.visible = true;
      bat.group.position.set(bat.home.x, bat.home.y, bat.home.z);
    }
    world.rollKeys();
  };

  world.update = (dt, time, player, lightOn) => {
    for (const door of Object.values(doors)) door.update(dt);

    if (world.chair.t < 1) {
      world.chair.t = Math.min(1, world.chair.t + dt / 0.42);
      const k = world.chair.t * world.chair.t;
      const a = world.chair.from;
      const b = world.chair.to;
      chair.position.x = a.x + (b.x - a.x) * k;
      chair.position.z = a.z + (b.z - a.z) * k;
      syncChair();
    }

    if (world.cabinetHinge) {
      const d = world.cabinetTarget - world.cabinetOpen;
      if (Math.abs(d) > 0.001) {
        world.cabinetOpen += Math.sign(d) * Math.min(Math.abs(d), dt * 3.2);
        world.cabinetHinge.rotation.y = world.cabinetOpen;
      }
    }

    if (world.tilt > 0 && world.hallPortrait) {
      world.tilt = Math.min(1, world.tilt + dt * 2.5);
      const wobble = Math.sin(world.tilt * 18) * (1 - world.tilt) * 0.08;
      world.hallPortrait.rotation.z = world.tilt * 0.2 + wobble;
    }

    world.flickerT = Math.max(0, world.flickerT - dt);
    const blackout = world.blackout;
    const flash = blackout ? 0 : world.flash;
    lightning.intensity = flash * 6.2;

    for (const w of windowLights) {
      w.light.intensity = blackout ? 0 : w.base * (0.85 + flash * 2.4);
    }
    for (const b of bulbs) {
      let n = 0.82 + Math.sin(time * 7 + b.seed) * 0.08;
      if (world.flickerT > 0 && Math.random() < 0.35) n *= Math.random();
      b.light.intensity = blackout ? 0 : b.base * n;
      b.mat.emissiveIntensity = blackout ? 0 : 1.4 * n;
    }
    for (const c of candles) {
      let n = 0.75 + Math.sin(time * 11 + c.seed) * 0.15 + Math.sin(time * 23 + c.seed) * 0.08;
      if (Math.random() < 0.02) n *= 0.55;
      c.light.intensity = blackout ? 0 : c.base * n;
      c.sprite.visible = !blackout;
      c.sprite.scale.set(0.12 + n * 0.04, 0.16 + n * 0.08, 1);
    }

    for (const key of keys) {
      if (!key.taken) key.group.rotation.y += dt * 0.7;
    }

    if (mats.rain.map) {
      mats.rain.map.offset.y = (time * 0.35) % 1;
    }

    if (player) {
      player.camera.getWorldPosition(_eye);
      player.camera.getWorldDirection(_dir);
      const pos = dustPos;
      for (let i = 0; i < dustCount; i++) {
        const i3 = i * 3;
        pos[i3 + 1] += dt * 0.08;
        if (pos[i3 + 1] > 2.5) pos[i3 + 1] = 0.15;
        const dx = pos[i3] - _eye.x;
        const dz = pos[i3 + 2] - _eye.z;
        if (dx * dx + dz * dz > 36) {
          pos[i3] = _eye.x + (Math.random() - 0.5) * 7;
          pos[i3 + 2] = _eye.z + (Math.random() - 0.5) * 7;
        }
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.uniforms.uCam.value.copy(_eye);
      dustMat.uniforms.uDir.value.copy(_dir);
      dustMat.uniforms.uOn.value = lightOn && !blackout ? 1 : 0;
    }
  };

  world.rollKeys();
  return world;
}
