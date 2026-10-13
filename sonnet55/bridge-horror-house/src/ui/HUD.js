// DOM-based HUD: objective, keys, battery, burn meter, prompts, notes, screen flashes, shake, jumpscare.
import { entityFaceCanvas } from '../world/Textures.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), obj: $('objText'), objBox: $('objective'), keys: [...document.querySelectorAll('#keys .k')],
      bat: $('battery'), batFill: $('batFill'), batPct: $('batPct'), burn: $('burn'), burnFill: $('burnFill'),
      prompt: $('prompt'), promptText: $('promptText'), promptHold: $('promptHold'), caption: $('caption'),
      flash: $('flash'), dark: $('darkness'), note: $('note'), noteTitle: $('noteTitle'), noteBody: $('noteBody'),
      title: $('title'), startBtn: $('startBtn'), pause: $('pause'), death: $('death'), deathStats: $('deathStats'), retry: $('retryBtn'),
      win: $('win'), winTime: $('winTime'), winBanish: $('winBanish'), again: $('againBtn'),
      js: $('jumpscare'), jsCanvas: $('jsCanvas'), grain: $('grain'),
    };
    this.flashA = 0; this.flashDur = 0.001; this.flashPeak = 0;
    this.shk = { amp: 0, t: 0, dur: 0.001 };
    this.capT = 0; this.darkTarget = 0; this.darkNow = 0;
    this.noteOpen = false;
    this._grain();
  }

  _grain() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const v = Math.random() * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    this.el.grain.style.backgroundImage = `url(${c.toDataURL()})`;
  }

  // ------------------------------------------------------------ screens
  showHUD(on) { this.el.hud.classList.toggle('hidden', !on); }
  showTitle(on) { this.el.title.classList.toggle('hidden', !on); }
  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }
  showDeath(on, stats = '') { this.el.death.classList.toggle('hidden', !on); this.el.deathStats.textContent = stats; }
  showWin(on, time = '', banish = 0) { this.el.win.classList.toggle('hidden', !on); this.el.winTime.textContent = time; this.el.winBanish.textContent = banish; }
  hideAll() { this.showTitle(false); this.showPause(false); this.showDeath(false); this.showWin(false); this.hideNote(); this.el.js.classList.add('hidden'); this.el.js.classList.remove('go'); this.el.flash.style.opacity = 0; }

  // ------------------------------------------------------------ in-game readouts
  setObjective(text) {
    this.el.obj.textContent = text;
    this.el.objBox.style.opacity = 1;
  }
  setKeys(n) { this.el.keys.forEach((k, i) => k.classList.toggle('got', i < n)); }
  setBattery(pct) {
    const p = Math.max(0, Math.min(100, pct));
    this.el.batFill.style.width = p + '%'; this.el.batPct.textContent = Math.round(p);
    this.el.bat.classList.toggle('low', p < 20);
  }
  setBurn(v) {
    if (v == null || v <= 0.001) { this.el.burn.classList.remove('on'); return; }
    this.el.burn.classList.add('on'); this.el.burnFill.style.width = Math.min(100, v * 100) + '%';
  }
  setPrompt(text, hold = null) {
    if (!text) { this.el.prompt.classList.remove('on'); this.el.promptHold.classList.add('hidden'); return; }
    this.el.prompt.classList.add('on'); this.el.promptText.textContent = text;
    if (hold == null) this.el.promptHold.classList.add('hidden');
    else { this.el.promptHold.classList.remove('hidden'); this.el.promptHold.firstElementChild.style.width = (hold * 100) + '%'; }
  }
  caption(text, secs = 3) {
    this.el.caption.textContent = text; this.el.caption.classList.add('on'); this.capT = secs;
  }
  showNote(title, body) { this.el.noteTitle.textContent = title; this.el.noteBody.textContent = body; this.el.note.classList.remove('hidden'); this.noteOpen = true; }
  hideNote() { this.el.note.classList.add('hidden'); this.noteOpen = false; }

  // ------------------------------------------------------------ effects
  flash(color = '#fff', dur = 0.2, peak = 0.6) {
    this.el.flash.style.background = color; this.flashA = peak; this.flashPeak = peak; this.flashDur = Math.max(0.01, dur);
    this.el.flash.style.opacity = peak;
  }
  holdFlash(color, a) { this.el.flash.style.background = color; this.el.flash.style.opacity = a; this.flashA = 0; }
  shake(amp = 0.3, dur = 0.4) { if (amp >= this.shk.amp * (1 - this.shk.t / this.shk.dur)) this.shk = { amp, t: 0, dur: Math.max(0.05, dur) }; }
  shakeOffset() {
    const s = this.shk; if (s.t >= s.dur) return { x: 0, y: 0, roll: 0 };
    const k = Math.pow(1 - s.t / s.dur, 2) * s.amp;
    return { x: (Math.random() - 0.5) * 0.09 * k, y: (Math.random() - 0.5) * 0.09 * k, roll: (Math.random() - 0.5) * 0.06 * k };
  }
  fadeDark(alpha, _tc) { this.darkTarget = alpha; }

  update(dt) {
    if (this.flashA > 0) { this.flashA = Math.max(0, this.flashA - (this.flashPeak / this.flashDur) * dt); this.el.flash.style.opacity = this.flashA; }
    if (this.shk.t < this.shk.dur) this.shk.t += dt;
    if (this.capT > 0) { this.capT -= dt; if (this.capT <= 0) this.el.caption.classList.remove('on'); }
    const d = this.darkTarget - this.darkNow;
    if (Math.abs(d) > 0.002) { this.darkNow += d * Math.min(1, dt * 8); this.el.dark.style.opacity = this.darkNow; }
  }

  // ------------------------------------------------------------ jumpscare
  jumpscare(show = true) {
    const js = this.el.js;
    if (!show) { js.classList.add('hidden'); js.classList.remove('go'); return; }
    const c = this.el.jsCanvas, g = c.getContext('2d');
    c.width = 720; c.height = 720;
    g.fillStyle = '#000'; g.fillRect(0, 0, 720, 720);
    const face = entityFaceCanvas(2);
    g.save(); g.translate(360, 380); g.scale(2.7, 2.7); g.drawImage(face, -128, -160); g.restore();
    // glowing eyes in the sockets
    for (const ex of [86, 170]) {
      const x = 360 + (ex - 128) * 2.7, y = 380 + (124 - 160) * 2.7;
      const gr = g.createRadialGradient(x, y, 0, x, y, 70); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.18, 'rgba(255,230,160,.9)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = gr; g.fillRect(x - 80, y - 80, 160, 160);
    }
    const v = g.createRadialGradient(360, 360, 120, 360, 360, 460); v.addColorStop(0, 'rgba(120,0,0,0)'); v.addColorStop(1, 'rgba(10,0,0,.95)');
    g.fillStyle = v; g.fillRect(0, 0, 720, 720);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(255,60,60,.55)'; g.fillRect(0, 0, 720, 720); g.globalCompositeOperation = 'source-over';
    js.classList.remove('hidden'); js.classList.add('go');
  }
}
