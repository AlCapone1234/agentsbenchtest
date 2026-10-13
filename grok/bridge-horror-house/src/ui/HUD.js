export class HUD {
  constructor(screamCanvas) {
    this.objective = document.getElementById('objective');
    this.keyIcons = [...document.querySelectorAll('#keys i')];
    this.keyCount = document.getElementById('key-count');
    this.battery = document.getElementById('battery');
    this.batteryFill = document.getElementById('battery-fill');
    this.burn = document.getElementById('burn');
    this.burnFill = document.getElementById('burn-fill');
    this.prompt = document.getElementById('prompt');
    this.cross = document.getElementById('crosshair');
    this.flashEl = document.getElementById('flash');
    this.hint = document.getElementById('hint');
    this.jump = document.getElementById('jumpscare');
    this.screamCanvas = screamCanvas;
    this.flashAmt = 0;
    this.flashColor = '#fff';
    this.shakeMag = 0;
    this.shakeT = 0;
    this.shakeDur = 1;
    this.danger = 0;
    this.grain = document.createElement('canvas');
    this.grain.width = 240;
    this.grain.height = 135;
    this.gctx = this.grain.getContext('2d', { alpha: true });
    document.getElementById('grain').appendChild(this.grain);
    this.frame = 0;
    document.body.style.cursor = '';
  }

  update(dt) {
    this.frame++;
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - dt * 1.8);
      this.flashEl.style.opacity = String(this.flashAmt);
      this.flashEl.style.background = this.flashColor;
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / this.shakeDur);
      const m = this.shakeMag * k;
      const x = (Math.random() - 0.5) * 2 * m;
      const y = (Math.random() - 0.5) * 2 * m;
      document.body.style.setProperty('--shake-x', `${x.toFixed(2)}px`);
      document.body.style.setProperty('--shake-y', `${y.toFixed(2)}px`);
    } else {
      document.body.style.setProperty('--shake-x', '0px');
      document.body.style.setProperty('--shake-y', '0px');
    }
    if ((this.frame & 1) === 0) this._grain();
  }

  _grain() {
    const ctx = this.gctx;
    const img = ctx.createImageData(this.grain.width, this.grain.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = n;
      d[i + 3] = 90;
    }
    ctx.putImageData(img, 0, 0);
  }

  setObjective(text) {
    this.objective.textContent = text;
  }

  setKeys(n) {
    this.keyIcons.forEach((el, i) => el.classList.toggle('on', i < n));
    this.keyCount.textContent = `${n}/3`;
  }

  setBattery(level, low) {
    const clamped = Math.max(0, Math.min(1, level));
    this.batteryFill.style.width = `${(clamped * 100).toFixed(1)}%`;
    this.battery.classList.toggle('low', low);
    this.battery.classList.toggle('sputter', low && clamped > 0);
  }

  setBurn(visible, level) {
    this.burn.classList.toggle('on', visible);
    this.burnFill.style.width = `${Math.max(0, Math.min(1, level)) * 100}%`;
  }

  setPrompt(text) {
    this.prompt.textContent = text || '';
  }

  setCrosshairHot(on) {
    this.cross.classList.toggle('hot', !!on);
  }

  setDanger(level) {
    this.danger = level;
    document.body.style.setProperty('--danger', level.toFixed(3));
  }

  setHint(visible) {
    this.hint.style.opacity = visible ? '1' : '0';
  }

  flash(color, amount) {
    this.flashColor = color === 'red' ? '#6a0c0c' : color === 'black' ? '#000' : '#f4f1ea';
    this.flashAmt = Math.max(this.flashAmt, amount);
    this.flashEl.style.background = this.flashColor;
    this.flashEl.style.opacity = String(this.flashAmt);
  }

  shake(mag, time) {
    this.shakeMag = mag;
    this.shakeDur = time;
    this.shakeT = time;
  }

  showJumpscare() {
    const ctx = this.jump.getContext('2d');
    ctx.clearRect(0, 0, this.jump.width, this.jump.height);
    if (this.screamCanvas) ctx.drawImage(this.screamCanvas, 0, 0, this.jump.width, this.jump.height);
    this.jump.classList.remove('on');
    void this.jump.offsetWidth;
    this.jump.classList.add('on');
  }

  hideJumpscare() {
    this.jump.classList.remove('on');
  }

  showTitle() {
    document.body.classList.add('menu');
    document.body.classList.remove('playing');
    document.getElementById('title-screen').classList.remove('hidden');
  }

  hideTitle() {
    document.body.classList.remove('menu');
    document.body.classList.add('playing');
    document.getElementById('title-screen').classList.add('hidden');
  }

  showNote(title, body) {
    document.getElementById('note-title').textContent = title;
    document.getElementById('note-body').textContent = body;
    document.getElementById('note-screen').classList.remove('hidden');
    document.body.classList.add('menu');
  }

  hideNote() {
    document.getElementById('note-screen').classList.add('hidden');
    document.body.classList.remove('menu');
  }

  showDeath(seconds) {
    document.body.classList.add('menu');
    document.body.classList.remove('playing');
    document.getElementById('death-stats').textContent = `Survived ${formatTime(seconds)}`;
    document.getElementById('death-screen').classList.remove('hidden');
  }

  showWin(seconds, banishes) {
    document.body.classList.add('menu');
    document.body.classList.remove('playing');
    const noun = banishes === 1 ? 'banish' : 'banishes';
    document.getElementById('win-stats').textContent =
      `Survived ${formatTime(seconds)}\n${banishes} ${noun}`;
    document.getElementById('win-screen').classList.remove('hidden');
  }

  hideEnd() {
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('win-screen').classList.add('hidden');
  }

  showPause() {
    document.getElementById('pause').classList.remove('hidden');
    document.body.classList.add('menu');
  }

  hidePause() {
    document.getElementById('pause').classList.add('hidden');
    if (document.body.classList.contains('playing')) document.body.classList.remove('menu');
  }
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
