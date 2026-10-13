// First-person controller: pointer-lock look, WASD + sprint, circle-vs-AABB collision, head bob, flashlight + battery.
import * as THREE from 'three';
import { Tex } from '../world/Textures.js';

const EYE = 1.65;
const RADIUS = 0.3;
const WALK = 2.45;
const SPRINT = 4.7;
const FLASH_I = 78;

export class Player {
  constructor(camera, scene, dom, { freeLook = false } = {}) {
    this.camera = camera; this.scene = scene; this.dom = dom;
    camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(0, 0, 6.5);
    this.yaw = 0; this.pitch = 0;
    this.assistYaw = 0; this.assistPitch = 0;
    this.keys = new Set();
    this.locked = false; this.enabled = false; this.freeLook = freeLook;
    this.stamina = 100; this.exhausted = false;
    this.bobPhase = 0; this.bobAmp = 0; this.stepAcc = 0;
    this.moving = false; this.sprinting = false; this.speedNow = 0;
    this.onStep = null; this.onLockChange = null; this.onToggleFlash = null;
    this.mouseSens = 0.0021;

    // flashlight ----------------------------------------------------
    this.battery = 100; this.flashOn = true; this.extraDrain = 0;
    this.light = new THREE.SpotLight(0xfff1dc, FLASH_I, 30, 0.5, 0.65, 2);
    this.light.map = Tex.cookie();
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.12;
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.025;
    this.light.shadow.radius = 5;
    this.target = new THREE.Object3D();
    scene.add(this.light, this.target);
    this.light.target = this.target;
    this.flashQuat = new THREE.Quaternion();
    this.beamDir = new THREE.Vector3(0, 0, -1);
    this.beamPos = new THREE.Vector3();
    this.beamOn = false; this.flashLevel = 0; this.dead = false; this.forcedOff = 0;
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3();
    this._sw = new THREE.Quaternion(); this._swE = new THREE.Euler(); this._fq = new THREE.Quaternion(); this._off = new THREE.Vector3();
    this.sputter = 0;

    this.bind();
  }

  bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF' && this.enabled) this.toggleFlash();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.enabled || !(this.locked || this.freeLook)) return;
      if (this.freeLook && !this.locked && !(e.buttons & 1)) return;
      this.yaw -= e.movementX * this.mouseSens;
      this.pitch -= e.movementY * this.mouseSens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.onLockChange?.(false, true));
  }
  lock() { try { const p = this.dom.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  reset(pos, yaw = 0) {
    this.pos.copy(pos); this.yaw = yaw; this.pitch = 0; this.assistYaw = this.assistPitch = 0;
    this.stamina = 100; this.exhausted = false; this.battery = 100; this.flashOn = true; this.dead = false; this.extraDrain = 0; this.forcedOff = 0;
    this.keys.clear();
    this._applyCamera(0, 0, 0, 0);
    this.flashQuat.copy(this.camera.quaternion);
    this.flashLevel = 1;
  }

  forceOff(sec) { this.forcedOff = sec; }
  forceOn() { this.forcedOff = 0; this.flashOn = true; this.flashLevel = Math.max(this.flashLevel, 0.6); }

  toggleFlash() {
    if (this.forcedOff > 0) return;
    if (this.battery <= 0) { this.onToggleFlash?.(false, true); return; }
    this.flashOn = !this.flashOn;
    this.onToggleFlash?.(this.flashOn, false);
  }
  addBattery(amount) { this.battery = Math.min(100, this.battery + amount); this.dead = false; }
  drain(amount) { this.battery = Math.max(0, this.battery - amount); }

  // nudge the view toward a world point (startle response)
  lookToward(p, fraction = 0.6) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, dy = p.y - (this.pos.y + EYE);
    let dyaw = Math.atan2(-dx, -dz) - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = Math.atan2(dy, Math.hypot(dx, dz)) - this.pitch;
    this.assistYaw += dyaw * fraction; this.assistPitch += dpitch * fraction;
  }

  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + EYE, this.pos.z); }

  resolve(colliders) {
    const r = RADIUS;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (!c.active) continue;
        const px = this.pos.x, pz = this.pos.z;
        if (px < c.minX - r || px > c.maxX + r || pz < c.minZ - r || pz > c.maxZ + r) continue;
        const cx = Math.max(c.minX, Math.min(px, c.maxX)), cz = Math.max(c.minZ, Math.min(pz, c.maxZ));
        const dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), push = r - d; this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push; }
        else {
          const pl = px - c.minX + r, pr = c.maxX - px + r, pu = pz - c.minZ + r, pd = c.maxZ - pz + r, m = Math.min(pl, pr, pu, pd);
          if (m === pl) this.pos.x = c.minX - r; else if (m === pr) this.pos.x = c.maxX + r; else if (m === pu) this.pos.z = c.minZ - r; else this.pos.z = c.maxZ + r;
        }
      }
    }
    this.pos.x = Math.max(-9.7, Math.min(9.7, this.pos.x));
    this.pos.z = Math.max(-7.7, Math.min(7.7, this.pos.z));
  }

  update(dt, colliders, shake = { x: 0, y: 0, roll: 0 }, t = 0) {
    // startle assist
    if (this.assistYaw || this.assistPitch) {
      const k = 1 - Math.exp(-11 * dt);
      const sy = this.assistYaw * k, sp = this.assistPitch * k;
      this.yaw += sy; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + sp));
      this.assistYaw -= sy; this.assistPitch -= sp;
      if (Math.abs(this.assistYaw) < 1e-4) this.assistYaw = 0; if (Math.abs(this.assistPitch) < 1e-4) this.assistPitch = 0;
    }

    // movement -------------------------------------------------------
    let mx = 0, mz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    }
    const wantMove = mx !== 0 || mz !== 0;
    const wantSprint = wantMove && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && mz <= 0.01;
    if (this.exhausted && this.stamina > 22) this.exhausted = false;
    this.sprinting = wantSprint && !this.exhausted && this.stamina > 0;
    if (this.sprinting) { this.stamina = Math.max(0, this.stamina - 17 * dt); if (this.stamina <= 0) this.exhausted = true; }
    else this.stamina = Math.min(100, this.stamina + (wantMove ? 8 : 15) * dt);

    const speed = this.sprinting ? SPRINT : WALK * (mz > 0 ? 0.75 : 1);
    if (wantMove) {
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const vx = (mx * c + mz * s) * speed, vz = (-mx * s + mz * c) * speed;
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.15));
      for (let i = 0; i < steps; i++) { this.pos.x += (vx * dt) / steps; this.pos.z += (vz * dt) / steps; this.resolve(colliders); }
    } else this.resolve(colliders);
    this.moving = wantMove; this.speedNow += ((wantMove ? speed : 0) - this.speedNow) * Math.min(1, dt * 8);

    // head bob + footsteps
    const target = wantMove ? (this.sprinting ? 1 : 0.6) : 0;
    this.bobAmp += (target - this.bobAmp) * Math.min(1, dt * 7);
    if (wantMove) {
      const prev = this.bobPhase;
      this.bobPhase += dt * (this.sprinting ? 12.2 : 8.2);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) this.onStep?.(this.sprinting);
    }
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.055 * this.bobAmp - 0.02 * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.03 * this.bobAmp;
    const breathe = Math.sin(t * 1.3) * 0.004;
    this._applyCamera(bobX + shake.x, bobY + breathe + shake.y, shake.roll + Math.cos(this.bobPhase) * 0.004 * this.bobAmp, 0);

    this.updateFlash(dt, t, bobX, bobY);
  }

  _applyCamera(ox, oy, roll) {
    this.camera.position.set(this.pos.x, this.pos.y + EYE + oy, this.pos.z);
    this._e.set(this.pitch, this.yaw, roll);
    this.camera.quaternion.setFromEuler(this._e);
    // lateral head offset in view space
    this._v.set(ox, 0, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.add(this._v);
  }

  updateFlash(dt, t, bobX, bobY) {
    // battery
    let drain = 0;
    if (this.flashOn && this.battery > 0 && this.forcedOff <= 0) drain = 0.27 + this.extraDrain;
    this.battery = Math.max(0, this.battery - drain * dt);
    if (this.battery <= 0 && this.flashOn && !this.dead) this.dead = true;
    if (this.forcedOff > 0) this.forcedOff -= dt;

    // intensity with sputter
    let level = this.flashOn && this.battery > 0 && this.forcedOff <= 0 ? 1 : 0;
    if (level > 0 && this.battery < 20) {
      const sev = 1 - this.battery / 20; // 0..1
      this.sputter -= dt;
      if (this.sputter < 0) { this.sputter = 0.04 + Math.random() * (0.5 - sev * 0.35); this._sp = Math.random() < 0.18 + sev * 0.5 ? 0.04 + Math.random() * 0.25 : 1; }
      level *= this._sp ?? 1;
      level *= 0.55 + 0.45 * (1 - sev * 0.6);
    }
    this.flashLevel += (level - this.flashLevel) * Math.min(1, dt * (level < this.flashLevel ? 40 : 18));
    this.light.intensity = FLASH_I * this.flashLevel;
    this.beamOn = this.flashLevel > 0.3;

    // lagging orientation
    const k = 1 - Math.exp(-13 * dt);
    this._q.setFromEuler(this._e.set(this.pitch, this.yaw, 0));
    this.flashQuat.slerp(this._q, k);
    // sway driven by the walk cycle
    const sx = Math.cos(this.bobPhase) * 0.018 * this.bobAmp, sy = Math.abs(Math.sin(this.bobPhase)) * 0.02 * this.bobAmp;
    const swayQ = this._sw.setFromEuler(this._swE.set(sy, -sx, 0));
    const q = this._fq.copy(this.flashQuat).multiply(swayQ);
    this.beamDir.set(0, 0, -1).applyQuaternion(q);
    const off = this._off.set(0.17, -0.16 + bobY * 0.4, -0.12).applyQuaternion(q);
    this.beamPos.set(this.pos.x, this.pos.y + EYE, this.pos.z).add(off);
    this.light.position.copy(this.beamPos);
    this.target.position.copy(this.beamPos).addScaledVector(this.beamDir, 8);
  }
}
