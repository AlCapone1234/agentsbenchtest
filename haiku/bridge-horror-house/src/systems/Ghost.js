import * as THREE from 'three';

// The entity. Modes:
//   apparition: scripted, brief appearance in a doorway
//   dormant:    stalk phase, out of sight, counting down to the next manifestation
//   manifest:   stalk phase, walks the house toward the player along a flow field
//   chase:      finale, glides straight through walls with a weaving lurch
//   respite:    banished, invisible, counting down
//   off:        not in the house

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const VAPOR_N = 70;
const CAUGHT_DIST = 0.95;

function limb(r0, r1, len, mat) {
  const geo = new THREE.CylinderGeometry(r0, r1, len, 7);
  geo.translate(0, -len / 2, 0); // pivot at the top so joints hinge correctly
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export class Ghost {
  constructor(scene, house, tex, audio, callbacks) {
    this.house = house;
    this.audio = audio;
    this.onCaught = callbacks.onCaught;

    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    this.x = 0;
    this.z = 0;
    this.facing = 0;
    this.mode = 'off';
    this.timer = 0;
    this.fade = 0;
    this.glitchT = 0;
    this.glitchHide = false;
    this.burn = 0;
    this.expr = 'neutral';
    this.exprT = 0;
    this.speedNow = 0;
    this.phase = 0;
    this.stepT = 0;
    this.stalkActive = false;
    this.chaseActive = false;
    this.manifests = 0;
    this.stepSpan = [16, 24];
    this.chaseSpeed = 3.0;
    this.weaveT = 0;
    this.manifestT = 0;

    this.buildMaterials(tex);
    this.buildBody();
    this.buildVapor();
  }

  buildMaterials(tex) {
    this.faces = tex.faces;
    this.fleshMat = new THREE.MeshStandardMaterial({ color: 0x171411, roughness: 0.9, transparent: true });
    this.clothMat = new THREE.MeshStandardMaterial({ color: 0x1b1815, roughness: 1, side: THREE.DoubleSide, transparent: true });
    this.faceMat = new THREE.MeshStandardMaterial({ map: this.faces.neutral, roughness: 0.85, transparent: true });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.4, 0.12), transparent: true });
    this.vaporMat = new THREE.PointsMaterial({
      map: tex.vapor,
      color: 0x111113,
      size: 0.4,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.allMats = [this.fleshMat, this.clothMat, this.faceMat, this.eyeMat, this.vaporMat];
  }

  buildBody() {
    const flesh = this.fleshMat;
    const r = this.root;

    // Legs hang from the hips at y = 1.15
    this.hips = new THREE.Group();
    this.hips.position.y = 1.15;
    r.add(this.hips);
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.x = s * 0.12;
      leg.add(limb(0.045, 0.03, 1.15, flesh));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.22), flesh);
      foot.position.set(0, -1.17, 0.05);
      foot.castShadow = true;
      leg.add(foot);
      this.hips.add(leg);
      this.legs.push(leg);
    }

    // Torso leans as one piece. Its origin is the bottom of the ribcage.
    this.torso = new THREE.Group();
    this.torso.position.y = 1.15;
    r.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.07, 1.3, 8), flesh);
    chest.position.y = 0.65;
    chest.castShadow = true;
    this.torso.add(chest);

    // Head and neck
    this.head = new THREE.Group();
    this.head.position.y = 1.45;
    this.torso.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 6), flesh);
    neck.position.y = -0.1;
    this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), flesh);
    skull.scale.set(0.85, 1.2, 0.9);
    skull.position.y = 0.16;
    skull.castShadow = true;
    this.head.add(skull);
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), this.faceMat);
    this.face.position.set(0, 0.16, 0.12);
    this.head.add(this.face);
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), this.eyeMat);
      eye.position.set(s * 0.045, 0.2, 0.125);
      this.head.add(eye);
      this.eyes.push(eye);
    }

    // Long arms ending in four claws each
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.17, 1.2, 0);
      this.torso.add(shoulder);
      shoulder.add(limb(0.035, 0.028, 0.8, flesh));
      const elbow = new THREE.Group();
      elbow.position.y = -0.8;
      shoulder.add(elbow);
      elbow.add(limb(0.03, 0.02, 0.78, flesh));
      const hand = new THREE.Group();
      hand.position.y = -0.78;
      elbow.add(hand);
      for (let k = 0; k < 4; k++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.16, 5), flesh);
        claw.rotation.set(Math.PI, 0, (k - 1.5) * 0.15);
        claw.position.set((k - 1.5) * 0.022, -0.08, 0);
        claw.castShadow = true;
        hand.add(claw);
      }
      this.arms.push({ shoulder, elbow, hand, side: s });
    }

    // Tattered strips hanging from the torso
    this.strips = [];
    for (let k = 0; k < 12; k++) {
      const y = 0.35 + Math.random() * 0.9;
      const a = Math.random() * Math.PI * 2;
      const rad = 0.08 + 0.06 * (y / 1.3);
      const len = 0.5 + Math.random() * 0.5;
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      g.rotation.y = a;
      const geo = new THREE.PlaneGeometry(0.07, len);
      geo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(geo, this.clothMat);
      m.position.z = 0.01;
      g.add(m);
      this.torso.add(g);
      this.strips.push(g);
    }
  }

  buildVapor() {
    const pos = new Float32Array(VAPOR_N * 3);
    this.vVel = new Float32Array(VAPOR_N * 3);
    this.vLife = new Float32Array(VAPOR_N);
    this.vMax = new Float32Array(VAPOR_N);
    this.vaporGeo = new THREE.BufferGeometry();
    this.vaporGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.vapor = new THREE.Points(this.vaporGeo, this.vaporMat);
    this.vapor.frustumCulled = false;
    this.root.add(this.vapor);
    for (let i = 0; i < VAPOR_N; i++) {
      this.respawnVapor(i);
      this.vLife[i] = Math.random() * this.vMax[i];
    }
  }

  respawnVapor(i) {
    const p = this.vaporGeo.attributes.position.array;
    const a = Math.random() * Math.PI * 2;
    const r = 0.15 + Math.random() * 0.45;
    p[i * 3] = Math.cos(a) * r;
    p[i * 3 + 1] = Math.random() * 2.6;
    p[i * 3 + 2] = Math.sin(a) * r;
    this.vVel[i * 3] = (Math.random() - 0.5) * 0.1;
    this.vVel[i * 3 + 1] = 0.12 + Math.random() * 0.15;
    this.vVel[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    this.vLife[i] = 0;
    this.vMax[i] = 2 + Math.random() * 2;
  }

  reset() {
    this.mode = 'off';
    this.timer = 0;
    this.fade = 0;
    this.glitchT = 0;
    this.burn = 0;
    this.expr = 'neutral';
    this.exprT = 0;
    this.stalkActive = false;
    this.chaseActive = false;
    this.manifests = 0;
    this.stepSpan = [16, 24];
    this.chaseSpeed = 3.0;
    this.weaveT = 0;
    this.manifestT = 0;
    this.root.visible = false;
    this.faceMat.map = this.faces.neutral;
  }

  // True while the entity is in view and can be burned.
  isShown() {
    const shown = this.mode === 'apparition' || this.mode === 'manifest' || this.mode === 'chase';
    return shown && this.fade > 0.5;
  }

  // Scripted: appear in a doorway, face (lookX, lookZ), vanish after dur seconds.
  appear(x, z, lookX, lookZ, dur) {
    this.mode = 'apparition';
    this.timer = dur;
    this.x = x;
    this.z = z;
    this.facing = Math.atan2(lookX - x, lookZ - z);
    this.glitchT = 0.3;
    this.exprT = 1.0;
  }

  beginStalk() {
    this.stalkActive = true;
    this.stepSpan = [16, 24];
    this.manifests = 0;
    this.mode = 'dormant';
    this.timer = 5;
  }

  beginChase(player) {
    this.stalkActive = false;
    this.chaseActive = true;
    this.chaseSpeed = 3.0;
    this.weaveT = 0;
    this.house.updateField(player.x, player.z);
    this.placeFar(player.x, player.z, player.yaw, 20, 28, 9);
    this.mode = 'chase';
    this.glitchT = 0.6;
    this.exprT = 0;
  }

  // Spawns out of the player's view, at a path distance in [minS, maxS] steps (1 step = 0.5m),
  // and at least minDist metres away in a straight line (the chase glides through walls).
  placeFar(px, pz, yaw, minS, maxS, minDist = 0) {
    let c = null;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let i = 0; i < 12 && !c; i++) {
      const cand = this.house.randomCell(minS, maxS);
      if (!cand) break;
      const dx = cand.x - px, dz = cand.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      if (d < minDist && i < 10) continue;
      const inView = (dx * fx + dz * fz) / d > 0.35;
      if (!inView || i >= 8) c = cand;
    }
    if (!c) c = this.house.randomCell(2, 60);
    if (c) {
      this.x = c.x;
      this.z = c.z;
    }
    this.facing = Math.atan2(px - this.x, pz - this.z);
  }

  // Banished: shriek, vanish, then respite. Stalk respite also drifts it closer next time.
  banish() {
    this.audio.shriek();
    this.burn = 0;
    this.exprT = 1.5;
    if (this.mode === 'chase') {
      this.mode = 'respite';
      this.timer = 8;
    } else if (this.mode === 'manifest' || this.mode === 'apparition') {
      this.mode = 'respite';
      this.timer = 14;
      this.stepSpan = [Math.max(10, this.stepSpan[0] - 2), Math.max(14, this.stepSpan[1] - 2)];
    }
  }

  // Burn progress 0..1, set every frame by Game while the beam is on the entity.
  setBurn(v) {
    this.burn = v;
  }

  stalkDelay() {
    const base = Math.max(4, 9 - this.manifests * 0.25);
    return base + Math.random() * 4;
  }

  manifest(player) {
    this.house.updateField(player.x, player.z);
    this.placeFar(player.x, player.z, player.yaw, this.stepSpan[0], this.stepSpan[1]);
    this.mode = 'manifest';
    this.manifestT = 0;
    this.glitchT = 0.35;
    this.exprT = 0;
    this.manifests++;
    this.stepSpan = [Math.max(10, this.stepSpan[0] - 1), Math.max(14, this.stepSpan[1] - 1)];
  }

  caught() {
    if (this.mode === 'off' || this.mode === 'caught') return;
    this.mode = 'caught';
    this.onCaught();
  }

  distanceTo(px, pz) {
    return Math.hypot(px - this.x, pz - this.z);
  }

  moveToward(tx, tz, step) {
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const s = Math.min(step, d);
    this.x += (dx / d) * s;
    this.z += (dz / d) * s;
    this.facing = Math.atan2(dx, dz);
  }

  // player: { x, z, yaw }
  update(dt, t, player) {
    const px = player.x, pz = player.z;
    const preX = this.x, preZ = this.z;

    const shown = this.mode === 'apparition' || this.mode === 'manifest' || this.mode === 'chase';
    this.fade += ((shown ? 1 : 0) - this.fade) * Math.min(1, dt * (shown ? 10 : 6));

    switch (this.mode) {
      case 'apparition':
        this.timer -= dt;
        if (this.timer <= 0) this.mode = 'off';
        break;
      case 'dormant':
        this.timer -= dt;
        if (this.timer <= 0) this.manifest(player);
        break;
      case 'manifest': {
        this.manifestT += dt;
        this.house.updateField(px, pz);
        const next = this.house.nextStep(this.x, this.z);
        if (next) this.moveToward(next.x, next.z, (this.burn > 0 ? 0.3 : 1.1) * dt);
        if (this.distanceTo(px, pz) < CAUGHT_DIST) {
          this.caught();
          return;
        }
        if (this.manifestT > 26) {
          this.mode = 'dormant';
          this.timer = this.stalkDelay();
        }
        break;
      }
      case 'chase': {
        const dx = px - this.x, dz = pz - this.z;
        const d = Math.hypot(dx, dz) || 0.001;
        this.weaveT += dt;
        const weave = Math.sin(this.weaveT * 2.1) * 1.1 * clamp(d / 4, 0.25, 1);
        const tx = px + (-dz / d) * weave;
        const tz = pz + (dx / d) * weave;
        this.moveToward(tx, tz, this.chaseSpeed * (this.burn > 0 ? 0.45 : 1) * dt);
        this.chaseSpeed = Math.min(3.7, this.chaseSpeed + 0.02 * dt);
        this.facing = Math.atan2(dx, dz);
        if (this.distanceTo(px, pz) < CAUGHT_DIST) {
          this.caught();
          return;
        }
        break;
      }
      case 'respite':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.chaseActive) {
            this.house.updateField(px, pz);
            this.placeFar(px, pz, player.yaw, 20, 28, 9);
            this.mode = 'chase';
            this.glitchT = 0.6;
          } else if (this.stalkActive) {
            this.mode = 'dormant';
            this.timer = this.stalkDelay();
          } else {
            this.mode = 'off';
          }
        }
        break;
      default:
        break;
    }

    this.speedNow = Math.hypot(this.x - preX, this.z - preZ) / Math.max(dt, 1e-4);
    this.animate(dt, t, px, pz);
  }

  animate(dt, t, px, pz) {
    const root = this.root;
    const chasing = this.mode === 'chase';
    const k = clamp(this.speedNow / 1.1, 0, 1.3);

    // Turn toward facing
    let diff = wrapAngle(this.facing - root.rotation.y);
    root.rotation.y += diff * Math.min(1, dt * 6);
    root.position.set(this.x, 0, this.z);

    // Glitch: a corrupted-frame flicker while appearing or reforming
    if (this.glitchT > 0) {
      this.glitchT -= dt;
      root.position.x += (Math.random() - 0.5) * 0.08;
      root.position.z += (Math.random() - 0.5) * 0.08;
      this.glitchHide = Math.random() < 0.35;
    } else {
      this.glitchHide = false;
    }
    root.visible = this.fade > 0.02 && !this.glitchHide;
    for (const m of this.allMats) m.opacity = m === this.vaporMat ? 0.5 * this.fade : this.fade;

    // Gait
    this.phase += this.speedNow * dt * 2.2;
    const swing = Math.sin(this.phase) * 0.55 * k;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.hips.position.y = 1.15 + Math.abs(Math.sin(this.phase)) * 0.03 * k;

    const lean = chasing ? 0.22 : 0.05 * k;
    this.torso.rotation.x += (lean - this.torso.rotation.x) * Math.min(1, dt * 5);
    this.head.rotation.z = Math.sin(t * 0.7) * 0.1;
    this.head.rotation.x = this.burn > 0 ? Math.sin(t * 25) * 0.15 * this.burn : Math.sin(t * 1.1) * 0.04;

    // Arms: reach forward in the chase, sway otherwise
    for (const arm of this.arms) {
      const i = arm.side > 0 ? 1 : 0;
      if (chasing) {
        arm.shoulder.rotation.x = -1.25 + Math.sin(t * 9 + i) * 0.08;
      } else {
        arm.shoulder.rotation.x = -0.15 + Math.sin(t * 1.3 + i) * 0.08 + swing * 0.4 * (i ? 1 : -1);
      }
      arm.elbow.rotation.x = chasing ? -0.2 : -0.1;
      arm.hand.rotation.x = Math.sin(t * 6 + i) * 0.15;
    }

    // Strips flutter; they stream back when it runs
    for (let i = 0; i < this.strips.length; i++) {
      this.strips[i].rotation.x = Math.sin(t * 2.3 + i * 0.7) * 0.25 + (chasing ? 0.6 : k * 0.3);
    }

    // Face: scream in the chase or under the beam, grin briefly after a banish
    let want = 'neutral';
    if (this.burn > 0.05 || chasing) want = 'scream';
    else if (this.exprT > 0) want = 'grin';
    this.exprT = Math.max(0, this.exprT - dt);
    if (want !== this.expr) {
      this.expr = want;
      this.faceMat.map = this.faces[want];
      this.faceMat.needsUpdate = true;
    }

    // Eyes: dim under the beam, flicker when glitching
    const eyeMul = this.burn > 0 ? 0.5 : this.glitchT > 0 ? 0.3 + Math.random() : 1;
    this.eyeMat.color.setRGB(2.6 * eyeMul, 0.4 * eyeMul, 0.12 * eyeMul);

    // Footsteps
    if ((this.mode === 'manifest' || chasing) && this.speedNow > 0.3) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.audio.thud(this.x, this.z);
        this.stepT = chasing ? 0.32 : 0.6;
      }
    }

    // Breath ramps with proximity
    if (this.isShown()) {
      const d = this.distanceTo(px, pz);
      this.audio.setBreath(clamp((9 - d) / 7, 0, 1), this.x, this.z);
    } else {
      this.audio.setBreath(0, this.x, this.z);
    }

    this.updateVapor(dt);
  }

  updateVapor(dt) {
    const p = this.vaporGeo.attributes.position.array;
    for (let i = 0; i < VAPOR_N; i++) {
      this.vLife[i] += dt;
      if (this.vLife[i] > this.vMax[i]) this.respawnVapor(i);
      p[i * 3] += this.vVel[i * 3] * dt;
      p[i * 3 + 1] += this.vVel[i * 3 + 1] * dt;
      p[i * 3 + 2] += this.vVel[i * 3 + 2] * dt;
    }
    this.vaporGeo.attributes.position.needsUpdate = true;
  }
}
