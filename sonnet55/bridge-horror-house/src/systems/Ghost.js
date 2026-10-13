// The Entity: a tall, gaunt figure. Visuals + the apparition / stalk / chase / banish / reform behaviour.
import * as THREE from 'three';
import { Tex, mulberry32 } from '../world/Textures.js';

const lerp = (a, b, k) => a + (b - a) * k;
const EYE_COL = new THREE.Color(3.4, 3.1, 2.2);

function tatterGeo(r, w, len) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0);
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const x = (w / 2) * (1 - (i / n) * 2) * (0.35 + 0.65 * (1 - i / (n * 1.4)));
    s.lineTo(x, -len * (i % 2 ? 0.62 + r() * 0.15 : 0.9 + r() * 0.1));
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export class Ghost {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.visible = false;
    scene.add(this.group);
    this.state = 'hidden';
    this.pos = this.group.position;
    this.burn = 0; this.burning = false;
    this.life = 0; this.t = 0; this.phase = Math.random() * 10; this.lurch = 0; this.grace = 0;
    this.reformT = 0; this.bansihAnim = 0; this.expr = 0; this.exprT = 0;
    this.glitch = 0; this.visibleNow = false; this.fade = 0; this.speedNow = 0;
    this.onBanish = null; this.onCaught = null; this.onLunge = null; this.onVanish = null; this.onReform = null; this.pickSpawn = null;
    this.rng = mulberry32(777);
    this.pose = { sx: 0, ex: 0, sz: 0.1, lean: 0 };
    this.emberPool = [];
    this.build();
  }

  build() {
    const r = this.rng;
    const robe = new THREE.MeshStandardMaterial({ map: Tex.cloth(), color: 0xb8b8c0, roughness: 1, emissive: 0x020203, side: THREE.DoubleSide });
    const bone = new THREE.MeshStandardMaterial({ color: 0x55574f, roughness: 0.8, emissive: 0x090b0a });
    const ribMat = new THREE.MeshStandardMaterial({ map: Tex.ribs(), roughness: 0.85, emissive: 0x070707 });
    this.robeMat = robe; this.boneMat = bone;
    const body = (this.body = new THREE.Group()); this.group.add(body);
    const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

    // narrow, ragged under-skirt (mostly lost in black vapor)
    const sk = new THREE.CylinderGeometry(0.2, 0.36, 1.5, 12, 5, true);
    const p = sk.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -0.1) { const k = (-0.1 - y) / 0.65; p.setXYZ(i, p.getX(i) * (1 + (r() - 0.5) * 0.5 * k), y - r() * 0.35 * k, p.getZ(i) * (1 + (r() - 0.5) * 0.5 * k)); } }
    sk.computeVertexNormals();
    this.skirt = add(sk, robe, 0, 0.76, 0);
    // emaciated torso with showing ribs, shoulders, neck
    add(new THREE.CylinderGeometry(0.15, 0.11, 0.85, 12), ribMat, 0, 1.86, 0);
    add(new THREE.BoxGeometry(0.62, 0.1, 0.18), robe, 0, 2.28, 0);
    add(new THREE.CylinderGeometry(0.04, 0.055, 0.34, 8), bone, 0, 2.46, 0);
    const headG = new THREE.Group(); headG.position.set(0, 2.66, 0); body.add(headG); this.head = headG;
    const headGeo = new THREE.SphereGeometry(0.16, 20, 16); headGeo.scale(0.85, 1.45, 0.95);
    add(headGeo, bone, 0, 0, 0, headG);
    this.faceMat = new THREE.MeshStandardMaterial({ map: Tex.entityFace(0), roughness: 0.7, emissive: 0x1a1d1c, emissiveMap: Tex.entityFace(0) });
    const face = new THREE.SphereGeometry(0.1625, 24, 18, Math.PI / 2 - 0.95, 1.9, 0.35, 2.1); face.scale(0.85, 1.45, 0.95);
    const faceMesh = add(face, this.faceMat, 0, 0, 0, headG); faceMesh.castShadow = false;
    // eyes (bloom)
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 8, 6), new THREE.MeshBasicMaterial({ color: EYE_COL.clone(), toneMapped: false }));
      e.position.set(sx * 0.038, 0.047, 0.136); headG.add(e); this.eyes.push(e);
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.glow(), color: new THREE.Color(1.2, 1.1, 0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
      h.scale.set(0.16, 0.16, 1); e.add(h);
    }
    // arms
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group(); shoulder.position.set(sx * 0.33, 2.2, 0); body.add(shoulder);
      add(new THREE.CylinderGeometry(0.036, 0.028, 0.78, 6), bone, 0, -0.39, 0, shoulder);
      const elbow = new THREE.Group(); elbow.position.set(0, -0.78, 0); shoulder.add(elbow);
      add(new THREE.CylinderGeometry(0.028, 0.02, 0.9, 6), bone, 0, -0.45, 0, elbow);
      const hand = new THREE.Group(); hand.position.set(0, -0.9, 0); elbow.add(hand);
      add(new THREE.BoxGeometry(0.07, 0.11, 0.03), bone, 0, -0.04, 0, hand);
      const fingers = [];
      for (let i = 0; i < 5; i++) {
        const f = new THREE.Group(); f.position.set((i - 2) * 0.016, -0.1, 0); hand.add(f);
        const len = 0.2 + (i === 2 ? 0.05 : 0) - (i === 4 ? 0.05 : 0);
        const cone = add(new THREE.CylinderGeometry(0.004, 0.011, len, 5), bone, 0, -len / 2, 0, f); cone.castShadow = false;
        f.userData.base = (i - 2) * 0.13; fingers.push(f);
      }
      this.arms.push({ sx, shoulder, elbow, hand, fingers });
    }
    // tatters: lots of long ragged strips hanging from shoulders, ribs and waist
    this.tatters = [];
    for (let i = 0; i < 38; i++) {
      let a = r() * Math.PI * 2; const kind = i % 4;
      if ((kind === 0 || kind === 1) && Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 1.0) a += Math.PI; // keep the ribcage bare at the front
      const rad = kind === 0 ? 0.26 : 0.18 + r() * 0.1, y = kind === 0 ? 2.25 : kind === 1 ? 1.95 : 1.55 + r() * 0.15;
      const len = kind === 0 ? 0.7 + r() * 0.9 : 0.8 + r() * 0.9;
      const g = tatterGeo(r, 0.05 + r() * 0.09, len);
      const m = new THREE.Mesh(g, robe); m.castShadow = false;
      const pv = new THREE.Group(); pv.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad); pv.rotation.y = -a + Math.PI / 2; pv.add(m); body.add(pv);
      this.tatters.push({ pv, ph: r() * 6, amp: 0.08 + r() * 0.22 });
    }
    // vapor
    this.vapor = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.smoke(i % 3), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
      const sc = 0.9 + r() * 0.9; s.scale.set(sc, sc, 1);
      this.group.add(s); this.vapor.push({ s, a: r() * 6.3, rad: 0.15 + r() * 0.45, h: r(), sp: 0.3 + r() * 0.5, sc });
    }
    // embers (burn feedback)
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.dust(), color: new THREE.Color(3, 1.4, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      s.scale.set(0.05, 0.05, 1); s.visible = false; this.scene.add(s);
      this.emberPool.push({ s, v: new THREE.Vector3(), life: 0 });
    }
    this.group.scale.setScalar(0.98);
  }

  get head3() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.7, this.pos.z); }
  get isActive() { return this.state === 'stalk' || this.state === 'chase' || this.state === 'apparition'; }
  get burnable() { return this.state === 'stalk' || this.state === 'chase'; }

  setExpression(i) { if (i === this.expr) return; this.expr = i; this.faceMat.map = Tex.entityFace(i); this.faceMat.emissiveMap = this.faceMat.map; this.faceMat.needsUpdate = true; }

  // ------------------------------------------------------------ commands
  appear(pos, { duration = 1.2, expression = 0, yaw = null } = {}) {
    this.state = 'apparition'; this.life = duration; this.t = 0; this.fade = 0; this.burn = 0;
    this.pos.set(pos.x, 0, pos.z); this.forcedYaw = yaw; this.group.visible = true; this.setExpression(expression);
  }
  startStalk(pos, duration = 8) {
    this.state = 'stalk'; this.life = duration; this.t = 0; this.fade = 0; this.burn = 0; this.forcedYaw = null;
    this.pos.set(pos.x, 0, pos.z); this.group.visible = true; this.setExpression(0); this.speedNow = 0.5;
  }
  startChase(pos) {
    this.state = 'chase'; this.t = 0; this.fade = 0; this.burn = 0; this.grace = 1.4; this.forcedYaw = null; this.speedNow = 1;
    this.pos.set(pos.x, 0, pos.z); this.group.visible = true; this.setExpression(1);
  }
  vanish() {
    const was = this.state; this.state = 'hidden'; this.group.visible = false; this.burn = 0; this.burning = false;
    if (was !== 'hidden') this.onVanish?.(was);
  }
  banish() {
    const was = this.state;
    this.state = 'banished'; this.bansihAnim = 0.55; this.burn = 0; this.setExpression(2); this.wasChase = was === 'chase';
    this.onBanish?.(was);
  }
  reset() { this.state = 'hidden'; this.group.visible = false; this.burn = 0; this.reformT = 0; this.emberPool.forEach((e) => { e.s.visible = false; e.life = 0; }); }

  // ------------------------------------------------------------ per frame
  update(dt, time, P, inBeam) {
    const dx = P.x - this.pos.x, dz = P.z - this.pos.z, dist = Math.hypot(dx, dz);
    this.dist = dist;
    this.burning = false;

    if (this.state === 'reform') {
      this.reformT -= dt;
      if (this.reformT <= 0) {
        const sp = this.pickSpawn ? this.pickSpawn() : new THREE.Vector3(0, 0, -5);
        this.startChase(sp); this.onReform?.();
      }
      this.animateEmbers(dt); return;
    }
    if (this.state === 'hidden') { this.animateEmbers(dt); return; }

    this.t += dt;
    if (this.state === 'banished') {
      this.bansihAnim -= dt;
      this.visibleNow = Math.random() < 0.5; this.group.visible = this.visibleNow;
      this.body.position.x = (Math.random() - 0.5) * 0.12; this.setPoseTarget('scream', time);
      this.spawnEmbers(this.head3, 2);
      if (this.bansihAnim <= 0) {
        this.body.position.x = 0;
        if (this.wasChase) { this.state = 'reform'; this.reformT = 8; this.group.visible = false; }
        else this.vanish();
      }
      this.animate(dt, time, dx, dz);
      this.animateEmbers(dt); return;
    }

    // fade-in: flicker like a corrupted frame
    this.fade = Math.min(1, this.fade + dt / 0.35);
    const flickerIn = this.fade < 1 && Math.random() > this.fade * 0.9;
    let glitchP = this.state === 'chase' ? 0.07 : this.state === 'stalk' ? 0.045 : 0.03;
    if (this.burning || inBeam) glitchP += 0.15;
    let hide = flickerIn;
    if (this.state === 'apparition' && this.life < 0.18) hide = Math.random() < 0.6; // flicker out
    if (Math.random() < glitchP) { hide = hide || Math.random() < 0.5; this.glitch = 0.08; }
    this.glitch = Math.max(0, this.glitch - dt);
    this.visibleNow = !hide; this.group.visible = this.visibleNow;
    this.body.scale.set(1 + (this.glitch > 0 ? (Math.random() - 0.5) * 0.35 : 0), 1 + (this.glitch > 0 ? (Math.random() - 0.5) * 0.12 : 0), 1);

    // facing
    const yawTo = Math.atan2(dx, dz);
    this.group.rotation.y = this.forcedYaw != null ? this.forcedYaw : yawTo + (this.state === 'chase' ? Math.sin(time * 3.1 + this.phase) * 0.18 : 0);

    // ---- burn meter
    if (this.burnable) {
      const rate = this.state === 'chase' ? 0.62 : 0.85;
      if (inBeam) { this.burn = Math.min(1, this.burn + rate * dt); this.burning = true; }
      else this.burn = Math.max(0, this.burn - 0.4 * dt);
      if (this.burn >= 1) { this.banish(); return; }
    }

    if (this.state === 'apparition') {
      this.life -= dt;
      this.setPoseTarget('hang', time);
      if (this.life <= 0) this.vanish();
    } else if (this.state === 'stalk') {
      this.life -= dt;
      const sp = (this.burning ? 0.25 : 1.15 + 0.4 * (1 - Math.min(1, this.life / 8)));
      this.speedNow = lerp(this.speedNow, sp, Math.min(1, dt * 4));
      if (dist > 1.5) { this.pos.x += (dx / dist) * this.speedNow * dt; this.pos.z += (dz / dist) * this.speedNow * dt; }
      this.pos.x += Math.sin(time * 1.7 + this.phase) * 0.004;
      this.setPoseTarget(dist < 4.5 ? 'reach' : 'hang', time);
      this.setExpression(dist < 5 ? 1 : 0);
      if (dist < 2.1) { this.onLunge?.(); this.vanish(); }
      else if (this.life <= 0) this.vanish();
    } else if (this.state === 'chase') {
      this.grace = Math.max(0, this.grace - dt);
      this.lurch += dt * (2.4 + Math.min(1, this.t / 20));
      const burst = Math.pow(Math.max(0, Math.sin(this.lurch)), 1.5);
      let sp = (3.05 + Math.min(0.7, this.t * 0.03)) * (0.28 + 1.35 * burst);
      if (this.grace > 0) sp *= 0.35;
      if (this.burning) sp *= 0.3;
      this.speedNow = lerp(this.speedNow, sp, Math.min(1, dt * 9));
      // weave perpendicular
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      const wv = Math.sin(time * 2.2 + this.phase) * Math.min(1, dist / 5) * 0.7;
      let mx = nx - nz * wv, mz = nz + nx * wv; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      this.pos.x += mx * this.speedNow * dt; this.pos.z += mz * this.speedNow * dt;
      if (this.burning) { this.pos.x -= nx * 0.7 * dt; this.pos.z -= nz * 0.7 * dt; }
      this.exprT -= dt; if (this.exprT <= 0) { this.setExpression(dist < 3.5 ? 2 : (Math.random() < 0.5 ? 1 : 0)); this.exprT = 0.35 + Math.random() * 0.5; }
      this.setPoseTarget(dist < 5 ? 'lunge' : 'reach', time);
      if (dist < 0.85 && this.grace <= 0) { this.state = 'hidden'; this.group.visible = false; this.onCaught?.(); return; }
    }
    if (this.burning) this.spawnEmbers(new THREE.Vector3(this.pos.x, 1.2 + Math.random() * 1.4, this.pos.z), 1);
    this.animate(dt, time, dx, dz);
    this.animateEmbers(dt);
  }

  setPoseTarget(mode, time) { this.mode = mode; }

  animate(dt, time, dx, dz) {
    const mode = this.mode || 'hang', k = Math.min(1, dt * 7);
    const tgt = { hang: { sx: 0.06, ex: -0.12, sz: 0.1, lean: 0 }, reach: { sx: -1.15, ex: -0.5, sz: 0.1, lean: 0.12 }, lunge: { sx: -1.5, ex: -0.12, sz: 0.14, lean: 0.3 }, scream: { sx: -0.5, ex: -0.4, sz: 0.9, lean: -0.2 } }[mode];
    for (const key of ['sx', 'ex', 'sz', 'lean']) this.pose[key] = lerp(this.pose[key], tgt[key], k);
    const w = Math.sin(time * 5 + this.phase), tremble = (this.burning ? 0.1 : 0.02);
    this.arms.forEach((a) => {
      const side = a.sx;
      a.shoulder.rotation.x = this.pose.sx + w * 0.08 * side + (Math.random() - 0.5) * tremble;
      a.shoulder.rotation.z = side * this.pose.sz + Math.sin(time * 1.3 + side) * 0.03;
      a.elbow.rotation.x = this.pose.ex + Math.sin(time * 2.1 + side) * 0.07;
      a.fingers.forEach((f, i) => { f.rotation.z = f.userData.base * (1 + (mode === 'scream' || mode === 'lunge' ? 1.4 : 0.4)); f.rotation.x = -0.3 - 0.25 * Math.sin(time * 3 + i + side); });
    });
    this.body.rotation.x = this.pose.lean + Math.sin(time * 2.4 + this.phase) * 0.03;
    this.body.rotation.z = Math.sin(time * 1.5 + this.phase) * 0.04 + (this.state === 'chase' ? Math.sin(this.lurch) * 0.08 : 0);
    this.body.position.y = Math.sin(time * 1.6 + this.phase) * 0.04 + (this.state === 'chase' ? Math.abs(Math.sin(this.lurch)) * 0.1 : 0);
    this.head.rotation.z = Math.sin(time * 0.9 + this.phase) * 0.12 + (this.state === 'chase' ? Math.sin(time * 6) * 0.1 : 0);
    this.head.rotation.x = 0.1 + (this.state === 'chase' ? 0.12 : 0);
    // tatters sway
    this.tatters.forEach((tt) => { tt.pv.rotation.x = Math.sin(time * 1.8 + tt.ph) * tt.amp * (this.state === 'chase' ? 2.2 : 1) + (this.state === 'chase' ? 0.35 : 0); });
    // eyes
    const burnFlare = this.burning ? 1.8 : 1;
    this.eyes.forEach((e, i) => { const f = (0.85 + 0.15 * Math.sin(time * 9 + i * 2)) * burnFlare; e.material.color.setRGB(EYE_COL.r * f, EYE_COL.g * f, EYE_COL.b * f); });
    // burn heat on robe
    const heat = this.burn;
    this.robeMat.emissive.setRGB(0.02 + heat * 0.32, 0.022 + heat * 0.1, 0.03 + heat * 0.02);
    this.boneMat.emissive.setRGB(0.035 + heat * 0.45, 0.04 + heat * 0.18, 0.04 + heat * 0.05);
    this.faceMat.emissive.setRGB(0.07 + heat * 0.5, 0.075 + heat * 0.22, 0.075);
    // vapor
    this.vapor.forEach((v) => {
      v.a += dt * v.sp * 0.6; const h = (v.h + time * 0.07 * v.sp) % 1;
      v.s.position.set(Math.cos(v.a) * v.rad * (0.8 + h), 0.15 + h * 1.5, Math.sin(v.a) * v.rad * (0.8 + h));
      v.s.material.opacity = 0.5 * (1 - h * 0.7); const sc = v.sc * (0.8 + h * 0.8); v.s.scale.set(sc, sc, 1);
    });
  }

  spawnEmbers(at, n) {
    for (let i = 0; i < n; i++) {
      const e = this.emberPool.find((p) => p.life <= 0); if (!e) return;
      e.life = 0.5 + Math.random() * 0.5; e.s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4));
      e.v.set((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6); e.s.visible = true;
    }
  }
  animateEmbers(dt) {
    for (const e of this.emberPool) {
      if (e.life <= 0) { e.s.visible = false; continue; }
      e.life -= dt; e.s.position.addScaledVector(e.v, dt); e.s.material.opacity = Math.max(0, e.life * 1.6);
    }
  }
}
