import * as THREE from 'three';

const _chest = new THREE.Vector3();

/**
 * Tall gaunt figure. Local forward is -Z.
 * Facing the player: rotation.y = atan2(-dx, -dz).
 * Check: player at -Z (dx=0, dz<0) → yaw 0, local -Z points at the player.
 */
export class Ghost {
  constructor(scene, mats, spots) {
    this.spots = spots;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.body = new THREE.Group();
    this.group.add(this.body);

    const skin = mats.ghostSkin;
    const dark = mats.ghostDark;

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.05, 7), skin);
    torso.position.y = 1.15;
    torso.castShadow = true;
    this.body.add(torso);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 6), dark);
    neck.position.y = 1.72;
    neck.castShadow = true;
    this.body.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin);
    head.scale.set(0.9, 1.25, 0.95);
    head.position.y = 1.96;
    head.castShadow = true;
    this.body.add(head);
    this.head = head;

    this.faceMat = new THREE.MeshStandardMaterial({
      map: mats.entityFaces.calm,
      roughness: 0.85,
      metalness: 0,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.28), this.faceMat);
    face.position.set(0, 1.96, -0.1);
    face.rotation.y = Math.PI;
    this.body.add(face);

    this.eyeMat = mats.eye.clone();
    const eyeGeo = new THREE.SphereGeometry(0.018, 6, 6);
    this.eyeL = new THREE.Mesh(eyeGeo, this.eyeMat);
    this.eyeR = new THREE.Mesh(eyeGeo, this.eyeMat);
    this.eyeL.position.set(-0.045, 1.99, -0.1);
    this.eyeR.position.set(0.045, 1.98, -0.1);
    this.body.add(this.eyeL, this.eyeR);

    this._arm(dark, -1);
    this._arm(dark, 1);

    for (let i = 0; i < 8; i++) {
      const h = 0.7 + Math.random() * 0.7;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.1, h), mats.tatter);
      strip.position.set((Math.random() - 0.5) * 0.28, 1.45 - h * 0.35, (Math.random() - 0.5) * 0.12);
      strip.rotation.y = Math.random() * Math.PI;
      strip.castShadow = true;
      this.body.add(strip);
    }

    const vaporGeo = new THREE.BufferGeometry();
    const count = 48;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 1] = Math.random() * 0.8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    vaporGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.vapor = new THREE.Points(
      vaporGeo,
      new THREE.PointsMaterial({
        color: 0x6a6864,
        size: 0.08,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.group.add(this.vapor);
    this.vaporPos = positions;

    scene.add(this.group);

    this.faces = mats.entityFaces;
    this.faceKeys = ['calm', 'snarl', 'scream'];
    this.faceT = 0;

    this.phase = 'dormant';
    this.state = 'hidden';
    this.timer = 0;
    this.flicker = 0;
    this.reformIn = -1;
    this.grace = 0;
    this.manifestIn = -1;
    this.aliveTime = 0;
    this.banishLock = 0;
  }

  _arm(mat, side) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.18, 1.55, 0);
    arm.rotation.z = side * -0.35;
    arm.rotation.x = 0.4;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.55, 5), mat);
    upper.position.y = -0.28;
    upper.castShadow = true;
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.5, 5), mat);
    fore.position.y = -0.78;
    fore.castShadow = true;
    arm.add(upper, fore);
    const hand = new THREE.Group();
    hand.position.y = -1.05;
    for (let i = 0; i < 4; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.16, 4), mat);
      claw.position.set((i - 1.5) * 0.03, -0.08, 0.02);
      claw.rotation.x = Math.PI;
      hand.add(claw);
    }
    arm.add(hand);
    this.body.add(arm);
  }

  reset() {
    this.phase = 'dormant';
    this.state = 'hidden';
    this.group.visible = false;
    this.timer = 0;
    this.flicker = 0;
    this.reformIn = -1;
    this.grace = 0;
    this.manifestIn = -1;
    this.banishLock = 0;
    this.faceMat.map = this.faces.calm;
  }

  chest(out = _chest) {
    out.set(this.group.position.x, 1.45, this.group.position.z);
    return out;
  }

  get active() {
    return this.group.visible && (this.state === 'stalk' || this.state === 'chase' || this.state === 'apparate');
  }

  appearAt(x, z, mode, duration = 1.2) {
    this.group.position.set(x, 0, z);
    this.group.visible = true;
    this.state = mode;
    this.timer = duration;
    this.flicker = mode === 'apparate' ? duration : 0.28;
    this.banishLock = 0;
    this.grace = mode === 'chase' ? 1.15 : 0;
    this.aliveTime = 0;
  }

  armStalk(delay) {
    this.phase = 'stalk';
    this.manifestIn = delay;
    if (this.state !== 'apparate') this.state = 'hidden';
  }

  banish() {
    this.state = 'banish';
    this.flicker = 0.4;
    this.banishLock = 0.45;
    this.timer = 0.4;
    if (this.phase === 'finale') {
      this.reformIn = 8;
      this.manifestIn = -1;
    } else {
      this.manifestIn = 10 + Math.random() * 5;
      this.reformIn = -1;
    }
  }

  update(dt, px, pz, allowManifest = true) {
    const events = { caught: false, proximity: false, reformed: false, vanished: false };

    if (this.banishLock > 0) this.banishLock = Math.max(0, this.banishLock - dt);
    if (this.grace > 0) this.grace = Math.max(0, this.grace - dt);

    if (this.state === 'hidden' && this.phase === 'stalk' && this.manifestIn >= 0) {
      if (allowManifest) this.manifestIn -= dt;
      if (allowManifest && this.manifestIn <= 0) {
        const spot = this._pickSpot(px, pz, 6, 12);
        this.appearAt(spot.x, spot.z, 'stalk', 7.5);
        this.manifestIn = -1;
      }
    }

    if (this.state === 'hidden' && this.phase === 'finale' && this.reformIn >= 0) {
      this.reformIn -= dt;
      if (this.reformIn <= 0) {
        const spot = this._pickSpot(px, pz, 6.5, 9);
        this.appearAt(spot.x, spot.z, 'chase', 999);
        this.reformIn = -1;
        events.reformed = true;
      }
    }

    // Flicker hides the mesh for a frame. Movement still has to run, or one
    // invisible frame freezes the chase for good.
    if (this.state === 'hidden') return events;

    if (this.state === 'stalk' || this.state === 'chase') {
      this.flicker = Math.max(0, this.flicker - dt);
    }

    this.aliveTime += dt;
    this._animate(dt);
    this._facePlayer(px, pz);

    if (this.state === 'apparate') {
      this.timer -= dt;
      this.flicker = this.timer;
      if (this.timer <= 0) {
        this._hide();
        events.vanished = true;
      }
      return events;
    }

    if (this.state === 'banish') {
      this.timer -= dt;
      this.flicker = this.timer;
      if (this.timer <= 0) {
        this._hide();
        events.vanished = true;
      }
      return events;
    }

    const dx = px - this.group.position.x;
    const dz = pz - this.group.position.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const inv = 1 / dist;

    if (this.state === 'stalk') {
      const speed = 0.62;
      if (dist > 2.15) {
        this.group.position.x += dx * inv * speed * dt;
        this.group.position.z += dz * inv * speed * dt;
      }
      this.group.position.x += Math.sin(this.aliveTime * 1.7) * 0.25 * dt;
      this.timer -= dt;
      if (dist < 1.15) {
        events.proximity = true;
        this._hide();
        this.manifestIn = 8 + Math.random() * 6;
        return events;
      }
      if (this.timer <= 0) {
        this._hide();
        this.manifestIn = 9 + Math.random() * 8;
        events.vanished = true;
      }
      return events;
    }

    if (this.state === 'chase') {
      const lurch = 0.78 + 0.34 * Math.sin(this.aliveTime * 4.3);
      const speed = 3.65 * lurch;
      const weave = Math.cos(this.aliveTime * 2.4) * 0.45;
      const wx = -dz * inv;
      const wz = dx * inv;
      this.group.position.x += (dx * inv * speed + wx * weave) * dt;
      this.group.position.z += (dz * inv * speed + wz * weave) * dt;
      this.body.rotation.z = Math.sin(this.aliveTime * 6) * 0.08;
      this.body.position.y = Math.abs(Math.sin(this.aliveTime * 5.2)) * 0.04;
      if (this.grace <= 0 && this.banishLock <= 0 && dist < 0.92) {
        events.caught = true;
      }
    }

    return events;
  }

  _hide() {
    this.state = 'hidden';
    this.group.visible = false;
    this.flicker = 0;
    this.body.rotation.z = 0;
    this.body.position.y = 0;
  }

  _facePlayer(px, pz) {
    const dx = px - this.group.position.x;
    const dz = pz - this.group.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    this.group.rotation.y = Math.atan2(-dx, -dz);
  }

  _animate(dt) {
    const t = this.aliveTime;
    this.body.scale.y = 1 + Math.sin(t * 1.8) * 0.015;
    this.head.rotation.z = Math.sin(t * 1.3) * 0.08;
    this.head.rotation.x = 0.15 + Math.sin(t * 0.7) * 0.04;

    this.faceT -= dt;
    if (this.faceT <= 0) {
      const rate = this.state === 'chase' ? 0.18 : 0.55;
      this.faceT = rate + Math.random() * rate;
      const key = this.faceKeys[(Math.random() * this.faceKeys.length) | 0];
      this.faceMat.map = this.faces[key];
      this.faceMat.needsUpdate = true;
    }

    const pos = this.vaporPos;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] += dt * 0.25;
      if (pos[i + 1] > 1.1) {
        pos[i] = (Math.random() - 0.5) * 0.55;
        pos[i + 1] = 0;
        pos[i + 2] = (Math.random() - 0.5) * 0.55;
      }
    }
    this.vapor.geometry.attributes.position.needsUpdate = true;

    if (this.flicker > 0) {
      this.group.visible = Math.random() > 0.2;
      if (Math.random() < 0.15) {
        this.body.position.x = (Math.random() - 0.5) * 0.08;
      }
    } else if (this.state !== 'hidden') {
      this.group.visible = true;
      this.body.position.x *= 0.8;
    }
  }

  _pickSpot(px, pz, minD, maxD) {
    const candidates = [];
    for (const s of this.spots) {
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d >= minD && d <= maxD) candidates.push(s);
    }
    if (candidates.length) return candidates[(Math.random() * candidates.length) | 0];
    let best = this.spots[0];
    let bestScore = Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - px, s.z - pz);
      const score = Math.abs(d - (minD + maxD) * 0.5);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }
}
