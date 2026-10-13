import * as THREE from 'three';

const RADIUS = 0.28;        // player collision circle
const EYE = 1.6;            // camera height
const WALK = 2.3;
const SPRINT = 4.3;
const TORCH_BASE = 34;      // flashlight candela at full brightness (kept low so near walls don't blow out)
const DRAIN_TIME = 170;     // seconds of torch per full battery
const BURN_DRAIN = 1 / 30;  // extra battery per second while the beam is burning the entity
const BOUND_X = 9.72;
const BOUND_Z = 7.72;
const LOW_BATTERY = 0.2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Player {
  constructor(camera, scene, house, lensTexture) {
    this.camera = camera;
    this.house = house;
    camera.rotation.order = 'YXZ';

    this.x = 0;
    this.z = 5.2;
    this.yaw = 0;
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.sprinting = false;
    this.bobT = 0;
    this.bobAmt = 0;
    this.stepDist = 0;
    this.shake = 0;

    this.battery = 1;
    this.spares = 0;
    this.torchOn = true;
    this.forcedDark = false;   // blackout beat: torch cannot be used
    this.burning = false;      // set by Game while the beam is on the entity
    this.sputterOff = false;
    this.sputterT = 0;
    this.level = 1;
    this.snap = true;
    this.events = [];

    this.light = new THREE.SpotLight(0xfff0d8, 0, 22, 0.42, 0.45, 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.02;
    this.light.shadow.radius = 3;   // softens shadow edges under PCFShadowMap
    this.light.shadow.camera.near = 0.1;
    this.light.shadow.camera.far = 22;
    this.light.map = lensTexture;
    scene.add(this.light, this.light.target);

    this.lightPos = new THREE.Vector3();
    this.lightAim = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 0, -1);
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this._aim = new THREE.Vector3();

    this.reset(0, 5.2, 0);
  }

  reset(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.bobT = 0;
    this.bobAmt = 0;
    this.stepDist = 0;
    this.shake = 0;
    this.battery = 1;
    this.spares = 0;
    this.torchOn = true;
    this.forcedDark = false;
    this.burning = false;
    this.sputterOff = false;
    this.sputterT = 0;
    this.level = 1;
    this.snap = true;
    this.events = [];
  }

  // Mouse-look deltas in pixels.
  look(dx, dy) {
    const s = 0.0022;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.3, 1.3);
  }

  addShake(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  // Game reads these once per frame: 'step', 'reload', 'nospare', 'dead'.
  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  toggleTorch() {
    if (this.battery <= 0 && this.spares <= 0) {
      this.events.push({ type: 'dead' });
      return;
    }
    this.torchOn = !this.torchOn;
  }

  // Manual swap: loads a spare battery into the torch.
  reload() {
    if (this.spares <= 0) {
      this.events.push({ type: 'nospare' });
      return;
    }
    if (this.battery >= 0.999) return;
    this.spares--;
    this.battery = 1;
    this.events.push({ type: 'reload' });
  }

  addSpare() {
    this.spares++;
  }

  // Blocks the circle against every solid footprint. Doors are footprints too.
  resolveCollisions() {
    const R = RADIUS;
    for (let iter = 0; iter < 3; iter++) {
      for (const ob of this.house.obstacles) {
        const c = Math.cos(ob.a), s = Math.sin(ob.a);
        const dx = this.x - ob.x, dz = this.z - ob.z;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const cx = clamp(lx, -ob.hx, ob.hx);
        const cz = clamp(lz, -ob.hz, ob.hz);
        const ex = lx - cx, ez = lz - cz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= R * R) continue;

        let nx, nz, pen;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = ex / d;
          nz = ez / d;
          pen = R - d;
        } else {
          // Centre is inside the box: push out through the nearest face.
          const penX = ob.hx - Math.abs(lx);
          const penZ = ob.hz - Math.abs(lz);
          if (penX < penZ) {
            nx = lx >= 0 ? 1 : -1;
            nz = 0;
            pen = penX + R;
          } else {
            nx = 0;
            nz = lz >= 0 ? 1 : -1;
            pen = penZ + R;
          }
        }
        // Local normal back to world space (local x = (c, -s), local z = (s, c)).
        this.x += (nx * c + nz * s) * pen;
        this.z += (-nx * s + nz * c) * pen;
      }
    }
    this.x = clamp(this.x, -BOUND_X, BOUND_X);
    this.z = clamp(this.z, -BOUND_Z, BOUND_Z);
  }

  // input: { forward, back, left, right, sprint }
  update(dt, input) {
    // Movement, relative to yaw
    let f = 0, s = 0;
    if (input.forward) f += 1;
    if (input.back) f -= 1;
    if (input.right) s += 1;
    if (input.left) s -= 1;
    const len = Math.hypot(f, s);
    if (len > 0) { f /= len; s /= len; }
    const moving = len > 0;
    const sprint = moving && !!input.sprint;
    const speed = sprint ? SPRINT : WALK;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const wantX = (fx * f + rx * s) * speed;
    const wantZ = (fz * f + rz * s) * speed;
    const k = 1 - Math.exp(-dt * 12);
    this.vx += (wantX - this.vx) * k;
    this.vz += (wantZ - this.vz) * k;
    this.x += this.vx * dt;
    this.resolveCollisions();
    this.z += this.vz * dt;
    this.resolveCollisions();
    this.speed = Math.hypot(this.vx, this.vz);
    this.sprinting = sprint;

    // Head bob and footsteps
    const isMoving = this.speed > 0.4;
    if (isMoving) this.stepDist += this.speed * dt;
    const stride = sprint ? 1.15 : 0.9;
    if (this.stepDist >= stride) {
      this.stepDist -= stride;
      this.events.push({ type: 'step', sprint });
    }
    if (isMoving) this.bobT += dt * (sprint ? 11 : 8);
    const bobTarget = isMoving ? (sprint ? 0.045 : 0.028) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 8);
    const bobY = Math.abs(Math.sin(this.bobT)) * this.bobAmt;
    const sway = Math.cos(this.bobT * 0.5) * this.bobAmt * 0.5;

    // Shake decays; impacts add to it
    this.shake *= Math.exp(-dt * 5);
    const sh = this.shake;
    const jx = (Math.random() - 0.5) * sh * 0.06;
    const jy = (Math.random() - 0.5) * sh * 0.06;
    const roll = Math.cos(this.bobT) * this.bobAmt * 0.4 + (Math.random() - 0.5) * sh * 0.08;

    this.camera.position.set(this.x + rx * sway + jx, EYE + bobY + jy, this.z + rz * sway);
    this.camera.rotation.set(this.pitch, this.yaw, roll);
    this.updateFlashlight(dt);
  }

  // The torch sits low on the camera's right. It lags the view and aims ahead of it.
  updateFlashlight(dt) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const fwd = cam.getWorldDirection(this._fwd);
    const right = this._right.set(-fwd.z, 0, fwd.x).normalize();
    const eye = cam.position;
    const want = this._want.copy(eye).addScaledVector(fwd, 0.15).addScaledVector(right, 0.24);
    want.y -= 0.22;
    const aim = this._aim.copy(eye).addScaledVector(fwd, 12);
    if (this.snap) {
      this.lightPos.copy(want);
      this.lightAim.copy(aim);
      this.snap = false;
    } else {
      this.lightPos.lerp(want, 1 - Math.exp(-dt * 14));
      this.lightAim.lerp(aim, 1 - Math.exp(-dt * 18));
    }
    this.light.position.copy(this.lightPos);
    this.light.target.position.copy(this.lightAim);
    this.lightDir.subVectors(this.lightAim, this.lightPos).normalize();

    // Battery: drains while lit, faster while burning
    const active = this.torchOn && !this.forcedDark;
    if (active && this.battery > 0) {
      this.battery = Math.max(0, this.battery - dt / DRAIN_TIME - (this.burning ? BURN_DRAIN * dt : 0));
    }
    if (active && this.battery <= 0 && this.spares > 0) {
      this.spares--;
      this.battery = 1;
      this.events.push({ type: 'reload' });
    }

    // Light level: sputters below 20% and goes out at 0%
    let level = 0;
    if (active && this.battery > 0) {
      level = 1;
      if (this.battery < LOW_BATTERY) {
        this.sputterT -= dt;
        if (this.sputterT <= 0) {
          this.sputterOff = !this.sputterOff;
          const frac = this.battery / LOW_BATTERY;
          this.sputterT = this.sputterOff
            ? 0.05 + Math.random() * 0.12
            : (0.08 + Math.random() * 0.8) * frac + 0.03;
        }
        if (this.sputterOff) level = 0;
        else level = 0.55 + 0.45 * (this.battery / LOW_BATTERY);
      }
    }
    this.level = level;
    this.light.intensity = TORCH_BASE * level;
  }

  // Data for the dust shader: where the beam starts, where it points, how far it reaches.
  flashData() {
    return {
      pos: this.lightPos,
      dir: this.lightDir,
      cosCone: Math.cos(this.light.angle),
      range: 9,
      strength: this.level > 0 ? 1 : 0,
    };
  }

  get isLit() {
    return this.level > 0;
  }
}
