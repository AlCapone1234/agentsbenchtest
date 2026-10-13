import { ROOMS } from '../world/House.js';

// Scripted scares are one-shot. Big scares share a cooldown so two never land back-to-back.
const BIG_COOLDOWN = 9;
const BEDROOM_DEEP = { x0: -4.5, x1: 4.5, z0: -8, z1: -4.3 };   // past the door's swing arc
const DOOR_POINTS = [[-7.25, -3], [0, -3], [0, 8]];
const KITCHEN_CABINET = { x: 9.6, y: 2.0, z: -5.0 };
const ROOM_LIST = Object.values(ROOMS);

const inside = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

export class ScareDirector {
  // game: { shake(amount), flash(kind, alpha), startFinale() }
  constructor({ house, audio, ghost, game }) {
    this.house = house;
    this.audio = audio;
    this.ghost = ghost;
    this.game = game;
    this.reset();
  }

  reset() {
    this.fired = new Set();
    this.queue = [];
    this.timers = [];
    this.t = 0;
    this.lastBig = -99;
    this.ambientT = 5;
    this.lightningT = 8;
    this.pendingFlash = 0;
    this.musicT = 45 + Math.random() * 40;
    this.finale = false;
    this.act = 1;
    this.p = { x: 0, z: 5.2, yaw: 0 };
  }

  setAct(n) {
    this.act = n;
  }

  // Runs a scare once. Big scares wait in the queue for the cooldown.
  once(id, big, fn) {
    if (this.fired.has(id)) return;
    this.fired.add(id);
    if (big) this.queue.push(fn);
    else fn();
  }

  later(sec, fn) {
    this.timers.push({ t: sec, fn });
  }

  // Called by Game after every key pickup.
  onKeyPicked(id, count) {
    if (this.finale) return;
    if (count >= 3) {
      this.beginFinale();
      return;
    }
    if (id === 'study') this.once('studyKey', true, () => this.studyScare());
    if (count === 2) this.once('secondKey', true, () => this.secondKeyScare());
  }

  beginFinale() {
    if (this.finale) return;
    this.finale = true;
    this.queue = [];
    this.game.startFinale();
  }

  update(dt, player) {
    this.t += dt;
    this.p = player;

    if (this.timers.length) {
      for (const e of this.timers) e.t -= dt;
      const due = this.timers.filter((e) => e.t <= 0);
      this.timers = this.timers.filter((e) => e.t > 0);
      for (const e of due) e.fn();
    }

    if (this.queue.length && this.t - this.lastBig > BIG_COOLDOWN) {
      this.lastBig = this.t;
      this.queue.shift()();
    }

    if (!this.finale) this.checkVolumes();
    if (!this.finale) this.updateAmbient(dt);
    this.updateLightning(dt);
    this.updateMusicBox(dt);
  }

  checkVolumes() {
    const { x, z } = this.p;
    if (inside(ROOMS.living, x, z)) this.once('living', false, () => this.livingScare());
    if (inside(ROOMS.hallway, x, z)) this.once('hallway', true, () => this.hallwayScare());
    if (inside(ROOMS.kitchen, x, z)) this.once('kitchen', true, () => this.kitchenScare());
    if (inside(BEDROOM_DEEP, x, z)) this.once('bedroom', true, () => this.bedroomScare());
  }

  // ---- scripted scares ----

  // Distant thump, then a whisper close by. Sound only.
  livingScare() {
    const { x, z } = this.p;
    this.audio.thump(7.5, -6.0, true);
    const a = Math.random() * Math.PI * 2;
    this.later(0.9, () => this.audio.whisper(x + Math.cos(a) * 2.5, z + Math.sin(a) * 2.5));
  }

  // The lights flicker and a slam sounds behind the player.
  hallwayScare() {
    const { x, z, yaw } = this.p;
    this.house.flicker(1.8);
    this.audio.slam(x + Math.sin(yaw) * 1.5, z + Math.cos(yaw) * 1.5);
    this.game.shake(0.5);
    this.game.flash('white', 0.22);
  }

  // Cabinet bang stinger, then a chair slides on its own.
  kitchenScare() {
    this.audio.bang(KITCHEN_CABINET.x, KITCHEN_CABINET.z);
    this.audio.stinger();
    this.house.cabinetBang();
    this.game.shake(0.6);
    this.game.flash('red', 0.25);
    this.later(0.5, () => {
      this.house.slideChair();
      this.audio.creak(7.0, -6.1);
    });
  }

  // The bedroom door slams shut behind the player.
  bedroomScare() {
    const d = this.house.slamDoor('bedroom');
    if (d) this.audio.slam(d.hingeX + 0.5, d.hingeZ);
    this.game.shake(0.45);
  }

  // Entity stands in the study doorway for 1.2s, then gone.
  studyScare() {
    const { x, z } = this.p;
    this.ghost.appear(-7.25, -3.0, x, z, 1.2);
    this.audio.stinger();
    this.game.shake(0.6);
    this.game.flash('white', 0.2);
  }

  // Growl, and the stalk begins.
  secondKeyScare() {
    this.audio.growl();
    this.game.shake(0.5);
    this.game.flash('red', 0.15);
    this.ghost.beginStalk();
  }

  // ---- ambience ----

  randomPoint() {
    const r = ROOM_LIST[Math.floor(Math.random() * ROOM_LIST.length)];
    return {
      x: r.x0 + 0.8 + Math.random() * (r.x1 - r.x0 - 1.6),
      z: r.z0 + 0.8 + Math.random() * (r.z1 - r.z0 - 1.6),
    };
  }

  updateAmbient(dt) {
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = this.act === 1 ? 9 + Math.random() * 7 : this.act === 2 ? 5 + Math.random() * 5 : 3.5 + Math.random() * 3;
    this.ambientEvent();
  }

  ambientEvent() {
    const { x, z } = this.p;
    const r = Math.random();
    const pt = this.randomPoint();
    if (r < 0.3) {
      this.audio.creak(pt.x, pt.z);
    } else if (r < 0.5) {
      const a = Math.random() * Math.PI * 2;
      const d = 2.5 + Math.random() * 2;
      this.audio.whisper(x + Math.cos(a) * d, z + Math.sin(a) * d);
    } else if (r < 0.65) {
      const door = DOOR_POINTS[Math.floor(Math.random() * DOOR_POINTS.length)];
      this.audio.knock(door[0], door[1]);
    } else if (r < 0.8) {
      this.audio.thump(pt.x, pt.z, true);
    } else {
      const a = Math.random() * Math.PI * 2;
      this.audio.creak(x + Math.cos(a) * 3, z + Math.sin(a) * 3);
    }
  }

  // Storm: a flash, and thunder that arrives a moment later. Some storms double-flash.
  updateLightning(dt) {
    if (this.pendingFlash > 0) {
      this.pendingFlash -= dt;
      if (this.pendingFlash <= 0) this.house.lightning();
    }
    this.lightningT -= dt;
    if (this.lightningT > 0) return;
    this.lightningT = 12 + Math.random() * 22;
    this.house.lightning();
    if (Math.random() < 0.45) this.pendingFlash = 0.18;
    this.audio.thunder(0.7 + Math.random() * 2.6);
    this.game.flash('storm', 0.12);
  }

  updateMusicBox(dt) {
    if (this.act !== 1) return;
    this.musicT -= dt;
    if (this.musicT <= 0) {
      this.musicT = 60 + Math.random() * 60;
      this.audio.musicBox();
    }
  }
}
