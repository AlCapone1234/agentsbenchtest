// Paces the horror: one-shot scripted scares, randomized ambience, lightning/thunder, stalking cadence, the finale.
import * as THREE from 'three';
import { ROOMS, roomAt } from '../world/House.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// where he can be glimpsed from (doorways, hall ends, far corners)
const SPOTS = [
  [-9.0, -0.5], [9.0, -0.5], [-3.5, -0.5], [3.5, -0.5], [-7, -2.5], [0, -2.5], [7, -2.5], [0, 1.7], [-7, 1.7], [7, 1.7],
  [0, 5.5], [-8.5, 6.5], [8.2, 2.6], [8.5, -6.5], [-9.0, -4.0], [-3.0, -7.0], [-8.5, 3.0], [6, 7],
];

export class ScareDirector {
  constructor(game) {
    this.g = game;
    this.reset();
  }

  reset() {
    this.t = 0;
    this.timeline = [];
    this.bigQueue = [];
    this.flags = { living: false, hall: false, kitchen: false, bedroom: false, studyKey: false, key2: false, finale: false };
    this.lastBig = -999;
    this.nextAmbient = 10;
    this.nextLightning = rnd(8, 18);
    this.pulses = [];
    this.lightning = 0;
    this.stalking = false; this.nextManifest = 0; this.glimpses = 0; this.cooldownUntil = 0;
    this.busyUntil = 0; this.finale = false; this.chasing = false;
    this.adrenaline = 0;
  }

  after(delay, fn) { this.timeline.push({ at: this.t + delay, fn }); }
  big(gap = 0) { this.lastBig = this.t + gap; }
  bigOk() { return this.t - this.lastBig > 12; }

  // ------------------------------------------------------------ triggers
  checkVolumes(pos) {
    const f = this.flags, g = this.g, a = this.g.act();
    if (!f.living && pos.x > -9.2 && pos.x < -4.8 && pos.z > 2.0 && pos.z < 7.4) { f.living = true; this.scareLiving(); }
    if (!f.hall && pos.z > -1.5 && pos.z < 0.5 && Math.abs(pos.x) < 7.5) { f.hall = true; this.defer(() => this.scareHall()); }
    if (!f.kitchen && pos.x > 5.0 && pos.x < 9.4 && pos.z > -6.6 && pos.z < -3.2) { f.kitchen = true; this.defer(() => this.scareKitchen()); }
    if (!f.bedroom && pos.x > -2.7 && pos.x < 2.7 && pos.z > -6.8 && pos.z < -3.1) { f.bedroom = true; this.defer(() => this.scareBedroom()); }
    void g; void a;
  }
  // big scares never fire back-to-back: they wait in a FIFO queue until there has been a quiet gap
  defer(fn) { this.bigQueue.push(fn); }

  scareLiving() { // act 1: sound only
    const g = this.g;
    this.big(-6);
    this.after(0.8, () => { g.audio.thump({ x: -6, y: 1, z: -5 }, 1); g.hud.shake(0.12, 0.3); });
    this.after(3.2, () => g.audio.whisper({ x: -9.2, y: 1.5, z: 6.5 }, 2.6, 0.9));
  }
  scareHall() { // lights flicker, slam behind the player
    const g = this.g; this.big();
    g.house.flickerUntil = this.t + 2.6;
    g.audio.stinger(0.35);
    this.after(0.55, () => {
      const back = g.player.forward(new THREE.Vector3()).setY(0).normalize().multiplyScalar(-4.2);
      const p = { x: g.player.pos.x + back.x, y: 1.4, z: g.player.pos.z + back.z };
      g.audio.slam(p, 1.25); g.hud.shake(0.35, 0.5); g.hud.flash('#ffffff', 0.12, 0.5);
      g.player.lookToward(new THREE.Vector3(p.x, 1.4, p.z), 0.45);
      this.adrenaline = 0.7;
    });
  }
  scareKitchen() { // cabinet bang, chair slides
    const g = this.g; this.big();
    this.after(0.4, () => {
      g.house.bangCabinet(); g.audio.bang({ x: 5.75, y: 1.9, z: -7.4 }, 1.1); g.audio.stinger(0.55); g.hud.shake(0.3, 0.45); this.adrenaline = 0.8;
      g.player.lookToward(new THREE.Vector3(5.9, 1.9, -7.4), 0.5);
    });
    this.after(2.8, () => g.house.slideChairAway());
  }
  scareBedroom() { // the door slams shut behind you
    const g = this.g; this.big();
    this.after(0.5, () => { g.house.bedroomDoor.slam(); this.adrenaline = 0.8; });
    this.after(2.3, () => { g.audio.lockRattle(g.house.bedroomDoor.pos); });
  }

  onKeyTaken(room, count) {
    const g = this.g;
    if (room === 'study' && !this.flags.studyKey) {
      this.flags.studyKey = true; this.big();
      this.after(0.5, () => this.studyApparition());
    }
    if (count === 2 && !this.flags.key2) {
      this.flags.key2 = true;
      const delay = room === 'study' ? 3.8 : 0.9;
      this.after(delay, () => {
        const p = g.player.pos, fw = g.player.forward(new THREE.Vector3()).setY(0).normalize();
        g.audio.growl({ x: p.x - fw.x * 6, y: 1.4, z: p.z - fw.z * 6 }, 1.0, 2.6);
        g.hud.shake(0.15, 1.0); this.adrenaline = 0.9; this.big();
        g.hud.caption('Something in the house just noticed you.', 4);
      });
      this.stalking = true; this.nextManifest = this.t + delay + rnd(9, 14);
    }
    if (count >= 3 && !this.flags.finale) {
      this.flags.finale = true; this.stalking = false;
      this.after(room === 'study' ? 3.6 : 0.4, () => this.beginFinale());
    }
  }

  studyApparition() {
    const g = this.g, d = g.house.studyDoor;
    if (!d.isOpen) { d.angle = d.target = d.openAngle * d.sign; d.pivot.rotation.y = d.angle; g.audio.creak(d.pos, true, 1); }
    const doorway = new THREE.Vector3(-7, 0, -2.2);
    // if the player is too near the doorway he would clip; stand just past the threshold
    g.ghost.appear(doorway, { duration: 1.3, expression: 0 });
    g.audio.stinger(1.0); g.hud.shake(0.35, 0.5); this.strike(1.0, 0.0); this.adrenaline = 1;
    g.player.lookToward(new THREE.Vector3(-7, 1.9, -2.2), 0.75);
    g.hud.flash('#d8e4ff', 0.18, 0.55);
  }

  beginFinale() {
    const g = this.g;
    this.finale = true; this.big();
    g.hud.setObjective('...');
    g.audio.blackout(); g.house.setBlackout(true); g.player.forceOff(2.4);
    g.hud.fadeDark(0.35, 0.3);
    g.audio.setTension(1);
    this.after(2.5, () => {
      g.audio.scream(1.0, 1.6); g.hud.flash('#8a0000', 0.5, 0.75); g.hud.shake(0.7, 1.0); g.hud.fadeDark(0, 0.4);
      g.player.forceOn();
      g.audio.flashClick(true);
      // he appears between you and the door, off to one side
      const P = g.player.pos, door = new THREE.Vector3(0, 0, 8);
      const toDoor = door.clone().sub(P).setY(0); const dist = toDoor.length(); toDoor.normalize();
      const ang = (Math.random() < 0.5 ? -1 : 1) * rnd(0.45, 0.95);
      const dir = toDoor.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      const sp = P.clone().addScaledVector(dir, Math.min(7, Math.max(5, dist * 0.55)));
      sp.x = THREE.MathUtils.clamp(sp.x, -9.3, 9.3); sp.z = THREE.MathUtils.clamp(sp.z, -7.3, 7.3);
      g.ghost.startChase(sp);
      g.frontDoorLive(true);
      this.chasing = true; g.audio.startChase();
      g.hud.setObjective('RUN. Reach the front door and unlock it — burn him back with your beam.');
      if (g.player.battery < 40) g.player.battery = 40; // mercy: the chase must be winnable
    });
  }

  // ------------------------------------------------------------ lightning
  strike(power = 0.8, thunderDelay = null) {
    const t = this.t;
    this.pulses.push({ at: t, v: 1.0 * power, d: 0.07 }, { at: t + 0.1, v: 0.65 * power, d: 0.1 }, { at: t + 0.26, v: 0.95 * power, d: 0.2 });
    const delay = thunderDelay ?? rnd(0.5, 3.4);
    this.g.audio.thunder(delay, power * (delay < 1 ? 1 : 0.75));
    if (delay < 0.9) this.g.audio.crack(power);
  }
  evalLightning() {
    let v = 0;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i], dt = this.t - p.at;
      if (dt > 1.4) { this.pulses.splice(i, 1); continue; }
      if (dt >= 0) v = Math.max(v, p.v * Math.exp(-dt / p.d));
    }
    return v;
  }

  // ------------------------------------------------------------ stalking
  manifest() {
    const g = this.g, P = g.player.pos;
    const fw = g.player.forward(new THREE.Vector3()).setY(0).normalize();
    const cands = [];
    for (const [x, z] of SPOTS) {
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < 6.5 || d > 14) continue;
      const los = !g.house.segmentBlocked(P.x, P.z, x, z);
      const toS = new THREE.Vector3(x - P.x, 0, z - P.z).normalize();
      const front = toS.dot(fw);
      cands.push({ x, z, score: (los ? 10 : 0) + (front > 0.2 ? 4 : 0) + Math.random() * 5 });
    }
    cands.sort((a, b) => b.score - a.score);
    let spot = cands[0] ? new THREE.Vector3(cands[0].x, 0, cands[0].z) : new THREE.Vector3(-P.x, 0, -P.z);
    const behind = Math.random() < 0.35 && this.glimpses >= 2;
    if (behind) { spot = new THREE.Vector3(P.x - fw.x * 7, 0, P.z - fw.z * 7); spot.x = THREE.MathUtils.clamp(spot.x, -9.3, 9.3); spot.z = THREE.MathUtils.clamp(spot.z, -7.3, 7.3); }
    const glimpse = this.glimpses < 2 || Math.random() < 0.4;
    this.glimpses++;
    g.audio.stinger(glimpse ? 0.45 : 0.6);
    g.audio.whisper({ x: spot.x, y: 1.6, z: spot.z }, 1.8, 1.0);
    this.adrenaline = Math.max(this.adrenaline, 0.7);
    if (glimpse) g.ghost.appear(spot, { duration: rnd(1.8, 2.8), expression: Math.random() < 0.5 ? 0 : 1 });
    else g.ghost.startStalk(spot, rnd(7, 10));
    this.big();
  }

  onGhostVanished() { this.cooldownUntil = this.t + rnd(16, 26); this.nextManifest = Math.max(this.nextManifest, this.cooldownUntil); }

  // ------------------------------------------------------------ ambient
  ambientEvent() {
    const g = this.g, P = g.player.pos, act = g.act();
    const tries = 12; let spot = null;
    for (let i = 0; i < tries; i++) {
      const k = pick(Object.keys(ROOMS)); const r = ROOMS[k];
      const x = rnd(r.x0 + 0.6, r.x1 - 0.6), z = rnd(r.z0 + 0.6, r.z1 - 0.6);
      const d = Math.hypot(x - P.x, z - P.z);
      if (d > 4.5 && d < 15) { spot = { x, y: 1.3, z }; break; }
    }
    if (!spot) return;
    const w = [['settle', 22], ['whisper', act >= 2 ? 22 : 12], ['knock', 16], ['thump', 12], ['piano', 6], ['steps', 12], ['creak', 14]];
    let sum = w.reduce((a, b) => a + b[1], 0), r = Math.random() * sum, kind = 'settle';
    for (const [k, v] of w) { if ((r -= v) <= 0) { kind = k; break; } }
    const a = g.audio;
    switch (kind) {
      case 'settle': a.settle(spot, 1); break;
      case 'whisper': a.whisper(spot, rnd(1.6, 3), 0.9); break;
      case 'knock': a.knock(spot, 2 + Math.floor(Math.random() * 3), rnd(0.28, 0.5), 0.9); break;
      case 'thump': a.thump(spot, 0.8); break;
      case 'piano': a.piano({ x: -5.3, y: 1, z: 7.5 }, Math.floor(Math.random() * 7)); break;
      case 'steps': for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) this.after(i * rnd(0.62, 0.85), () => a.thump({ x: spot.x + i * 0.4, y: 0.2, z: spot.z }, 0.35)); break;
      case 'creak': a.creak(spot, Math.random() < 0.5, 1); break;
    }
  }

  // ------------------------------------------------------------ frame
  update(dt, pos) {
    this.t += dt;
    const g = this.g;
    // timeline
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      if (this.timeline[i].at <= this.t) { const { fn } = this.timeline[i]; this.timeline.splice(i, 1); fn(); }
    }
    if (this.bigQueue.length && this.bigOk() && !g.ghost.isActive && !this.finale) this.bigQueue.shift()();
    if (!this.finale) this.checkVolumes(pos);
    // lightning
    if (!g.state.caught) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) { this.strike(rnd(0.55, 1.0)); this.nextLightning = this.chasing ? rnd(7, 15) : rnd(16, 42); }
    }
    this.lightning = this.evalLightning();
    g.house.setLightning(this.lightning);
    // ambience
    if (!this.chasing && !this.finale) {
      this.nextAmbient -= dt;
      if (this.nextAmbient <= 0) { this.ambientEvent(); const a = g.act(); this.nextAmbient = a >= 2 ? rnd(7, 15) : rnd(12, 24); }
    }
    // stalking
    if (this.stalking && !g.ghost.isActive && this.t > this.nextManifest && g.state.playing && !this.finale && this.t > this.busyUntil && this.bigOk()) {
      this.manifest();
      this.nextManifest = this.t + rnd(24, 38);
    }
    // adrenaline decays; tension tracks the act
    this.adrenaline = Math.max(0, this.adrenaline - dt * 0.18);
    const act = g.act();
    const base = this.chasing ? 1 : act >= 3 ? 0.7 : act === 2 ? 0.4 : 0.12 + Math.min(0.1, g.keys.length * 0.1);
    g.audio.setTension(Math.max(base, this.adrenaline * 0.8));
  }
}

export { roomAt };
