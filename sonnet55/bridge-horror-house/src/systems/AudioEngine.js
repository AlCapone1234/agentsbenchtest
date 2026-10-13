// Everything you hear is synthesized here with the Web Audio API. No audio files.
const rnd = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() {
    this.ctx = null; this.ready = false;
    this.tension = 0; this.danger = 0; this._tension = 0;
    this.entity = { pos: null, level: 0 };
    this.beatT = 0; this.breathPhase = 0;
    this.chase = { on: false, step: 0, next: 0, bpm: 146 };
    this.lastStepSound = 0;
  }

  // ------------------------------------------------------------ setup
  start() {
    if (this.ready) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx({ latencyHint: 'interactive' }));
    this.master = ctx.createGain(); this.master.gain.value = 0.0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(3.2);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 1;
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.85;
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this.noiseBuf = this._noiseBuffer(4);
    this.ready = true;
    this._buildBeds();
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
  }
  suspend() { if (this.ready) this.ctx.suspend(); }
  resume() { if (this.ready) this.ctx.resume(); }
  fadeMaster(to, tc = 0.4) { if (this.ready) this.master.gain.setTargetAtTime(to, this.ctx.currentTime, tc); }

  _impulse(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sec * sr), buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, amp = Math.pow(1 - i / n, 2.6) * Math.exp(-t * 0.9);
        const k = 0.08 + 0.85 * Math.min(1, t / 1.8); // progressively darker tail
        lp += ((Math.random() * 2 - 1) - lp) * (1 - k);
        d[i] = lp * amp * (i < sr * 0.012 ? i / (sr * 0.012) : 1) * 2.2;
      }
    }
    return buf;
  }
  _noiseBuffer(sec) {
    const ctx = this.ctx, n = Math.floor(sec * ctx.sampleRate), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    return buf;
  }
  _noise(loop = false) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop;
    return s;
  }

  // ------------------------------------------------------------ routing helpers
  _out(pos, wet = 0.3, { ref = 1.6, rolloff = 1.0 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    if (pos) {
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 80;
      this._setPanner(p, pos);
      g.connect(p); p.connect(this.dry);
      const s = ctx.createGain(); s.gain.value = wet; p.connect(s); s.connect(this.reverbIn);
      g.panner = p;
    } else {
      g.connect(this.dry);
      const s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(this.reverbIn);
    }
    return g;
  }
  _setPanner(p, pos) {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
  }
  _env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _osc(type, f, t0, t1, dest) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0); o.connect(dest); o.start(t0); o.stop(t1); return o;
  }
  _burst(t0, dur, dest, type = 'lowpass', f = 800, q = 0.7, off) {
    const s = this._noise(); const flt = this.ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    s.connect(flt); flt.connect(dest); s.start(t0, off ?? rnd(0, 3), dur); return { s, flt };
  }
  setListener(pos, fwd) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y + 1.6; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(pos.x, pos.y + 1.6, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }

  // ------------------------------------------------------------ continuous beds
  _buildBeds() {
    const ctx = this.ctx, t = ctx.currentTime;
    // drone
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0; this.droneGain.connect(this.dry);
    const dsend = ctx.createGain(); dsend.gain.value = 0.5; this.droneGain.connect(dsend); dsend.connect(this.reverbIn);
    this.droneLP = ctx.createBiquadFilter(); this.droneLP.type = 'lowpass'; this.droneLP.frequency.value = 130; this.droneLP.Q.value = 3; this.droneLP.connect(this.droneGain);
    [[41.2, 'sawtooth', 0.55], [41.8, 'sawtooth', 0.5], [58.3, 'sine', 0.5], [82.6, 'triangle', 0.18]].forEach(([f, ty, v]) => {
      const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(this.droneLP); o.start(t);
      const lfo = ctx.createOscillator(); lfo.frequency.value = rnd(0.03, 0.11); const lg = ctx.createGain(); lg.gain.value = f * 0.012; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t);
    });
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.06; const lg2 = ctx.createGain(); lg2.gain.value = 40; lfo2.connect(lg2); lg2.connect(this.droneLP.frequency); lfo2.start(t);
    // dissonant high pad that blooms with tension
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0; this.padGain.connect(this.dry); const psend = ctx.createGain(); psend.gain.value = 0.8; this.padGain.connect(psend); psend.connect(this.reverbIn);
    [1318.5, 1396.9, 987.8, 740].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.25;
      const trem = ctx.createOscillator(); trem.frequency.value = rnd(0.2, 0.7); const tg = ctx.createGain(); tg.gain.value = 0.2; trem.connect(tg); tg.connect(g.gain);
      o.connect(g); g.connect(this.padGain); o.start(t); trem.start(t);
    });
    // rain: broadband hiss + roof thrum
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0.0; this.rainGain.connect(this.dry);
    const rsend = ctx.createGain(); rsend.gain.value = 0.25; this.rainGain.connect(rsend); rsend.connect(this.reverbIn);
    const r1 = this._noise(true); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const g1 = ctx.createGain(); g1.gain.value = 0.5; r1.connect(hp); hp.connect(lp); lp.connect(g1); g1.connect(this.rainGain); r1.start(t, 0);
    const r2 = this._noise(true); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.8; const g2 = ctx.createGain(); g2.gain.value = 0.55; r2.connect(bp); bp.connect(g2); g2.connect(this.rainGain); r2.start(t, 1.7);
    this.rainGain.gain.setTargetAtTime(0.085, t, 2);
    // wind
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0; this.windGain.connect(this.dry);
    const w = this._noise(true); const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 260; wbp.Q.value = 2.2; w.connect(wbp); wbp.connect(this.windGain); w.start(t, 2.4);
    const wl = ctx.createOscillator(); wl.frequency.value = 0.09; const wlg = ctx.createGain(); wlg.gain.value = 150; wl.connect(wlg); wlg.connect(wbp.frequency); wl.start(t);
    const wl2 = ctx.createOscillator(); wl2.frequency.value = 0.13; const wlg2 = ctx.createGain(); wlg2.gain.value = 0.03; wl2.connect(wlg2); wlg2.connect(this.windGain.gain); wl2.start(t);
    this.windGain.gain.setTargetAtTime(0.045, t, 3);
    this.droneGain.gain.setTargetAtTime(0.14, t, 3);
    // entity breath
    this.breathOut = ctx.createGain(); this.breathOut.gain.value = 0;
    const bs = this._noise(true); this.breathBP = ctx.createBiquadFilter(); this.breathBP.type = 'bandpass'; this.breathBP.frequency.value = 900; this.breathBP.Q.value = 1.1;
    bs.connect(this.breathBP); this.breathBP.connect(this.breathOut);
    // spatial: panner for breath
    this.breathPan = ctx.createPanner(); this.breathPan.panningModel = 'HRTF'; this.breathPan.distanceModel = 'inverse'; this.breathPan.refDistance = 1.5; this.breathPan.rolloffFactor = 1.1;
    this.breathOut.connect(this.breathPan); this.breathPan.connect(this.dry); const bsend = ctx.createGain(); bsend.gain.value = 0.4; this.breathPan.connect(bsend); bsend.connect(this.reverbIn);
    bs.start(t, 0.8);
    // low presence hum when he's near
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0; this.humGain.connect(this.dry);
    [36.7, 38.9, 73.4].forEach((f) => { const o = ctx.createOscillator(); o.type = f > 60 ? 'triangle' : 'sawtooth'; o.frequency.value = f; const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 160; o.connect(lp2); lp2.connect(this.humGain); o.start(t); });
    // chase music bus
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.dry); const msend = ctx.createGain(); msend.gain.value = 0.35; this.musicGain.connect(msend); msend.connect(this.reverbIn);
    this.strings = [0, 1].map((i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 330 + i * 7; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.5;
      const g = ctx.createGain(); g.gain.value = 0.045; const tr = ctx.createOscillator(); tr.frequency.value = 6.5 + i; const trg = ctx.createGain(); trg.gain.value = 0.03; tr.connect(trg); trg.connect(g.gain);
      o.connect(f); f.connect(g); g.connect(this.musicGain); o.start(t); tr.start(t); return o;
    });
    // random ambient scheduler is driven by ScareDirector; drips are autonomous
    this.nextDrip = ctx.currentTime + rnd(3, 8);
  }

  setTension(v) { this.tension = Math.max(0, Math.min(1, v)); }
  setDanger(v) { this.danger = Math.max(0, Math.min(1, v)); }
  setEntity(pos, level) { this.entity.pos = pos; this.entity.level = level; }

  update(dt) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    // tension -> drone/pad
    this._tension += (this.tension - this._tension) * Math.min(1, dt * 0.8);
    this.droneGain.gain.setTargetAtTime(0.14 + this._tension * 0.18, now, 0.6);
    this.droneLP.Q.value = 3 + this._tension * 6;
    this.padGain.gain.setTargetAtTime(0.004 + this._tension * 0.035, now, 0.8);
    // entity breath + hum
    const e = this.entity;
    if (e.pos && e.level > 0.01) {
      this._setPanner(this.breathPan, e.pos);
      const rate = 0.28 + e.level * 0.34;
      this.breathPhase += dt * rate * Math.PI * 2;
      const ph = (this.breathPhase / (Math.PI * 2)) % 1;
      const amp = ph < 0.42 ? Math.sin((ph / 0.42) * Math.PI) : (ph < 0.55 ? 0 : Math.pow(Math.sin(((ph - 0.55) / 0.45) * Math.PI), 1.4) * 0.8);
      this.breathOut.gain.setTargetAtTime(amp * (0.15 + e.level * 0.95), now, 0.03);
      this.breathBP.frequency.setTargetAtTime(600 + amp * 700 + e.level * 400, now, 0.05);
      this.humGain.gain.setTargetAtTime(e.level * 0.16, now, 0.2);
    } else { this.breathOut.gain.setTargetAtTime(0, now, 0.1); this.humGain.gain.setTargetAtTime(0, now, 0.3); }
    // heartbeat
    if (this.danger > 0.04) {
      this.beatT -= dt;
      if (this.beatT <= 0) { this._beat(); this.beatT = 60 / (62 + this.danger * 105); }
    } else this.beatT = 0;
    // chase music scheduler
    if (this.chase.on) this._music();
    // random drips
    if (now > this.nextDrip) { this.drip({ x: rnd(-8, 8), y: 1.5, z: rnd(-6, 6) }); this.nextDrip = now + rnd(4, 11); }
  }

  _beat() {
    const t = this.ctx.currentTime, v = Math.pow(this.danger, 0.8) * 1.9;
    const g = this.ctx.createGain(); g.connect(this.dry);
    this._env(g, t, 0.006, v, 0.16); this._thump(t, g, 70, 38);
    const m = this.ctx.createGain(); m.connect(this.dry); this._env(m, t, 0.004, v * 0.55, 0.09); this._burst(t, 0.12, m, 'lowpass', 240, 0.8);
    const g2 = this.ctx.createGain(); g2.connect(this.dry);
    this._env(g2, t + 0.17, 0.006, v * 0.75, 0.14); this._thump(t + 0.17, g2, 60, 34);
    const m2 = this.ctx.createGain(); m2.connect(this.dry); this._env(m2, t + 0.17, 0.004, v * 0.4, 0.08); this._burst(t + 0.17, 0.1, m2, 'lowpass', 200, 0.8);
  }
  _thump(t, dest, f0, f1) {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.14); o.connect(dest); o.start(t); o.stop(t + 0.25);
  }

  // ------------------------------------------------------------ one-shots
  footstep(sprint = false, surface = 'wood') {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.connect(this.dry); const s = ctx.createGain(); s.gain.value = 0.18; g.connect(s); s.connect(this.reverbIn);
    const v = sprint ? 0.34 : 0.17;
    this._env(g, t, 0.004, v * rnd(0.8, 1.1), sprint ? 0.12 : 0.1);
    this._burst(t, 0.15, g, surface === 'tile' ? 'bandpass' : 'lowpass', surface === 'tile' ? rnd(900, 1500) : rnd(260, 520), 1.0);
    const th = ctx.createGain(); th.connect(this.dry); this._env(th, t, 0.003, v * 0.7, 0.09); this._thump(t, th, rnd(95, 130), 55);
    if (surface === 'wood' && Math.random() < 0.07) this.creak(null, Math.random() < 0.5, 0.35);
  }
  creak(pos, opening = true, vol = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime, dur = rnd(0.9, 1.5);
    const out = this._out(pos, 0.5, { ref: 3 }); out.gain.value = 0.34 * vol;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = opening ? rnd(110, 150) : rnd(170, 220), f1 = opening ? rnd(220, 300) : rnd(100, 140);
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur * 0.7); o.frequency.linearRampToValueAtTime(f0 * 1.1, t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = rnd(6, 11); const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg); vg.connect(o.frequency);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(700, t); bp.frequency.linearRampToValueAtTime(1500, t + dur * 0.6); bp.frequency.linearRampToValueAtTime(900, t + dur); bp.Q.value = 7;
    const g = ctx.createGain(); this._env(g, t, dur * 0.15, 1, dur * 0.85);
    o.connect(bp); bp.connect(g); g.connect(out); o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
    const nz = ctx.createGain(); this._env(nz, t, 0.1, 0.35, dur); this._burst(t, dur + 0.1, nz, 'bandpass', 1800, 3); nz.connect(out);
  }
  slam(pos, power = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.7, { ref: 3 }); out.gain.value = 2.2 * power;
    const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.003, 1, 0.5);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.35); o.connect(g); o.start(t); o.stop(t + 0.6);
    const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.002, 0.9, 0.22); this._burst(t, 0.3, n, 'lowpass', 1400, 0.7);
    const c = ctx.createGain(); c.connect(out); this._env(c, t, 0.001, 0.35, 0.07); this._burst(t, 0.1, c, 'highpass', 2500, 0.7);
  }
  scrape(pos, dur = 1.2) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.45); out.gain.value = 0.55;
    const g = ctx.createGain(); g.connect(out);
    g.gain.setValueAtTime(0.0001, t); for (let i = 0; i < 12; i++) g.gain.linearRampToValueAtTime(rnd(0.15, 1), t + (i / 12) * dur); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const { flt } = this._burst(t, dur + 0.05, g, 'bandpass', 500, 2.2, rnd(0, 2.5));
    flt.frequency.setValueAtTime(380, t); flt.frequency.linearRampToValueAtTime(900, t + dur);
    const r = ctx.createGain(); r.connect(out); this._env(r, t, 0.1, 0.5, dur); this._burst(t, dur, r, 'lowpass', 160, 0.8);
  }
  thump(pos, vol = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.75, { ref: 3 }); out.gain.value = 1.6 * vol;
    const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.004, 1, 0.4); this._thump(t, g, 80, 30);
    const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.003, 0.7, 0.15); this._burst(t, 0.2, n, 'lowpass', 420, 0.7);
  }
  knock(pos, count = 3, gap = 0.2, vol = 1) {
    if (!this.ready) return; const ctx = this.ctx, t0 = ctx.currentTime;
    const out = this._out(pos, 0.5); out.gain.value = 0.9 * vol;
    for (let i = 0; i < count; i++) {
      const t = t0 + i * gap * rnd(0.9, 1.15);
      const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.002, 0.9, 0.09);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.08); o.connect(g); o.start(t); o.stop(t + 0.15);
      const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.001, 0.5, 0.04); this._burst(t, 0.06, n, 'bandpass', 1500, 1.2);
    }
  }
  whisper(pos, dur = 2.4, vol = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.8, { ref: 2.5 }); out.gain.value = 0.9 * vol;
    const vowels = [[520, 1700], [700, 1200], [350, 2300], [450, 900], [300, 800]];
    const syll = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < syll; i++) {
      const st = t + (i / syll) * dur + rnd(0, 0.08), len = (dur / syll) * rnd(0.5, 0.85), v = vowels[Math.floor(Math.random() * vowels.length)];
      const g = ctx.createGain(); g.connect(out); this._env(g, st, len * 0.3, rnd(0.5, 1), len * 0.7);
      const s = this._noise(); s.start(st, rnd(0, 3), len + 0.1);
      const sh = ctx.createBiquadFilter(); sh.type = 'highpass'; sh.frequency.value = 700; s.connect(sh);
      v.forEach((f, k) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * rnd(0.9, 1.1); bp.Q.value = 7; const bg = ctx.createGain(); bg.gain.value = k ? 0.7 : 1; sh.connect(bp); bp.connect(bg); bg.connect(g); });
    }
  }
  piano(pos, note = 0) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const f = 220 * Math.pow(2, [0, 1, 6, 7, 10, 3, 8][note % 7] / 12 + (Math.random() < 0.3 ? 1 : 0));
    const out = this._out(pos, 0.75); out.gain.value = 0.3;
    [1, 2, 3, 4.01, 5.02].forEach((m, i) => {
      const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.004, 0.5 / (i + 1), 2.8 / (i * 0.6 + 1));
      this._osc(i ? 'sine' : 'triangle', f * m * (1 + (Math.random() - 0.5) * 0.003), t, t + 3, g);
    });
  }
  drip(pos) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.7); out.gain.value = 0.16;
    const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.001, 1, 0.12);
    const o = ctx.createOscillator(); o.type = 'sine'; const f = rnd(1400, 2200); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.1); o.connect(g); o.start(t); o.stop(t + 0.2);
  }
  settle(pos, vol = 1) { // the house settling: a long groan + low rumble
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime, dur = rnd(1.8, 3.2);
    const out = this._out(pos, 0.65); out.gain.value = 0.35 * vol;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(rnd(55, 80), t); o.frequency.linearRampToValueAtTime(rnd(40, 100), t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 4;
    const g = ctx.createGain(); this._env(g, t, dur * 0.4, 0.9, dur * 0.6); o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.2);
  }
  growl(pos, vol = 1, dur = 2.2) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.6); out.gain.value = 0.9 * vol;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(48, t + dur);
    const fm = ctx.createOscillator(); fm.frequency.value = 26; const fg = ctx.createGain(); fg.gain.value = 20; fm.connect(fg); fg.connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(260, t); lp.frequency.linearRampToValueAtTime(700, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(180, t + dur); lp.Q.value = 6;
    const g = ctx.createGain(); this._env(g, t, 0.35, 1, dur); o.connect(lp); lp.connect(g); g.connect(out);
    const am = ctx.createOscillator(); am.frequency.value = 19; const ag = ctx.createGain(); ag.gain.value = 0.4; am.connect(ag); ag.connect(g.gain);
    o.start(t); fm.start(t); am.start(t); o.stop(t + dur + 0.3); fm.stop(t + dur + 0.3); am.stop(t + dur + 0.3);
    const n = ctx.createGain(); this._env(n, t, 0.3, 0.5, dur); this._burst(t, dur + 0.2, n, 'bandpass', 500, 1.5); n.connect(out);
  }
  stinger(level = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 0.6); out.gain.value = 0.95 * level;
    const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.01, 1, 1.5);
    [233, 247, 349, 370, 466, 740].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); o.detune.value = (i - 3) * 9;
      const og = ctx.createGain(); og.gain.value = 0.11; o.connect(og); og.connect(g); o.start(t); o.stop(t + 1.8);
    });
    const sw = ctx.createOscillator(); sw.type = 'sine'; sw.frequency.setValueAtTime(2600, t); sw.frequency.exponentialRampToValueAtTime(380, t + 0.9);
    const sg = ctx.createGain(); this._env(sg, t, 0.01, 0.35, 0.9); sw.connect(sg); sg.connect(out); sw.start(t); sw.stop(t + 1.2);
    const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.003, 0.9, 0.35); this._burst(t, 0.5, n, 'highpass', 1800, 0.7);
    const sub = ctx.createGain(); sub.connect(out); this._env(sub, t, 0.005, 1.1, 0.9); this._thump(t, sub, 90, 24);
  }
  bang(pos, vol = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.5, { ref: 3 }); out.gain.value = 1.8 * vol;
    const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.001, 1, 0.28); this._burst(t, 0.4, n, 'bandpass', 1100, 0.6);
    const l = ctx.createGain(); l.connect(out); this._env(l, t, 0.002, 1, 0.3); this._thump(t, l, 140, 50);
  }
  scream(vol = 1, dur = 1.4, low = false) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 0.5); out.gain.value = 0.85 * vol;
    const shaper = ctx.createWaveShaper(); const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = (i / 255.5) - 1; c[i] = Math.tanh(x * 4.5); } shaper.curve = c; shaper.oversample = '2x';
    const g = ctx.createGain(); this._env(g, t, 0.04, 1, dur);
    const base = low ? 260 : 520;
    [1, 1.007, 0.5].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * m, t); o.frequency.linearRampToValueAtTime(base * 2.4 * m, t + dur * 0.35); o.frequency.linearRampToValueAtTime(base * 1.7 * m, t + dur);
      const vib = ctx.createOscillator(); vib.frequency.value = 9; const vg = ctx.createGain(); vg.gain.value = 26; vib.connect(vg); vg.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = i === 2 ? 0.5 : 0.7; o.connect(og); og.connect(shaper); o.start(t); vib.start(t); o.stop(t + dur + 0.3); vib.stop(t + dur + 0.3);
    });
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 950; f1.Q.value = 2.5;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2700; f2.Q.value = 3;
    shaper.connect(f1); shaper.connect(f2); f1.connect(g); f2.connect(g); g.connect(out);
    const n = ctx.createGain(); this._env(n, t, 0.03, 0.6, dur); this._burst(t, dur + 0.2, n, 'bandpass', 2200, 1.0); n.connect(out);
  }
  shriek(vol = 1) { // banish — descending, tearing
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime, dur = 1.1;
    const out = this._out(null, 0.7); out.gain.value = 0.8 * vol;
    const shaper = ctx.createWaveShaper(); const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = (i / 255.5) - 1; c[i] = Math.tanh(x * 3.5); } shaper.curve = c;
    const g = ctx.createGain(); this._env(g, t, 0.02, 1, dur);
    [1, 1.5, 0.75].forEach((m) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(1500 * m, t); o.frequency.exponentialRampToValueAtTime(240 * m, t + dur); const og = ctx.createGain(); og.gain.value = 0.3; o.connect(og); og.connect(shaper); o.start(t); o.stop(t + dur + 0.1); });
    shaper.connect(g); g.connect(out);
    const n = ctx.createGain(); this._env(n, t, 0.01, 0.8, 0.5); this._burst(t, 0.6, n, 'highpass', 2200, 0.7); n.connect(out);
  }
  thunder(delay = 1, power = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime + delay;
    const dur = 3.5 + power * 3.5;
    [-0.7, 0.7].forEach((pan, i) => {
      const st = t + i * 0.12;
      const p = ctx.createStereoPanner(); p.pan.value = pan; const g = ctx.createGain(); g.connect(p); p.connect(this.dry); const s = ctx.createGain(); s.gain.value = 0.55; p.connect(s); s.connect(this.reverbIn);
      g.gain.setValueAtTime(0.0001, st); g.gain.linearRampToValueAtTime(0.9 * power, st + 0.06);
      let tt = st + 0.06; while (tt < st + dur) { tt += rnd(0.15, 0.6); g.gain.linearRampToValueAtTime(rnd(0.25, 0.9) * power * Math.exp(-(tt - st) / (dur * 0.45)), tt); }
      g.gain.linearRampToValueAtTime(0.0001, st + dur);
      const { flt } = this._burst(st, dur + 0.1, g, 'lowpass', 1400, 0.9, rnd(0, 0.2));
      flt.frequency.setValueAtTime(2200, st); flt.frequency.exponentialRampToValueAtTime(90, st + dur * 0.8);
    });
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(52, t); o.frequency.exponentialRampToValueAtTime(26, t + dur * 0.7);
    const og = ctx.createGain(); this._env(og, t, 0.15, 0.8 * power, dur * 0.8); o.connect(og); og.connect(this.dry); o.start(t); o.stop(t + dur);
  }
  crack(vol = 1) { // lightning snap
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 0.5); out.gain.value = 0.6 * vol;
    const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.001, 1, 0.12); this._burst(t, 0.2, n, 'highpass', 3000, 0.7);
  }
  keyPickup() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 0.5); out.gain.value = 0.55;
    [2093, 2637, 3136, 4186].forEach((f, i) => { const g = ctx.createGain(); g.connect(out); this._env(g, t + i * 0.045, 0.002, 0.5 / (i + 1) + 0.2, 0.7); this._osc('sine', f * rnd(0.998, 1.002), t + i * 0.045, t + 1, g); });
    const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.001, 0.4, 0.05); this._burst(t, 0.08, n, 'highpass', 4000, 0.7);
  }
  batteryPickup() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 0.2); out.gain.value = 0.5;
    [0, 0.07].forEach((d, i) => { const g = ctx.createGain(); g.connect(out); this._env(g, t + d, 0.001, 0.8, 0.07); this._osc('square', i ? 900 : 620, t + d, t + d + 0.1, g); });
    const l = ctx.createGain(); l.connect(out); this._env(l, t + 0.13, 0.002, 0.8, 0.16); this._thump(t + 0.13, l, 150, 70);
  }
  paper() {
    if (!this.ready) return; const t = this.ctx.currentTime, out = this._out(null, 0.2); out.gain.value = 0.35;
    const g = this.ctx.createGain(); g.connect(out); this._env(g, t, 0.03, 0.7, 0.28); this._burst(t, 0.4, g, 'bandpass', 3200, 0.8);
  }
  flashClick(on) {
    if (!this.ready) return; const t = this.ctx.currentTime, out = this._out(null, 0.1); out.gain.value = 0.55;
    const g = this.ctx.createGain(); g.connect(out); this._env(g, t, 0.001, 0.8, 0.03); this._burst(t, 0.05, g, 'bandpass', on ? 2600 : 1800, 1.4);
    const l = this.ctx.createGain(); l.connect(out); this._env(l, t, 0.001, 0.6, 0.05); this._thump(t, l, on ? 300 : 200, 120);
  }
  deadClick() { this.flashClick(false); }
  lockRattle(pos) {
    if (!this.ready) return; const ctx = this.ctx, t0 = ctx.currentTime;
    const out = this._out(pos, 0.4); out.gain.value = 0.8;
    for (let i = 0; i < 6; i++) { const t = t0 + i * 0.05 + Math.random() * 0.02; const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.001, rnd(0.4, 0.9), 0.05); this._burst(t, 0.06, g, 'bandpass', rnd(2400, 4200), 3); }
    const l = ctx.createGain(); l.connect(out); this._env(l, t0, 0.002, 0.9, 0.2); this._thump(t0, l, 130, 60);
  }
  unlock(pos) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.6); out.gain.value = 1.0;
    [0, 0.18, 0.5].forEach((d, i) => { const g = ctx.createGain(); g.connect(out); this._env(g, t + d, 0.001, i === 2 ? 1 : 0.7, 0.2); this._thump(t + d, g, i === 2 ? 170 : 220, 70); const n = ctx.createGain(); n.connect(out); this._env(n, t + d, 0.001, 0.8, 0.05); this._burst(t + d, 0.08, n, 'bandpass', 3000, 2); });
  }
  blackout() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 0.8); out.gain.value = 0.9;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(34, t + 1.4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(90, t + 1.4);
    const g = ctx.createGain(); this._env(g, t, 0.02, 0.9, 1.5); o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 1.6);
    const l = ctx.createGain(); l.connect(out); this._env(l, t, 0.002, 1, 0.6); this._thump(t, l, 100, 26);
    const n = ctx.createGain(); n.connect(out); this._env(n, t, 0.002, 0.6, 0.2); this._burst(t, 0.3, n, 'lowpass', 900, 0.7);
  }
  escape() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(0.26, t, 0.4); this.windGain.gain.setTargetAtTime(0.16, t, 0.4); this.droneGain.gain.setTargetAtTime(0.0, t, 0.5);
    this.setTension(0); this.setDanger(0); this.stopChase(); this.setEntity(null, 0);
    const out = this._out(null, 0.5); out.gain.value = 0.7; const g = ctx.createGain(); g.connect(out); this._env(g, t, 0.8, 1, 3); this._burst(t, 4, g, 'bandpass', 900, 0.6);
    this.thunder(0.4, 0.7);
  }
  resetBeds() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(0.085, t, 0.8); this.windGain.gain.setTargetAtTime(0.045, t, 0.8); this.droneGain.gain.setTargetAtTime(0.14, t, 0.8);
    this.setTension(0); this.setDanger(0); this.stopChase(); this.setEntity(null, 0);
  }

  // ------------------------------------------------------------ chase music
  startChase() {
    if (!this.ready || this.chase.on) return;
    const t = this.ctx.currentTime;
    this.chase.on = true; this.chase.step = 0; this.chase.next = t + 0.05;
    this.musicGain.gain.cancelScheduledValues(t); this.musicGain.gain.setTargetAtTime(0.5, t, 0.6);
  }
  stopChase() {
    if (!this.ready || !this.chase.on) return;
    this.chase.on = false; this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.7);
  }
  setChaseIntensity(v) { this.chaseIntensity = v; }
  _music() {
    const ctx = this.ctx, step = 60 / this.chase.bpm / 4;
    while (this.chase.next < ctx.currentTime + 0.14) { this._musicStep(this.chase.step, this.chase.next); this.chase.step++; this.chase.next += step; }
  }
  _musicStep(i, t) {
    const ctx = this.ctx, s = i % 16, bar = Math.floor(i / 16);
    const roots = [41.2, 43.65, 41.2, 38.9], root = roots[bar % 4];
    if ([0, 2, 3, 6, 8, 10, 11, 14].includes(s)) {
      const g = ctx.createGain(); g.connect(this.musicGain); this._env(g, t, 0.004, 0.55, 0.15);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340 + (s === 0 ? 400 : 0); lp.Q.value = 5; lp.connect(g);
      this._osc('sawtooth', root * (s === 6 || s === 14 ? 1.5 : 1), t, t + 0.2, lp);
    }
    if (s % 4 === 0) { const g = ctx.createGain(); g.connect(this.musicGain); this._env(g, t, 0.003, 1.0, 0.2); const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.16); o.connect(g); o.start(t); o.stop(t + 0.25); }
    if (s === 4 || s === 12) { const g = ctx.createGain(); g.connect(this.musicGain); this._env(g, t, 0.002, 0.6, 0.14); this._burst(t, 0.2, g, 'bandpass', 1900, 0.9); }
    if (s % 2 === 1) { const g = ctx.createGain(); g.connect(this.musicGain); this._env(g, t, 0.001, 0.12, 0.03); this._burst(t, 0.05, g, 'highpass', 8000, 0.7); }
    if (s === 0 && bar % 2 === 0) { // brass-ish stab
      const g = ctx.createGain(); g.connect(this.musicGain); this._env(g, t, 0.01, 0.38, 0.5);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.45); lp.connect(g);
      this._osc('sawtooth', root * 8, t, t + 0.55, lp); this._osc('sawtooth', root * 8 * 1.0595, t, t + 0.55, lp);
    }
    if (s === 0) { // strings climb, then reset every 8 bars
      const k = bar % 8, base = [330, 349, 370, 392, 415, 440, 466, 494][k];
      this.strings.forEach((o, n) => { o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(o.frequency.value, t); o.frequency.linearRampToValueAtTime(base * (n ? 1.0595 : 1), t + 0.9); });
    }
  }
}
