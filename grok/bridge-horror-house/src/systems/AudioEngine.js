// All sound is synthesized. Nothing is loaded from disk.

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function impulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const decay = Math.pow(1 - t, 2.6);
      const early = i < rate * 0.03 ? 0.5 : 1;
      d[i] = (Math.random() * 2 - 1) * decay * early * (c === 0 ? 1 : 0.85);
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.wet = null;
    this.listener = null;
    this.droneGain = null;
    this.rainGain = null;
    this.chaseGain = null;
    this.heartbeatLevel = 0;
    this.beatAcc = 0;
    this.breathGain = null;
    this.breathPanner = null;
    this.started = false;
    this._chaseNodes = [];
    this._rainBed = null;
  }

  start() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.listener = ctx.listener;

    const master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(ctx, 1.7);
    const wet = ctx.createGain();
    wet.gain.value = 1;
    convolver.connect(wet);
    wet.connect(master);
    this.convolver = convolver;
    this.wet = wet;

    this._startDrone();
    this._startRain();
    this._startBreath();
    this.started = true;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * Camera matrix column 2 is local +Z. View direction is -Z.
   * Up is column 1. Listener orientation uses that pair.
   */
  updateListener(camera) {
    if (!this.listener) return;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const lx = e[12];
    const ly = e[13];
    const lz = e[14];
    const fx = -e[8];
    const fy = -e[9];
    const fz = -e[10];
    const ux = e[4];
    const uy = e[5];
    const uz = e[6];
    if (this.listener.positionX) {
      this.listener.positionX.value = lx;
      this.listener.positionY.value = ly;
      this.listener.positionZ.value = lz;
      this.listener.forwardX.value = fx;
      this.listener.forwardY.value = fy;
      this.listener.forwardZ.value = fz;
      this.listener.upX.value = ux;
      this.listener.upY.value = uy;
      this.listener.upZ.value = uz;
    } else {
      this.listener.setPosition(lx, ly, lz);
      this.listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  update(dt, danger) {
    if (!this.started) return;
    this.heartbeatLevel += ((danger > 0.15 ? danger : 0) - this.heartbeatLevel) * Math.min(1, dt * 2);
    if (this.heartbeatLevel > 0.08) {
      const interval = 1.15 - this.heartbeatLevel * 0.78;
      this.beatAcc += dt;
      if (this.beatAcc >= interval) {
        this.beatAcc = 0;
        this._thump(0.55 + this.heartbeatLevel * 0.5);
        const when = this.ctx.currentTime + 0.13;
        this._thump(0.32 + this.heartbeatLevel * 0.25, when);
      }
    } else {
      this.beatAcc = 0;
    }
  }

  setBreath(level, x, y, z) {
    if (!this.breathGain) return;
    const now = this.ctx.currentTime;
    this.breathGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.55, now, 0.15);
    if (this.breathPanner.positionX) {
      this.breathPanner.positionX.value = x;
      this.breathPanner.positionY.value = y;
      this.breathPanner.positionZ.value = z;
    } else {
      this.breathPanner.setPosition(x, y, z);
    }
  }

  setChase(on) {
    if (!this.started) return;
    if (on) this._startChase();
    else this._stopChase();
  }

  setBlackout(on) {
    if (!this.droneGain) return;
    const now = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(on ? 0.02 : 0.22, now, 0.08);
    this.rainGain.gain.setTargetAtTime(on ? 0.02 : 0.18, now, 0.1);
  }

  footstep(sprint) {
    this._noiseBurst({
      dur: 0.09,
      freq: sprint ? 180 : 240,
      q: 0.8,
      gain: sprint ? 0.16 : 0.09,
      type: 'lowpass',
    });
  }

  doorCreak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.7);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.7);
    filter.Q.value = 4;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.85);
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 0.8);
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    n.connect(filter);
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    this._sendWet(g, 0.5);
    osc.start();
    n.start();
    osc.stop(ctx.currentTime + 0.9);
    n.stop(ctx.currentTime + 0.9);
  }

  doorSlam(x, y, z) {
    this._boom(70, 0.45, 0.55, x, y, z);
    this._noiseBurst({ dur: 0.25, freq: 400, q: 0.6, gain: 0.4, type: 'lowpass', x, y, z });
  }

  doorRattle() {
    this._noiseBurst({ dur: 0.12, freq: 900, q: 2, gain: 0.18, type: 'bandpass' });
    this._noiseBurst({ dur: 0.08, freq: 1400, q: 3, gain: 0.1, type: 'bandpass', delay: 0.09 });
  }

  unlock(x, y, z) {
    this._tone(880, 0.12, 'square', 0.06, 0.04, x, y, z);
    this._tone(1320, 0.18, 'sine', 0.04, 0.1, x, y, z);
  }

  keyPickup() {
    this._tone(740, 0.18, 'sine', 0.07, 0.0);
    this._tone(1180, 0.28, 'sine', 0.05, 0.06);
  }

  batteryPickup() {
    this._tone(520, 0.12, 'sine', 0.06, 0.0);
    this._tone(780, 0.16, 'triangle', 0.04, 0.05);
  }

  whisper() {
    this._noiseBurst({
      dur: 0.7 + Math.random() * 0.5,
      freq: 1400 + Math.random() * 800,
      q: 6,
      gain: 0.07,
      type: 'bandpass',
      pan: Math.random() * 1.6 - 0.8,
    });
  }

  creak() {
    this._tone(180 + Math.random() * 80, 0.4, 'triangle', 0.05, 0, null, null, null, Math.random() * 1.4 - 0.7);
  }

  knock() {
    const pan = Math.random() * 1.6 - 0.8;
    this._boom(140, 0.18, 0.16, null, null, null, pan);
    if (Math.random() < 0.5) this._boom(110, 0.14, 0.1, null, null, null, pan, 0.22);
  }

  thump() {
    this._boom(48, 0.6, 0.4);
  }

  stinger() {
    if (!this.ctx) return;
    this._boom(55, 0.35, 0.6);
    this._cluster([180, 190, 270, 275], 0.55, 0.2);
    this._noiseBurst({ dur: 0.3, freq: 900, q: 0.7, gain: 0.28, type: 'bandpass' });
  }

  growl() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(42, ctx.currentTime + 1.1);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 240;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.3);
    osc.connect(f);
    f.connect(g);
    g.connect(this.master);
    this._sendWet(g, 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 1.35);
  }

  scream() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(640, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.7);
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(810, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.65);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1400, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.6);
    f.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.55, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.85);
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 0.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(f);
    osc2.connect(f);
    n.connect(ng);
    ng.connect(f);
    f.connect(g);
    g.connect(this.master);
    osc.start();
    osc2.start();
    n.start();
    osc.stop(ctx.currentTime + 0.9);
    osc2.stop(ctx.currentTime + 0.9);
    n.stop(ctx.currentTime + 0.7);
  }

  shriek() {
    this._cluster([600, 640, 910], 0.35, 0.16);
    this._noiseBurst({ dur: 0.22, freq: 1800, q: 2, gain: 0.16, type: 'highpass' });
  }

  thunder() {
    this._boom(40, 1.4, 0.5);
    this._noiseBurst({ dur: 1.3, freq: 280, q: 0.4, gain: 0.35, type: 'lowpass' });
    this._noiseBurst({ dur: 0.4, freq: 900, q: 0.5, gain: 0.12, type: 'highpass', delay: 0.02 });
  }

  cabinetBang(x, y, z) {
    this._boom(160, 0.2, 0.35, x, y, z);
    this._noiseBurst({ dur: 0.15, freq: 600, q: 1, gain: 0.22, type: 'bandpass', x, y, z });
  }

  calm() {
    this.setChase(false);
    this.setBlackout(false);
    this.heartbeatLevel = 0;
    this.setBreath(0, 0, 0, 0);
  }

  _startDrone() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoG.gain.value = 140;
    lfo.connect(lfoG);
    lfoG.connect(filter.frequency);
    lfo.start();

    const freqs = [42, 63.2, 84.5];
    const levels = [0.18, 0.08, 0.04];
    for (let i = 0; i < freqs.length; i++) {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = freqs[i];
      const g = ctx.createGain();
      g.gain.value = levels[i];
      o.connect(g);
      g.connect(filter);
      o.start();
    }
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 2);
    n.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = 0.08;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 30;
    n.connect(hp);
    hp.connect(ng);
    ng.connect(filter);
    n.start();
    filter.connect(gain);
    gain.connect(this.master);
    this._sendWet(gain, 0.35);
    this.droneGain = gain;
  }

  _startRain() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 2);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();
    this.rainGain = g;
    this._rainBed = src;
  }

  _startBreath() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 2);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 220;
    bp.Q.value = 1.4;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.28;
    lfoG.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    lfo.connect(lfoG);
    const base = ctx.createGain();
    base.gain.value = 0.35;
    lfoG.connect(base.gain);
    src.connect(bp);
    bp.connect(base);
    base.connect(g);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.4;
    panner.maxDistance = 14;
    panner.rolloffFactor = 1.4;
    g.connect(panner);
    panner.connect(this.master);
    this._sendWet(panner, 0.45);
    src.start();
    lfo.start();
    this.breathGain = g;
    this.breathPanner = panner;
  }

  _startChase() {
    this._stopChase();
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 1.2);
    g.connect(this.master);
    this.chaseGain = g;

    const bass = ctx.createOscillator();
    bass.type = 'sawtooth';
    bass.frequency.value = 55;
    const bg = ctx.createGain();
    bg.gain.value = 0;
    bass.connect(bg);
    bg.connect(g);
    bass.start();

    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'triangle';
    b.type = 'triangle';
    a.frequency.value = 220;
    b.frequency.value = 233;
    const hg = ctx.createGain();
    hg.gain.value = 0.08;
    a.connect(hg);
    b.connect(hg);
    hg.connect(g);
    a.start();
    b.start();

    this._chaseNodes = [bass, a, b, g];
    this._pulse = 0;
    this._bassGate = bg;
    if (!this._chaseTimer) {
      this._chaseTimer = setInterval(() => {
        if (!this._bassGate || !this.ctx) return;
        const t = this.ctx.currentTime;
        this._bassGate.gain.cancelScheduledValues(t);
        this._bassGate.gain.setValueAtTime(0.35, t);
        this._bassGate.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      }, 430);
    }
  }

  _stopChase() {
    if (this._chaseTimer) {
      clearInterval(this._chaseTimer);
      this._chaseTimer = null;
    }
    if (!this.ctx || !this._chaseNodes.length) {
      this._chaseNodes = [];
      this.chaseGain = null;
      this._bassGate = null;
      return;
    }
    const t = this.ctx.currentTime;
    try {
      this.chaseGain.gain.cancelScheduledValues(t);
      this.chaseGain.gain.setTargetAtTime(0.0001, t, 0.15);
    } catch {
      /* already stopped */
    }
    const nodes = this._chaseNodes;
    setTimeout(() => {
      for (const n of nodes) {
        try { n.stop?.(); } catch { /* ignore */ }
        try { n.disconnect?.(); } catch { /* ignore */ }
      }
    }, 400);
    this._chaseNodes = [];
    this.chaseGain = null;
    this._bassGate = null;
  }

  _sendWet(node, amount) {
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.convolver);
  }

  _panner(x, y, z, pan) {
    if (x != null && y != null && z != null) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1.6;
      p.maxDistance = 18;
      p.rolloffFactor = 1.2;
      if (p.positionX) {
        p.positionX.value = x;
        p.positionY.value = y;
        p.positionZ.value = z;
      } else {
        p.setPosition(x, y, z);
      }
      return p;
    }
    const s = this.ctx.createStereoPanner();
    s.pan.value = pan || 0;
    return s;
  }

  _route(node, x, y, z, pan, wet) {
    const p = this._panner(x, y, z, pan);
    node.connect(p);
    p.connect(this.master);
    if (wet) this._sendWet(p, wet);
  }

  _tone(freq, dur, type, gain, delay = 0, x = null, y = null, z = null, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this._route(g, x, y, z, pan, 0.25);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _cluster(freqs, dur, gain) {
    for (const f of freqs) this._tone(f, dur, 'sawtooth', gain / freqs.length);
  }

  _boom(freq, dur, gain, x = null, y = null, z = null, pan = 0, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this._route(g, x, y, z, pan, 0.4);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _thump(gain, when) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(58, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  _noiseBurst({ dur, freq, q, gain, type, delay = 0, x = null, y = null, z = null, pan = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, dur + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    this._route(g, x, y, z, pan, 0.3);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
