import { entityFaceCanvas } from '../world/Textures.js';

const $ = (id) => document.getElementById(id);

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// All HUD work is DOM and CSS. The 3D scene never touches this file.
export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      objText: $('objective-text'),
      keysCount: $('keys-count'),
      keyPips: Array.from(document.querySelectorAll('#keys [data-key]')),
      torchFill: $('torch-fill'),
      torch: $('torch'),
      spares: $('spares'),
      burn: $('burn'),
      burnFill: $('burn-fill'),
      prompt: $('prompt'),
      toast: $('toast'),
      flash: $('flash'),
      title: $('title'),
      pause: $('pause'),
      note: $('note'),
      noteText: $('note-text'),
      death: $('death'),
      jumpFace: $('jump-face'),
      deathHint: $('death-hint'),
      win: $('win'),
      winText: $('win-text'),
      crosshair: $('crosshair'),
    };
    this.toastId = 0;
  }

  showHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  setObjective(text) {
    this.el.objText.textContent = text;
  }

  // ids: the key ids collected so far, e.g. ['study', 'kitchen'].
  setCollected(ids, total) {
    this.el.keysCount.textContent = `${ids.length}/${total}`;
    for (const pip of this.el.keyPips) pip.classList.toggle('got', ids.includes(pip.dataset.key));
  }

  setTorch(frac, spares, isLit) {
    const f = Math.max(0, Math.min(1, frac));
    this.el.torchFill.style.width = `${(f * 100).toFixed(1)}%`;
    this.el.torch.classList.toggle('low', f > 0 && f < 0.2);
    this.el.torch.classList.toggle('dead', f <= 0);
    this.el.torch.classList.toggle('off', !isLit && f > 0);
    this.el.spares.textContent = spares > 0 ? `x${spares}` : '';
  }

  // frac = burn progress 0..1. inBeam = the beam is on the entity right now.
  setBurn(frac, inBeam) {
    this.el.burn.style.opacity = inBeam || frac > 0 ? '1' : '0';
    this.el.burnFill.style.width = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  }

  setPrompt(text) {
    this.el.prompt.textContent = text || '';
    this.el.prompt.style.opacity = text ? '1' : '0';
  }

  toast(text, sec = 2.6) {
    const id = ++this.toastId;
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    setTimeout(() => {
      if (id === this.toastId) this.el.toast.style.opacity = '0';
    }, sec * 1000);
  }

  // kind: 'white' | 'red' | 'storm'. Sharp flash that fades out over ~0.9s.
  flash(kind, alpha) {
    const f = this.el.flash;
    const color = kind === 'red' ? '#7a0000' : kind === 'storm' ? '#9fb4e8' : '#ffffff';
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = String(alpha);
    void f.offsetWidth;
    f.style.transition = 'opacity 0.9s ease-out';
    f.style.opacity = '0';
  }

  setCrosshair(on) {
    this.el.crosshair.style.opacity = on ? '1' : '0.5';
  }

  showTitle(on) {
    this.el.title.classList.toggle('hidden', !on);
  }

  showPause(on) {
    this.el.pause.classList.toggle('hidden', !on);
  }

  showNote(text) {
    if (text) {
      this.el.noteText.textContent = text;
      this.el.note.classList.remove('hidden');
    } else {
      this.el.note.classList.add('hidden');
    }
  }

  showDeath() {
    const face = entityFaceCanvas('scream');
    face.className = 'jump-canvas';
    this.el.jumpFace.replaceChildren(face);
    this.el.deathHint.classList.add('hidden');
    this.el.death.classList.remove('hidden');
    this.el.death.classList.remove('shown');
    void this.el.death.offsetWidth;
    this.el.death.classList.add('shown');
    setTimeout(() => this.el.deathHint.classList.remove('hidden'), 2600);
  }

  hideDeath() {
    this.el.death.classList.add('hidden');
  }

  showWin(seconds, banishes) {
    this.el.winText.innerHTML =
      `<span class="big">ESCAPED</span>` +
      `<span class="stats">Survived ${formatTime(seconds)} &middot; Banished ${banishes} time${banishes === 1 ? '' : 's'}</span>` +
      `<span class="hint">Click to play again</span>`;
    this.el.win.classList.remove('hidden');
  }

  hideWin() {
    this.el.win.classList.add('hidden');
  }

  // Film grain: low-res noise, scaled up by CSS. Redrawn about 15 times a second.
  startGrain() {
    const c = $('grain');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = 240, H = 135;
    c.width = W;
    c.height = H;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const loop = () => {
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      setTimeout(loop, 66);
    };
    loop();
  }
}
