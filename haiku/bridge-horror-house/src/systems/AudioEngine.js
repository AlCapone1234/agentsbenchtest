// Everything here is synthesized with the Web Audio API. There are no audio files.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.heartOn = false;
    this.bpm = 70;
    this.heartLevel = 1;
    this.nextBeat = 0;
    this.chaseOn = false;
    this.nextStepT = 0;
    this.stepIndex = 0;
    this.stepDur = 60 / 138 / 2;
  }

  // Must run inside a user gesture (the title click), or the browser keeps audio muted.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Dry + convolution reverb bus. Every one-shot goes through here.
    this.bus = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    this.bus.connect(dry);
    dry.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.makeIR(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.bus.connect(this.verb);
    this.verb.connect(wet);
    wet.connect(this.master);

    // Loud events are soft-clipped before the bus so stingers punch without harshness.
    this.distIn = ctx.createGain();
    this.distIn.gain.value = 0.7;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.makeDist(4);
    shaper.oversample = '2x';
    this.distIn.connect(shaper);
    shaper.connect(this.bus);

    this.noise = this.makeNoise(4);
    this.buildAmbience();
    this.buildChaseBus();
    this.buildBreath();
    this.timer = setInterval(() => this.tick(), 25);
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  makeNoise(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Stereo decaying noise: a cheap, convincing room impulse.
  makeIR(dur, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeDist(k) {
    const n = 1024;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Drone, rain and wind run continuously.
  buildAmbience() {
    const ctx = this.ctx;
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.amb.connect(this.master);

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
    lp.Q.value = 0.7;
    lp.connect(this.droneGain);
    this.droneGain.connect(this.amb);
    this.droneOsc = [];
    for (const [type, f] of [['sawtooth', 38.9], ['sawtooth', 39.6], ['sine', 19.5]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      this.droneOsc.push(o);
    }

    const rain = ctx.createBufferSource();
    rain.buffer = this.noise;
    rain.loop = true;
    const rbp = ctx.createBiquadFilter();
    rbp.type = 'bandpass';
    rbp.frequency.value = 3800;
    rbp.Q.value = 0.5;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.11;
    rain.connect(rbp);
    rbp.connect(this.rainGain);
    this.rainGain.connect(this.amb);
    rain.start();
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.09;
    const gustAmt = ctx.createGain();
    gustAmt.gain.value = 0.04;
    gust.connect(gustAmt);
    gustAmt.connect(this.rainGain.gain);
    gust.start();

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 420;
    wlp.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.07;
    wind.connect(wlp);
    wlp.connect(this.windGain);
    this.windGain.connect(this.amb);
    wind.start();
    const wob = ctx.createOscillator();
    wob.frequency.value = 0.031;
    const wobAmt = ctx.createGain();
    wobAmt.gain.value = 0.04;
    wob.connect(wobAmt);
    wobAmt.connect(this.windGain.gain);
    wob.start();
  }

  buildChaseBus() {
    const ctx = this.ctx;
    this.chaseIn = ctx.createBiquadFilter();
    this.chaseIn.type = 'lowpass';
    this.chaseIn.frequency.value = 900;
    this.chaseIn.Q.value = 1;
    this.chaseBus = ctx.createGain();
    this.chaseBus.gain.value = 0;
    this.chaseIn.connect(this.chaseBus);
    this.chaseBus.connect(this.bus);
  }

  // Entity breathing: noise through a formant band, panned to where the entity is.
  buildBreath() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 480;
    bp.Q.value = 1.4;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    this.breathPan = ctx.createStereoPanner();
    src.connect(bp);
    bp.connect(this.breathGain);
    this.breathGain.connect(this.breathPan);
    this.breathPan.connect(this.master);
    src.start();
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  // Stereo pan and distance attenuation for a world position, relative to the listener.
  spatial(x, z) {
    const { x: lx, z: lz, yaw } = this.listener;
    const dx = x - lx, dz = z - lz;
    const dist = Math.hypot(dx, dz) || 0.001;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const pan = clamp(((dx * rx + dz * rz) / dist) * 0.9, -0.9, 0.9);
    return { pan, atten: 1 / (1 + dist * 0.35) };
  }

  panner(pan) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    return p;
  }

  // Filtered noise burst with an amplitude envelope.
  noiseVoice({ at = null, dur = 0.5, gain = 0.4, type = 'bandpass', freq = 1000, q = 1, sweepTo = null, attack = 0.005, pan = 0, dest = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const p = this.panner(pan);
    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(dest || this.bus);
    src.start(t0, Math.random() * 3, dur + 0.05);
    src.stop(t0 + dur + 0.1);
  }

  // Oscillator with an envelope. vib adds a vibrato LFO in Hz (depth vibDepth in Hz).
  tone({ at = null, type = 'sine', freq = 110, freqTo = null, dur = 1, gain = 0.3, attack = 0.01, pan = 0, dest = null, vib = 0, vibDepth = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
    if (vib) {
      const l = ctx.createOscillator();
      l.frequency.value = vib;
      const d = ctx.createGain();
      d.gain.value = vibDepth;
      l.connect(d);
      d.connect(o.frequency);
      l.start(t0);
      l.stop(t0 + dur + 0.1);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const p = this.panner(pan);
    o.connect(g);
    g.connect(p);
    p.connect(dest || this.bus);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  // ---- ambience control ----

  setTension(v) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0.05 + 0.12 * v, now, 0.8);
    this.droneOsc[0].frequency.setTargetAtTime(38.9 + 8 * v, now, 1.0);
  }

  // Breath follows the entity: louder and closer as it approaches. Called every frame.
  setBreath(level, x, z) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const sp = this.spatial(x, z);
    const breathe = 0.6 + 0.4 * Math.sin(now * 1.9);
    this.breathPan.pan.setTargetAtTime(clamp(sp.pan, -1, 1), now, 0.05);
    this.breathGain.gain.setTargetAtTime(clamp(level, 0, 1) * sp.atten * 0.9 * breathe, now, 0.05);
  }

  setHeart(on, bpm = 70, level = 1) {
    this.heartOn = on;
    this.bpm = bpm;
    this.heartLevel = level;
  }

  setChase(on) {
    this.chaseOn = on;
    if (!this.ctx) return;
    this.chaseBus.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, on ? 0.4 : 0.6);
  }

  // Ducks drone, rain and wind (blackout beat, cutscene moments).
  duck(on) {
    if (!this.ctx) return;
    this.amb.gain.setTargetAtTime(on ? 0.02 : 1, this.ctx.currentTime, 0.2);
  }

  stopAll() {
    this.chaseOn = false;
    this.heartOn = false;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.chaseBus.gain.setTargetAtTime(0, now, 0.3);
    this.breathGain.gain.setTargetAtTime(0, now, 0.1);
    this.amb.gain.setTargetAtTime(0.25, now, 0.5);
  }

  // Scheduler: heartbeat and chase sequencer run ahead of the clock for tight timing.
  tick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.heartOn) {
      if (this.nextBeat < now) this.nextBeat = now + 0.05;
      while (this.nextBeat < now + 0.2) {
        this.beat(this.nextBeat);
        this.nextBeat += 60 / this.bpm;
      }
    } else {
      this.nextBeat = now;
    }
    if (this.chaseOn) {
      if (this.nextStepT < now) this.nextStepT = now + 0.05;
      while (this.nextStepT < now + 0.2) {
        this.chaseStep(this.nextStepT, this.stepIndex);
        this.stepIndex = (this.stepIndex + 1) % 16;
        this.nextStepT += this.stepDur;
      }
    } else {
      this.nextStepT = now;
    }
  }

  beat(t) {
    const lvl = this.heartLevel;
    this.tone({ at: t, type: 'sine', freq: 70, freqTo: 42, dur: 0.16, gain: 0.45 * lvl, attack: 0.012, dest: this.master });
    this.tone({ at: t + 0.24, type: 'sine', freq: 58, freqTo: 36, dur: 0.14, gain: 0.3 * lvl, attack: 0.012, dest: this.master });
  }

  // 16-step bass pattern in E with a dissonant pad on the downbeat.
  chaseStep(t, i) {
    const pattern = [0, -1, 0, 3, 0, -1, 5, 0, 0, -1, 0, 3, 0, -1, 7, 5];
    const semi = pattern[i];
    if (semi >= 0) {
      this.tone({ at: t, type: 'sawtooth', freq: 41.2 * Math.pow(2, semi / 12), dur: this.stepDur * 0.8, gain: 0.5, attack: 0.004, dest: this.chaseIn });
    }
    if (i === 0) {
      for (const f of [155.56, 164.81, 233.08]) {
        this.tone({ at: t, type: 'sawtooth', freq: f, dur: 3.4, gain: 0.05, attack: 0.9, dest: this.chaseIn, vib: 0.3, vibDepth: 2 });
      }
    }
    if (i === 8) {
      this.tone({ at: t, type: 'square', freq: 1244, freqTo: 1100, dur: 0.12, gain: 0.05, attack: 0.002, dest: this.chaseIn });
    }
  }

  // ---- one-shots ----

  thunder(delay = 1) {
    if (!this.ctx) return;
    const t = this.now() + delay;
    this.noiseVoice({ at: t, dur: 6, gain: 0.9, type: 'lowpass', freq: 170, q: 0.6, attack: 0.06, pan: (Math.random() - 0.5) * 0.6 });
    this.tone({ at: t, type: 'sine', freq: 44, freqTo: 24, dur: 4.5, gain: 0.7, attack: 0.05 });
  }

  // Loud: only at scare moments.
  stinger() {
    if (!this.ctx) return;
    const t = this.now();
    this.noiseVoice({ at: t, dur: 1.3, gain: 0.9, type: 'highpass', freq: 1200, q: 0.5, attack: 0.002, dest: this.distIn });
    for (const f of [110, 139, 165]) {
      this.tone({ at: t, type: 'sawtooth', freq: f, dur: 1.6, gain: 0.22, attack: 0.003, dest: this.distIn });
    }
    this.tone({ at: t, type: 'sine', freq: 46, freqTo: 30, dur: 1.4, gain: 0.8, attack: 0.003, dest: this.distIn });
  }

  scream() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone({ at: t, type: 'sawtooth', freq: 320, freqTo: 1300, dur: 1.9, gain: 0.32, attack: 0.02, vib: 7, vibDepth: 40, dest: this.distIn });
    this.noiseVoice({ at: t, dur: 1.9, gain: 0.6, type: 'bandpass', freq: 3200, q: 0.9, attack: 0.02, dest: this.distIn });
    this.tone({ at: t + 0.05, type: 'sawtooth', freq: 640, freqTo: 2000, dur: 1.3, gain: 0.1, attack: 0.03, dest: this.distIn });
  }

  growl() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone({ at: t, type: 'sawtooth', freq: 62, freqTo: 44, dur: 2.4, gain: 0.45, attack: 0.3, vib: 7, vibDepth: 6, dest: this.distIn });
    this.tone({ at: t, type: 'sine', freq: 31, dur: 2.4, gain: 0.6, attack: 0.3, dest: this.distIn });
    this.noiseVoice({ at: t, dur: 2.4, gain: 0.3, type: 'lowpass', freq: 240, q: 1, attack: 0.3, dest: this.distIn });
  }

  // Entity banished: a short shriek.
  shriek() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone({ at: t, type: 'sine', freq: 2400, freqTo: 520, dur: 0.9, gain: 0.5, attack: 0.005, dest: this.distIn });
    this.noiseVoice({ at: t, dur: 0.6, gain: 0.45, type: 'highpass', freq: 2200, q: 0.7, attack: 0.003, dest: this.distIn });
  }

  // Entity footsteps (or a soft stomp), spatialised.
  thud(x, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    this.noiseVoice({ dur: 0.25, gain: 0.5 * s.atten, type: 'lowpass', freq: 240, q: 0.8, attack: 0.004, pan: s.pan });
    this.tone({ type: 'sine', freq: 70, freqTo: 40, dur: 0.3, gain: 0.5 * s.atten, attack: 0.005, pan: s.pan });
  }

  footstep(sprint) {
    if (!this.ctx) return;
    const v = sprint ? 1.4 : 1;
    this.noiseVoice({ dur: 0.1, gain: 0.16 * v, type: 'lowpass', freq: 520, q: 0.7, attack: 0.003, pan: (Math.random() - 0.5) * 0.3 });
    this.tone({ type: 'sine', freq: 95 + Math.random() * 25, freqTo: 60, dur: 0.12, gain: 0.12 * v, attack: 0.004 });
  }

  creak(x, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    this.noiseVoice({ dur: 1.1, gain: 0.35 * s.atten, type: 'bandpass', freq: 180, sweepTo: 520, q: 6, attack: 0.1, pan: s.pan });
    this.tone({ type: 'sawtooth', freq: 78, freqTo: 112, dur: 1.2, gain: 0.05 * s.atten, attack: 0.2, pan: s.pan, vib: 5, vibDepth: 4 });
  }

  // Three syllable-like bursts of formant noise. Felt more than understood.
  whisper(x, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    const t = this.now();
    for (let k = 0; k < 3; k++) {
      this.noiseVoice({
        at: t + k * 0.42 + Math.random() * 0.1,
        dur: 0.38,
        gain: 0.07 * s.atten,
        type: 'bandpass',
        freq: 1200 + Math.random() * 400,
        sweepTo: 800 + Math.random() * 500,
        q: 5,
        attack: 0.05,
        pan: s.pan,
      });
    }
  }

  knock(x, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    const t = this.now();
    for (let k = 0; k < 3; k++) {
      const at = t + k * (0.36 + Math.random() * 0.1);
      this.tone({ at, type: 'sine', freq: 88, freqTo: 52, dur: 0.16, gain: 0.55 * s.atten, attack: 0.002, pan: s.pan });
      this.noiseVoice({ at, dur: 0.035, gain: 0.25 * s.atten, type: 'bandpass', freq: 1800, q: 2, attack: 0.001, pan: s.pan });
    }
  }

  thump(x, z, far = false) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    const a = far ? 0.35 : 1;
    this.tone({ type: 'sine', freq: 52, freqTo: 28, dur: 1.0, gain: 0.5 * s.atten * a, attack: 0.01, pan: s.pan });
    this.noiseVoice({ dur: 0.7, gain: 0.25 * s.atten * a, type: 'lowpass', freq: 130, q: 0.7, attack: 0.02, pan: s.pan });
  }

  // Door slam: heavy, loud, goes through the clipper.
  slam(x, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    this.noiseVoice({ dur: 0.6, gain: 0.9, type: 'lowpass', freq: 260, q: 0.7, attack: 0.002, pan: s.pan, dest: this.distIn });
    this.tone({ type: 'sine', freq: 70, freqTo: 34, dur: 0.5, gain: 0.8, attack: 0.002, pan: s.pan, dest: this.distIn });
    this.noiseVoice({ dur: 0.06, gain: 0.5, type: 'bandpass', freq: 1400, q: 1, attack: 0.001, pan: s.pan, dest: this.distIn });
  }

  bang(x, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    this.noiseVoice({ dur: 0.3, gain: 0.7 * s.atten, type: 'lowpass', freq: 1200, q: 0.7, attack: 0.001, pan: s.pan, dest: this.distIn });
    this.tone({ type: 'triangle', freq: 220, freqTo: 140, dur: 0.22, gain: 0.4 * s.atten, attack: 0.001, pan: s.pan, dest: this.distIn });
  }

  doorCreak(x, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, z);
    this.noiseVoice({ dur: 1.4, gain: 0.3 * s.atten, type: 'bandpass', freq: 300, sweepTo: 650, q: 8, attack: 0.2, pan: s.pan });
    this.tone({ type: 'sawtooth', freq: 150, freqTo: 95, dur: 1.4, gain: 0.04 * s.atten, attack: 0.25, pan: s.pan, vib: 4, vibDepth: 6 });
  }

  // A distant music box, rare and very quiet.
  musicBox() {
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 698.46, 587.33, 783.99, 880.0, 659.25];
    const t = this.now();
    const pan = (Math.random() - 0.5) * 1.2;
    notes.forEach((f, k) => {
      this.tone({ at: t + k * 0.42, type: 'sine', freq: f, dur: 2.6, gain: 0.05, attack: 0.004, pan });
      this.tone({ at: t + k * 0.42, type: 'triangle', freq: f * 2, dur: 1.2, gain: 0.012, attack: 0.002, pan });
    });
  }

  keyChime() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone({ at: t, type: 'sine', freq: 1318, dur: 0.9, gain: 0.22, attack: 0.004 });
    this.tone({ at: t + 0.06, type: 'sine', freq: 1975, dur: 1.0, gain: 0.12, attack: 0.004 });
  }

  batteryClick() {
    if (!this.ctx) return;
    this.noiseVoice({ dur: 0.05, gain: 0.3, type: 'highpass', freq: 2500, q: 0.7, attack: 0.001 });
    this.tone({ type: 'sine', freq: 220, dur: 0.06, gain: 0.15, attack: 0.002 });
  }

  noteRustle() {
    if (!this.ctx) return;
    this.noiseVoice({ dur: 0.5, gain: 0.12, type: 'highpass', freq: 3000, q: 0.5, attack: 0.05 });
  }

  // Front door with too few keys.
  lockedRattle() {
    if (!this.ctx) return;
    this.noiseVoice({ dur: 0.25, gain: 0.3, type: 'bandpass', freq: 2200, q: 2, attack: 0.002 });
    this.tone({ type: 'sine', freq: 90, dur: 0.15, gain: 0.2, attack: 0.002 });
  }
}
