import { LAYOUT, roomAt } from '../world/House.js';

export class ScareDirector {
  constructor(world, audio, hud, ghost) {
    this.world = world;
    this.audio = audio;
    this.hud = hud;
    this.ghost = ghost;
    this.reset();
  }

  reset() {
    this.fired = {
      living: false,
      hall: false,
      kitchen: false,
      study: false,
      bedroom: false,
      second: false,
      final: false,
    };
    this.room = 'foyer';
    this.quiet = 0;
    this.ambientIn = 22;
    this.lightningIn = 7 + Math.random() * 6;
    this.flash = 0;
    this.flashNext = 0;
    this.boltsLeft = 0;
    this.thunderIn = -1;
    this.apparateUntil = 0;
    this.pendingStalk = false;
    this.sequence = null;
    this.seqT = 0;
    this.enabled = false;
    this.finaleStarted = false;
    this.queued = null;
    this.gen = (this.gen || 0) + 1;
  }

  update(dt, player) {
    this._lightning(dt);
    this.quiet = Math.max(0, this.quiet - dt);
    if (this.apparateUntil > 0) {
      this.apparateUntil -= dt;
      if (this.apparateUntil <= 0 && this.pendingStalk && !this.fired.final) {
        this.pendingStalk = false;
        this._beginStalk();
      }
    }
    if (this.sequence) this._sequence(dt, player);

    if (!this.enabled || this.fired.final) {
      if (this.enabled && !this.fired.final) this._ambient(dt);
      return;
    }

    const room = roomAt(player.x, player.z);
    if (room !== this.room) {
      this.room = room;
      this._consider(room, player);
    } else if (this.queued && this.quiet <= 0) {
      const queued = this.queued;
      this.queued = null;
      if (queued === room) this._consider(room, player);
    } else if (room === 'bedroom' && !this.fired.bedroom) {
      this._consider(room, player);
    }
    this._ambient(dt);
  }

  _consider(room, player) {
    if (this.fired.final) return;
    if (room === 'bedroom' && player.z > LAYOUT.zN - 0.65) return;
    if (this.quiet > 0) {
      this.queued = room;
      return;
    }
    this._fire(room, player);
  }

  _fire(room, player) {
    if (room === 'living' && !this.fired.living) {
      this.fired.living = true;
      this.quiet = 8;
      this.audio.thump();
      const gen = this.gen;
      setTimeout(() => {
        if (this.gen === gen) this.audio.whisper();
      }, 700);
      this.hud.shake(2, 0.4);
    } else if (room === 'hall' && !this.fired.hall) {
      this.fired.hall = true;
      this.quiet = 7;
      this.world.flickerBulbs(2.4);
      const f = player.fwd;
      const bx = player.x - (f?.x || 0) * 2.2;
      const bz = player.z - (f?.z || -1) * 2.2;
      this.audio.doorSlam(bx, 1.2, bz);
      this.world.tiltPortrait();
      this.hud.flash('white', 0.18);
      this.hud.shake(7, 0.35);
    } else if (room === 'kitchen' && !this.fired.kitchen) {
      this.fired.kitchen = true;
      this.quiet = 7;
      this.audio.cabinetBang(8, 1.8, -7.2);
      this.world.popCabinet();
      this.world.slideChair();
      this.hud.shake(5, 0.3);
    } else if (room === 'bedroom' && !this.fired.bedroom) {
      this.fired.bedroom = true;
      this.quiet = 6;
      const door = this.world.doors.bedroom;
      if (door) door.slam();
      this.audio.doorSlam(door ? door.group.position.x : 0, 1.2, door ? door.group.position.z : -1.7);
      this.hud.shake(8, 0.35);
      this.hud.flash('white', 0.12);
    }
  }

  onStudyKey() {
    if (this.fired.study || this.fired.final) return;
    this.fired.study = true;
    this.quiet = 3;
    this.apparateUntil = 1.35;
    const door = this.world.doors.study;
    if (door && door.openAmount < 0.35) door.forceOpen();
    const spot = this.world.spots.studyDoor;
    this.ghost.appearAt(spot.x, spot.z, 'apparate', 1.2);
    this.audio.stinger();
    this.hud.flash('white', 0.45);
    this.hud.shake(8, 0.35);
  }

  onSecondKey() {
    if (this.fired.second || this.fired.final) return;
    this.fired.second = true;
    if (this.apparateUntil > 0) {
      this.pendingStalk = true;
      return;
    }
    this._beginStalk();
  }

  onFinalKey() {
    this.fired.final = true;
    this.pendingStalk = false;
    this.apparateUntil = 0;
    this.sequence = 'blackout';
    this.seqT = 0;
    this.world.blackout = true;
    this.audio.setBlackout(true);
    this.audio.unlock(0, 1, 7.6);
    this.ghost.phase = 'finale';
    if (this.ghost.state === 'apparate' || this.ghost.state === 'stalk') {
      this.ghost.group.visible = false;
      this.ghost.state = 'hidden';
    }
  }

  _beginStalk() {
    this.quiet = 4;
    this.audio.growl();
    this.world.flickerBulbs(1.6);
    this.hud.shake(4, 0.45);
    this.ghost.armStalk(7 + Math.random() * 4);
  }

  _sequence(dt, player) {
    this.seqT += dt;
    if (this.sequence === 'blackout' && this.seqT >= 0.75 && !this.finaleStarted) {
      this.finaleStarted = true;
      const bumped = this._placeInFront(player);
      this.ghost.appearAt(bumped.x, bumped.z, 'chase', 999);
      this.ghost.phase = 'finale';
      this.audio.scream();
      this.hud.flash('white', 0.7);
      this.hud.shake(12, 0.4);
    }
    if (this.sequence === 'blackout' && this.seqT >= 1.05) {
      this.world.blackout = false;
      this.audio.setBlackout(false);
      this.audio.setChase(true);
      this.sequence = 'chase';
    }
  }

  _placeInFront(player) {
    const fx = player.fwd?.x || 0;
    const fz = player.fwd?.z || -1;
    let best = null;
    let bestScore = Infinity;
    for (const s of this.world.safeSpots) {
      const dx = s.x - player.x;
      const dz = s.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.5 || d > 8) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < 0.1) continue;
      const score = Math.abs(d - 4.6) + (1 - dot) * 1.4;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best) return best;
    return {
      x: Math.max(-9, Math.min(9, player.x + fx * 4.2)),
      z: Math.max(-7.2, Math.min(7.2, player.z + fz * 4.2)),
    };
  }

  _ambient(dt) {
    if (this.sequence === 'blackout') return;
    this.ambientIn -= dt;
    if (this.ambientIn > 0 || this.quiet > 0) return;
    this.ambientIn = 9 + Math.random() * 14;
    const roll = Math.random();
    if (roll < 0.35) this.audio.creak();
    else if (roll < 0.6) this.audio.knock();
    else if (roll < 0.82) this.audio.whisper();
    else this.audio.thump();
  }

  _lightning(dt) {
    if (this.world.blackout) {
      this.world.flash = 0;
      return;
    }
    if (this.thunderIn >= 0) {
      this.thunderIn -= dt;
      if (this.thunderIn <= 0) {
        this.thunderIn = -1;
        this.audio.thunder();
      }
    }
    if (this.boltsLeft > 0) {
      this.flashNext -= dt;
      if (this.flashNext <= 0) {
        this.flash = 1;
        this.boltsLeft--;
        this.flashNext = 0.08 + Math.random() * 0.08;
      }
    } else {
      this.lightningIn -= dt;
      if (this.lightningIn <= 0) {
        this.boltsLeft = Math.random() < 0.45 ? 2 : 1;
        this.flashNext = 0;
        this.lightningIn = 11 + Math.random() * 16;
        this.thunderIn = 0.35 + Math.random() * 1.3;
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7.5);
    }
    this.world.flash = this.flash;
  }
}
