import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { getTextures } from './world/Textures.js';
import { House } from './world/House.js';
import { Player } from './player/Player.js';
import { AudioEngine } from './systems/AudioEngine.js';
import { Ghost } from './systems/Ghost.js';
import { ScareDirector } from './systems/ScareDirector.js';
import { HUD } from './ui/HUD.js';

const NO_INPUT = { forward: false, back: false, left: false, right: false, sprint: false };
const KEY_MAP = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'sprint', ShiftRight: 'sprint' };
const BURN_TIME = 2.5;                       // seconds of steady beam to banish
const BEAM_RANGE = 9.5;
const BEAM_CONE = Math.cos(0.42 * 0.92);    // a little inside the light's own edge
const BLACKOUT_TIME = 2.2;
const DEATH_HINT_DELAY = 2.6;
const CENTER = new THREE.Vector2(0, 0);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Ignores hidden ancestors, so picked-up keys and batteries stop being targets.
function visibleInTree(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class Game {
  constructor(parent) {
    this.state = 'title';          // title | playing | caught | escaped
    this.paused = false;
    this.noteOpen = false;
    this.input = { ...NO_INPUT };
    this.time = 0;
    this.playTime = 0;
    this.banishes = 0;
    this.collected = [];
    this.finaleStage = null;       // null | 'blackout' | 'chase'
    this.finaleT = 0;
    this.burnLevel = 0;
    this.deathT = 0;
    this.escapeT = 0;
    this.winShown = false;
    this.lastPrompt = '';

    this.raycaster = new THREE.Raycaster();
    this.losRay = new THREE.Raycaster();
    this._toBeam = new THREE.Vector3();
    this._chest = new THREE.Vector3();
    this._ray = new THREE.Vector3();

    this.hud = new HUD();
    this.audio = new AudioEngine();
    this.setupRenderer(parent);
    this.setupWorld();
    this.bindInput();
    this.hud.startGrain();
    this.resize();
    this.hud.showTitle(true);
    this.hud.showHUD(false);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  setupRenderer(parent) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;   // soft via shadow.radius; PCFSoftShadowMap is gone in this Three.js
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    parent.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010102);
    this.scene.fog = new THREE.FogExp2(0x020203, 0.085);
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 60);

    // HDR composer with 4x MSAA, then bloom, then tone mapping and sRGB out
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setupWorld() {
    this.tex = getTextures();
    this.hemi = new THREE.HemisphereLight(0x0a0f1c, 0x030303, 0.12);
    this.scene.add(this.hemi);
    this.house = new House(this.scene);
    this.player = new Player(this.camera, this.scene, this.house, this.tex.lens);
    this.ghost = new Ghost(this.scene, this.house, this.tex, this.audio, { onCaught: () => this.caught() });
    this.director = new ScareDirector({ house: this.house, audio: this.audio, ghost: this.ghost, game: this });
  }

  // Callbacks used by ScareDirector
  shake(amount) {
    this.player.addShake(amount);
  }

  flash(kind, alpha) {
    this.hud.flash(kind, alpha);
  }

  bindInput() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('mousemove', (e) => {
      if (this.isLocked() && this.state === 'playing' && !this.noteOpen) this.player.look(e.movementX, e.movementY);
    });
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.getElementById('title').addEventListener('click', () => this.startGame());
    document.getElementById('pause').addEventListener('click', () => this.lock());
    document.getElementById('note').addEventListener('click', () => this.closeNote());
    document.getElementById('death').addEventListener('click', () => this.tryRestart());
    document.getElementById('win').addEventListener('click', () => this.tryRestart());
  }

  onKey(e, down) {
    const action = KEY_MAP[e.code];
    if (action) this.input[action] = down;
    if (!down) return;

    if (e.code === 'Enter' || e.code === 'Space') {
      if (this.state === 'title') this.startGame();
      else this.tryRestart();
      return;
    }
    if (e.repeat || this.state !== 'playing' || this.paused) return;
    if (e.code === 'KeyE') {
      if (this.noteOpen) this.closeNote();
      else this.interact();
    } else if (e.code === 'KeyF') {
      this.player.toggleTorch();
    } else if (e.code === 'KeyR') {
      this.player.reload();
    }
  }

  isLocked() {
    return document.pointerLockElement === this.renderer.domElement;
  }

  lock() {
    try {
      const p = this.renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (err) {
      // pointer lock is best-effort
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onLockChange() {
    if (this.state !== 'playing') return;
    this.paused = !this.isLocked();
    this.hud.showPause(this.paused);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.house.setViewport(h * pr, 68);
  }

  // ---- run lifecycle ----

  startGame() {
    if (this.state !== 'title') return;
    this.audio.init();
    this.hud.showTitle(false);
    this.resetRun();
    this.lock();
  }

  resetRun() {
    this.house.resetDynamic();
    this.player.reset(0, 5.2, 0);
    this.player.snap = true;
    this.ghost.reset();
    this.director.reset();
    this.collected = [];
    this.banishes = 0;
    this.playTime = 0;
    this.burnLevel = 0;
    this.finaleStage = null;
    this.finaleT = 0;
    this.deathT = 0;
    this.winShown = false;
    this.noteOpen = false;
    this.paused = false;
    this.input = { ...NO_INPUT };
    this.hud.showNote(null);
    this.hud.showPause(false);
    this.hud.hideDeath();
    this.hud.hideWin();
    this.hud.showHUD(true);
    this.hud.setCollected([], 3);
    this.hud.setObjective('Find the three brass keys.');
    this.hud.setBurn(0, false);
    this.hud.setPrompt('');
    this.lastPrompt = '';
    this.house.setBlackout(false);
    this.audio.setChase(false);
    this.audio.duck(false);
    this.state = 'playing';
    this.hud.toast('The front door is sealed. Find three brass keys.', 4);
  }

  tryRestart() {
    const ready = (this.state === 'caught' && this.deathT > DEATH_HINT_DELAY) || (this.state === 'escaped' && this.winShown);
    if (!ready) return;
    this.resetRun();
    this.lock();
  }

  // ---- interaction ----

  pickTarget() {
    if (this.state !== 'playing' || this.paused || this.noteOpen) return null;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(CENTER, this.camera);
    this.raycaster.far = 2.3;
    const hits = this.raycaster.intersectObjects(this.house.interactables, false);
    for (const h of hits) {
      if (visibleInTree(h.object)) return h.object;
    }
    return null;
  }

  promptFor(obj) {
    if (!obj) return '';
    const it = obj.userData.interact;
    switch (it.type) {
      case 'key': return 'E  Take brass key';
      case 'battery': return 'E  Take battery';
      case 'note': return 'E  Read note';
      case 'door': return Math.abs(it.door.target) > 0.01 ? 'E  Close door' : 'E  Open door';
      case 'frontdoor': return this.collected.length >= 3 ? 'E  Unlock the front door' : 'E  Locked';
      default: return '';
    }
  }

  interact() {
    const obj = this.pickTarget();
    if (!obj) return;
    const it = obj.userData.interact;
    switch (it.type) {
      case 'key': this.pickKey(it.id); break;
      case 'battery': this.pickBattery(it.id); break;
      case 'note': this.openNote(it.text); break;
      case 'door': this.useDoor(it.door); break;
      case 'frontdoor': this.useFrontDoor(); break;
      default: break;
    }
  }

  pickKey(id) {
    if (this.collected.includes(id)) return;
    this.collected.push(id);
    this.house.keys[id].visible = false;
    this.audio.keyChime();
    const n = this.collected.length;
    this.hud.setCollected(this.collected, 3);
    this.director.setAct(n >= 2 ? 2 : 1);
    this.hud.toast(`Brass key found (${n}/3).`);
    this.updateObjective();
    this.director.onKeyPicked(id, n);
  }

  pickBattery(id) {
    const b = this.house.batteries.find((x) => x.id === id);
    if (!b || !b.group.visible) return;
    b.group.visible = false;
    this.player.addSpare();
    this.audio.batteryClick();
    this.hud.toast('Spare battery taken. Press R to load it.', 3.2);
  }

  openNote(text) {
    this.noteOpen = true;
    this.input = { ...NO_INPUT };
    this.hud.showNote(text);
    this.audio.noteRustle();
  }

  closeNote() {
    if (!this.noteOpen) return;
    this.noteOpen = false;
    this.hud.showNote(null);
  }

  useDoor(door) {
    const d = this.house.toggleDoor(door.id, this.player.z);
    if (d) this.audio.doorCreak(d.hingeX + d.w * 0.5, d.hingeZ);
  }

  useFrontDoor() {
    if (this.finaleStage === 'blackout') return;
    if (this.collected.length < 3) {
      this.audio.lockedRattle();
      this.hud.toast('Locked. It needs three brass keys.');
      return;
    }
    this.escape();
  }

  updateObjective() {
    if (this.finaleStage) return;
    const n = this.collected.length;
    if (n === 0) this.hud.setObjective('Find the three brass keys.');
    else if (n < 3) this.hud.setObjective(`Keep searching. ${3 - n} key${3 - n === 1 ? '' : 's'} left.`);
    else this.hud.setObjective('All three keys found. Unlock the front door in the foyer.');
  }

  // ---- finale ----

  startFinale() {
    if (this.finaleStage) return;
    this.finaleStage = 'blackout';
    this.finaleT = 0;
    this.director.setAct(3);
    this.house.setBlackout(true);
    this.player.forcedDark = true;
    this.audio.duck(true);
    this.hud.setObjective('The lights are out. Get to the front door.');
    this.hud.setPrompt('');
    this.lastPrompt = '';
  }

  startChase() {
    this.finaleStage = 'chase';
    this.house.setBlackout(false);
    this.house.flicker(2.4);
    this.player.forcedDark = false;
    this.audio.duck(false);
    this.audio.scream();
    this.hud.flash('white', 0.85);
    this.player.addShake(1.1);
    this.ghost.beginChase(this.player);
    this.audio.setChase(true);
    this.hud.setObjective('Reach the front door. Burn him back when he reforms.');
    this.hud.toast('RUN.', 2);
  }

  // ---- beam ----

  // True if nothing solid sits between from and to.
  clearLine(from, to, dist) {
    const dir = this._ray.subVectors(to, from).normalize();
    this.losRay.set(from, dir);
    this.losRay.far = dist - 0.15;
    return this.losRay.intersectObjects(this.house.occluders, false).length === 0;
  }

  // Holding the beam on the entity fills the burn meter. The entity writhes meanwhile.
  updateBurn(dt) {
    const ghost = this.ghost;
    let inBeam = false;
    if (ghost.isShown() && this.player.isLit) {
      const lp = this.player.lightPos;
      const dir = this.player.lightDir;
      const chest = this._chest.set(ghost.x, 1.5, ghost.z);
      const to = this._toBeam.subVectors(chest, lp);
      const dist = to.length();
      if (dist > 0.01 && dist < BEAM_RANGE) {
        to.divideScalar(dist);
        if (to.dot(dir) > BEAM_CONE && this.clearLine(lp, chest, dist)) inBeam = true;
      }
    }
    this.player.burning = inBeam;
    this.burnLevel = inBeam ? Math.min(1, this.burnLevel + dt / BURN_TIME) : Math.max(0, this.burnLevel - dt * 0.7);
    ghost.setBurn(this.burnLevel);
    this.hud.setBurn(this.burnLevel, inBeam);
    if (inBeam && this.burnLevel >= 1) this.banish();
  }

  banish() {
    this.banishes++;
    this.burnLevel = 0;
    this.player.burning = false;
    this.ghost.banish();
    this.hud.flash('white', 0.35);
    this.player.addShake(0.5);
    this.hud.toast(this.finaleStage === 'chase' ? 'Driven back. Run!' : 'It recoils into the dark.', 2.2);
  }

  // ---- endings ----

  caught() {
    if (this.state !== 'playing') return;
    this.state = 'caught';
    this.deathT = 0;
    this.burnLevel = 0;
    this.player.burning = false;
    this.audio.stopAll();
    this.hud.setBurn(0, false);
    this.hud.setPrompt('');
    this.hud.flash('red', 0.9);
    this.player.addShake(1.0);
    this.audio.scream();
    this.hud.showDeath();
    this.exitLock();
  }

  escape() {
    if (this.state !== 'playing') return;
    this.state = 'escaped';
    this.escapeT = 2.4;
    this.house.openFrontDoor();
    this.audio.doorCreak(0, 8);
    this.audio.stopAll();
    this.ghost.reset();
    this.hud.setPrompt('');
    this.hud.setBurn(0, false);
    this.hud.flash('white', 0.5);
    this.exitLock();
  }

  showWin() {
    this.winShown = true;
    this.hud.showHUD(false);
    this.hud.showWin(this.playTime, this.banishes);
  }

  // ---- audio driving ----

  updateAudio(live) {
    const p = this.player;
    this.audio.setListener(p.x, p.z, p.yaw);
    const chasing = this.finaleStage === 'chase';
    const act = this.collected.length >= 2 ? 2 : 1;
    let danger = 0;
    if (this.ghost.isShown()) danger = clamp(1 - (this.ghost.distanceTo(p.x, p.z) - 1.5) / 8, 0, 1);
    this.audio.setTension(Math.max(chasing ? 1 : act === 2 ? 0.5 : 0.15, danger * 0.6));
    const beating = this.state === 'playing' && !this.paused;
    const pulse = Math.max(danger, chasing ? 0.6 : 0);
    this.audio.setHeart(beating, 62 + 80 * pulse, 0.35 + 0.65 * pulse);
    if (!live) this.audio.setBreath(0, this.ghost.x, this.ghost.z);
  }

  // Game events from the player: footsteps, torch swaps, empty torch.
  handleEvents() {
    for (const ev of this.player.takeEvents()) {
      if (ev.type === 'step') this.audio.footstep(ev.sprint);
      else if (ev.type === 'reload') {
        this.audio.batteryClick();
        this.hud.toast('Torch reloaded.');
      } else if (ev.type === 'nospare') this.hud.toast('No spare battery. Find another.');
      else if (ev.type === 'dead') this.hud.toast('The torch is dead. Find a battery.');
    }
  }

  // ---- frame ----

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.composer.render();
  }

  update(dt) {
    const live = this.state === 'playing' && !this.paused && !this.noteOpen;
    const sdt = live ? dt : 0;
    if (live) this.playTime += dt;

    if (live && this.finaleStage === 'blackout') {
      this.finaleT += dt;
      if (this.finaleT >= BLACKOUT_TIME) this.startChase();
    }

    const input = this.state === 'playing' && !this.noteOpen ? this.input : NO_INPUT;
    this.player.update(sdt, input);
    this.house.update(sdt, this.time, this.player.flashData());

    if (this.state === 'playing') this.handleEvents();
    if (live) {
      this.updateBurn(dt);
      this.director.update(dt, this.player);
      this.ghost.update(dt, this.time, this.player);
    }

    if (live) {
      const prompt = this.promptFor(this.pickTarget());
      if (prompt !== this.lastPrompt) {
        this.hud.setPrompt(prompt);
        this.lastPrompt = prompt;
      }
    } else if (this.lastPrompt) {
      this.hud.setPrompt('');
      this.lastPrompt = '';
    }

    this.hud.setTorch(this.player.battery, this.player.spares, this.player.isLit);
    this.updateAudio(live);

    if (this.state === 'caught') this.deathT += dt;
    if (this.state === 'escaped' && !this.winShown) {
      this.escapeT -= dt;
      if (this.escapeT <= 0) this.showWin();
    }
  }
}
