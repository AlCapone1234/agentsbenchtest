// Game: renderer + post stack, state machine (TITLE → PLAYING → CAUGHT / ESCAPED), interaction, burn mechanic, main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { House, roomAt } from './world/House.js';
import { Tex } from './world/Textures.js';
import { Player } from './player/Player.js';
import { AudioEngine } from './systems/AudioEngine.js';
import { Ghost } from './systems/Ghost.js';
import { ScareDirector } from './systems/ScareDirector.js';

const NOTES = {
  foyer: {
    title: 'Left on the foyer table',
    body: "If you are reading this, you woke up the way I did.\n\nThe doors will not open from the inside. There are three brass keys — one in the kitchen, one in the study, one in the bedroom. He hid them where the house is darkest.\n\nDon't linger. And whatever you do, don't let your light die.",
  },
  study: {
    title: 'Torn page — study desk',
    body: "He fears the LIGHT. Not the lamps — the beam.\n\nHold it on him and he burns. Keep it steady. He will scream and fold back into the dark... but he always comes back.\n\nIt eats the batteries. Spares are scattered: the living room, the dining room, the hallway, the kitchen.\n\nDon't waste them.",
  },
};

const SPAWN_PTS = [[-7, -5], [0, -5], [7, -5], [-7, 4.5], [0, 5], [7, 4.5], [-8.5, -0.5], [8.5, -0.5], [-3, -0.5], [3, -0.5]];

// -------------------------------------------------------------------------- dust motes caught in the beam
class DustField {
  constructor(scene) {
    const N = 420;
    this.N = N; this.pos = new Float32Array(N * 3); this.seed = new Float32Array(N); this.vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * 12; this.pos[i * 3 + 1] = 0.2 + Math.random() * 2.7; this.pos[i * 3 + 2] = (Math.random() - 0.5) * 12;
      this.seed[i] = Math.random();
      this.vel[i * 3] = (Math.random() - 0.5) * 0.05; this.vel[i * 3 + 1] = (Math.random() - 0.5) * 0.03; this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: Tex.dust() }, uBeamPos: { value: new THREE.Vector3() }, uBeamDir: { value: new THREE.Vector3(0, 0, -1) },
        uCosOuter: { value: Math.cos(0.5) }, uCosInner: { value: Math.cos(0.2) }, uBeamOn: { value: 1 }, uTime: { value: 0 }, uScale: { value: 700 },
      },
      vertexShader: /* glsl */`
        uniform vec3 uBeamPos; uniform vec3 uBeamDir; uniform float uCosOuter; uniform float uCosInner; uniform float uBeamOn; uniform float uTime; uniform float uScale;
        attribute float aSeed; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 toP = position - uBeamPos; float d = max(0.001, length(toP));
          float c = dot(toP / d, uBeamDir);
          float cone = smoothstep(uCosOuter, uCosInner, c) * (1.0 - smoothstep(3.0, 11.0, d)) * smoothstep(0.35, 1.0, d) * uBeamOn;
          float tw = 0.6 + 0.4 * sin(uTime * (1.2 + aSeed * 3.0) + aSeed * 40.0);
          vA = (0.03 + cone * 0.95) * tw;
          float s = 0.007 + aSeed * 0.012;
          gl_PointSize = clamp(s * uScale / max(0.3, -mv.z), 1.0, 9.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; varying float vA;
        void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * 1.5, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
  }
  update(dt, t, player, camH, fovScale) {
    const R = 6, p = this.pos, v = this.vel;
    const px = player.pos.x, pz = player.pos.z;
    for (let i = 0; i < this.N; i++) {
      const k = i * 3, s = this.seed[i];
      p[k] += (v[k] + Math.sin(t * 0.3 + s * 20) * 0.03) * dt; p[k + 1] += (v[k + 1] + Math.sin(t * 0.4 + s * 11) * 0.02) * dt; p[k + 2] += (v[k + 2] + Math.cos(t * 0.35 + s * 17) * 0.03) * dt;
      if (p[k] - px > R) p[k] -= 2 * R; else if (p[k] - px < -R) p[k] += 2 * R;
      if (p[k + 2] - pz > R) p[k + 2] -= 2 * R; else if (p[k + 2] - pz < -R) p[k + 2] += 2 * R;
      if (p[k + 1] > 2.9) p[k + 1] = 0.2; else if (p[k + 1] < 0.1) p[k + 1] = 2.8;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    const u = this.mat.uniforms;
    u.uBeamPos.value.copy(player.beamPos); u.uBeamDir.value.copy(player.beamDir); u.uBeamOn.value = player.flashLevel; u.uTime.value = t;
    u.uScale.value = fovScale;
  }
}

// -------------------------------------------------------------------------- Game
export class Game {
  constructor(container, hud) {
    this.hud = hud; this.container = container;
    this.debug = /[?&]debug/.test(location.search);
    this.state = { mode: 'TITLE', playing: false, caught: false };
    this.keys = []; this.time = 0; this.runTime = 0; this.banishCount = 0; this.unlockHold = 0;
    this.rt = []; // real-time timers (not paused by sim pause)
    this.hasLocked = false; this.pressE = false; this.fpsAcc = 0; this.fpsN = 0; this.slow = 0; this.fast = 0;
    this.noteRead = { foyer: false, study: false };
    this.firstBanishShown = false;

    const _t0 = performance.now(); const _lap = (n) => { if (this.debug) console.log('[boot]', n, Math.round(performance.now() - _t0) + 'ms'); };
    // renderer ---------------------------------------------------------
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5); this.maxPR = this.pixelRatio;
    r.setPixelRatio(this.pixelRatio); r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.25; r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 1);
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.088);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 70);
    this.scene.add(this.camera);

    const target = new THREE.WebGLRenderTarget(window.innerWidth * this.pixelRatio, window.innerHeight * this.pixelRatio, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.setPixelRatio(this.pixelRatio); this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.5, 0.65, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    _lap('renderer+composer');
    // world & systems --------------------------------------------------
    this.audio = new AudioEngine();
    this.house = new House({ audio: this.audio });
    this.scene.add(this.house.group);
    _lap('house');
    this.house.onSlam = () => this.hud.shake(0.45, 0.5);
    this.player = new Player(this.camera, this.scene, r.domElement, { freeLook: this.debug });
    this.player.reset(this.house.playerStart, 0);
    _lap('player');
    this.ghost = new Ghost(this.scene);
    _lap('ghost');
    this.director = new ScareDirector(this);
    this.dust = new DustField(this.scene);
    this.fresh = true;
    this.wire();
    _lap('done');

    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state.mode === 'PLAYING') this.player.unlock(); });
    addEventListener('contextmenu', (e) => e.preventDefault());
    if (this.debug) window.__bhh = this;
    this.last = performance.now();
    requestAnimationFrame(() => this.loop());
  }

  act() { const n = this.keys.length; return n >= 3 ? 3 : n === 2 ? 2 : 1; }
  frontDoorLive(on) { this.finaleLive = on; }

  wire() {
    const hud = this.hud, p = this.player, g = this.ghost;
    hud.el.startBtn.onclick = (e) => { e.stopPropagation(); this.begin(); };
    hud.el.title.onclick = () => { if (!hud.el.startBtn.disabled) this.begin(); };
    hud.el.pause.onclick = () => p.lock();
    hud.el.retry.onclick = () => this.restart();
    hud.el.again.onclick = () => this.restart();
    p.onLockChange = (locked, err) => {
      if (err) { p.freeLook = true; hud.caption('Pointer lock unavailable — hold the left mouse button to look around.', 6); return; }
      if (locked) this.hasLocked = true;
    };
    p.onStep = (sprint) => this.audio.footstep(sprint, roomAt(p.pos.x, p.pos.z) === 'kitchen' ? 'tile' : 'wood');
    p.onToggleFlash = (on, dead) => { if (dead) this.audio.deadClick(); else this.audio.flashClick(on); };
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyE') this.pressE = true;
      if (e.code === 'Escape' && hud.noteOpen) { hud.hideNote(); }
    });
    g.onBanish = (was) => {
      this.banishCount++;
      this.audio.shriek(1); hud.flash('#ffffff', 0.35, 0.7); hud.shake(0.6, 0.6);
      if (!this.firstBanishShown && was !== 'apparition') { this.firstBanishShown = true; hud.caption('The light burns him. He recoils into the dark.', 4); }
    };
    g.onCaught = () => this.caught();
    g.onLunge = () => this.lunge();
    g.onVanish = (was) => { if (was === 'stalk' || was === 'apparition') this.director.onGhostVanished(); };
    g.onReform = () => { this.audio.stinger(0.7); this.audio.growl({ x: g.pos.x, y: 1.4, z: g.pos.z }, 0.9, 1.6); hud.shake(0.25, 0.5); };
    g.pickSpawn = () => this.pickReformSpawn();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
  }

  // ------------------------------------------------------------ flow
  later(sec, fn) { this.rt.push({ t: sec, fn }); }

  begin() {
    if (this.state.mode === 'PLAYING') return;
    this.audio.start(); this.audio.resume();
    this.player.lock();
    this.startRun();
  }
  restart() {
    this.player.lock();
    this.audio.fadeMaster(0.9, 0.3);
    this.startRun();
  }
  startRun() {
    this.hud.hideAll(); this.hud.showHUD(true);
    if (!this.fresh) {
      this.scene.remove(this.house.group); this.house.dispose();
      this.house = new House({ audio: this.audio });
      this.scene.add(this.house.group);
      this.house.onSlam = () => this.hud.shake(0.45, 0.5);
    }
    this.fresh = false;
    this.ghost.reset(); this.director.reset();
    this.keys = []; this.time = 0; this.runTime = 0; this.banishCount = 0; this.unlockHold = 0; this.escaping = 0;
    this.noteRead = { foyer: false, study: false }; this.firstBanishShown = false; this.pressE = false; this.rt.length = 0;
    this.house.escapeGlow.material.opacity = 0;
    this.player.reset(this.house.playerStart, 0);
    this.player.enabled = true;
    this.audio.resetBeds(); this.audio.fadeMaster(0.9, 0.5);
    this.hud.setKeys(0); this.hud.setBattery(100); this.hud.setBurn(0); this.hud.setPrompt(null); this.hud.fadeDark(0);
    this.hud.holdFlash('#000', 0);
    this.refreshObjective();
    this.state = { mode: 'PLAYING', playing: true, caught: false };
    this.hud.caption('The doors are sealed. It is very dark. Find the keys.', 5);
  }
  refreshObjective() {
    const n = this.keys.length, left = ['kitchen', 'study', 'bedroom'].filter((r) => !this.keys.includes(r));
    let t;
    if (n >= 3) t = 'Get to the front door and unlock it.';
    else if (this.noteRead.foyer) t = `Find the brass keys (${n}/3). Still hidden: ${left.join(', ')}.`;
    else t = `Find the three brass keys (${n}/3). The front door will not open.`;
    this.hud.setObjective(t);
  }
  get paused() { return this.state.mode === 'PLAYING' && this.hasLocked && !this.player.locked && !this.player.freeLook; }

  pickReformSpawn() {
    const P = this.player.pos, c = [];
    for (const [x, z] of SPAWN_PTS) c.push({ x, z, d: Math.hypot(x - P.x, z - P.z) });
    c.sort((a, b) => b.d - a.d);
    const top = c.slice(0, 4).filter((q) => q.d > 8);
    const s = (top.length ? top : c.slice(0, 2))[Math.floor(Math.random() * Math.max(1, top.length || 2))];
    return new THREE.Vector3(s.x, 0, s.z);
  }

  lunge() { // stalking contact: a hard fright but not death
    const hud = this.hud;
    this.audio.stinger(1.1); this.audio.growl(null, 0.8, 1.2);
    hud.flash('#a00000', 0.6, 0.65); hud.shake(0.9, 0.7); hud.jumpscare(true); this.later(0.2, () => hud.jumpscare(false));
    this.player.drain(12); this.director.adrenaline = 1;
    hud.caption('The cold takes some of your light.', 3);
  }

  caught() {
    if (this.state.mode !== 'PLAYING') return;
    this.state = { mode: 'CAUGHT', playing: false, caught: true };
    this.player.enabled = false; this.hud.setPrompt(null); this.hud.setBurn(0);
    this.audio.stopChase(); this.audio.setDanger(0); this.audio.setEntity(null, 0);
    this.audio.scream(1.3, 1.3, true); this.audio.stinger(1.3);
    this.hud.jumpscare(true); this.hud.flash('#b00000', 0.9, 0.55); this.hud.showHUD(false);
    this.later(1.9, () => {
      this.hud.jumpscare(false); this.player.unlock();
      const m = Math.floor(this.runTime / 60), s = Math.floor(this.runTime % 60);
      this.hud.showDeath(true, `Survived ${m}:${String(s).padStart(2, '0')} · Keys ${this.keys.length}/3 · Banished ${this.banishCount}`);
      this.audio.fadeMaster(0.35, 0.8);
    });
  }

  escape() {
    if (this.state.mode !== 'PLAYING') return;
    this.state = { mode: 'ESCAPING', playing: false, caught: false };
    const d = this.house.frontDoor;
    d.locked = false; d.open(true);
    this.audio.unlock(d.pos); this.audio.escape();
    this.ghost.vanish(); this.ghost.reset();
    this.player.enabled = false; this.hud.setPrompt(null); this.hud.setBurn(0);
    this.escaping = 0.0001;
  }

  // ------------------------------------------------------------ interaction
  interact(it) {
    const h = this.house, hud = this.hud, a = this.audio;
    switch (it.type) {
      case 'key': {
        h.removeItem(it.item); this.keys.push(it.room); a.keyPickup(); hud.setKeys(this.keys.length);
        hud.caption(`Brass key (${this.keys.length}/3)`, 3.5); this.refreshObjective();
        this.director.onKeyTaken(it.room, this.keys.length);
        break;
      }
      case 'battery': {
        if (this.player.battery > 75) { hud.caption('Your torch is still strong. Leave it for when you need it.', 2.5); break; }
        h.removeItem(it.item); this.player.addBattery(45); a.batteryPickup(); hud.caption('Battery +45%', 2.5);
        break;
      }
      case 'note': {
        const n = NOTES[it.id]; a.paper(); hud.showNote(n.title, n.body); this.noteRead[it.id] = true; this.refreshObjective();
        break;
      }
      case 'door': it.door.toggle(); break;
      case 'frontdoor': {
        if (this.keys.length < 3) { a.lockRattle(it.door.pos); hud.caption(`Locked. It needs all three brass keys (${this.keys.length}/3).`, 3); hud.shake(0.12, 0.2); }
        break;
      }
    }
  }
  updateInteract(dt) {
    const hud = this.hud, P = this.player, h = this.house;
    if (hud.noteOpen) { if (this.pressE) { hud.hideNote(); this.audio.paper(); } this.pressE = false; hud.setPrompt(null); return; }
    this.ray = this.ray || new THREE.Raycaster();
    this.ray.far = 2.5;
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hits = this.ray.intersectObjects(h.interactMeshes, false);
    const eye = P.eye(this._eye || (this._eye = new THREE.Vector3()));
    let tgt = null;
    for (const hit of hits) {
      const it = hit.object.userData.interact; if (!it) continue;
      if (it.item && it.item.taken) continue;
      if (it.type !== 'door' && it.type !== 'frontdoor' && h.segmentBlocked(eye.x, eye.z, hit.point.x, hit.point.z)) continue;
      tgt = it; break;
    }
    let text = null, hold = null;
    if (tgt) {
      switch (tgt.type) {
        case 'key': text = 'Take the brass key'; break;
        case 'battery': text = this.player.battery > 75 ? 'Spare battery (torch still strong)' : 'Take battery'; break;
        case 'note': text = 'Read note'; break;
        case 'door': text = tgt.door.isOpen ? 'Close the door' : 'Open the door'; break;
        case 'frontdoor':
          if (this.keys.length < 3) text = `Locked (${this.keys.length}/3 keys)`;
          else { text = 'Hold to unlock the front door'; hold = this.unlockHold / 1.1; }
          break;
      }
    }
    // front door: hold E to turn the key
    if (tgt && tgt.type === 'frontdoor' && this.keys.length >= 3) {
      if (P.keys.has('KeyE')) {
        this.unlockHold += dt; this.rattleT = (this.rattleT || 0) - dt;
        if (this.rattleT <= 0) { this.audio.lockRattle(tgt.door.pos); this.rattleT = 0.32; }
        if (this.unlockHold >= 1.1) { this.escape(); return; }
      } else this.unlockHold = Math.max(0, this.unlockHold - dt * 2);
      hold = this.unlockHold / 1.1;
    } else this.unlockHold = Math.max(0, this.unlockHold - dt * 3);
    if (this.pressE && tgt && !(tgt.type === 'frontdoor' && this.keys.length >= 3)) this.interact(tgt);
    this.pressE = false;
    hud.setPrompt(text, hold);
  }

  // ------------------------------------------------------------ the beam burns him
  beamHitsGhost() {
    const g = this.ghost, P = this.player;
    if (!g.burnable || g.fade < 0.4 || !P.beamOn) return false;
    const eye = P.eye(this._eye || (this._eye = new THREE.Vector3()));
    const cosLim = Math.cos(0.36);
    const v = this._v || (this._v = new THREE.Vector3());
    for (const y of [1.0, 1.7, 2.5]) {
      v.set(g.pos.x - P.beamPos.x, y - P.beamPos.y, g.pos.z - P.beamPos.z);
      const d = v.length(); if (d > 11.5 || d < 0.2) continue;
      if (v.divideScalar(d).dot(P.beamDir) >= cosLim) {
        if (!this.house.segmentBlocked(eye.x, eye.z, g.pos.x, g.pos.z)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.adaptive(dt);
    this.tick(dt);
  }

  tick(dt, skipRender = false) {
    const mode = this.state.mode;

    // real-time timers
    for (let i = this.rt.length - 1; i >= 0; i--) { this.rt[i].t -= dt; if (this.rt[i].t <= 0) { const f = this.rt[i].fn; this.rt.splice(i, 1); f(); } }

    const paused = this.paused;
    this.hud.showPause(paused);
    if (paused) { if (!this._susp) { this.audio.suspend(); this._susp = true; } if (!skipRender) this.render(); return; }
    if (this._susp) { this.audio.resume(); this._susp = false; }

    const noteOpen = this.hud.noteOpen;
    const simDt = noteOpen ? 0 : dt;
    this.time += simDt;
    const shake = this.hud.shakeOffset();

    if (mode === 'TITLE') {
      this.player.yaw = Math.sin(this.time * 0.17) * 0.45; this.player.pitch = -0.05 + Math.sin(this.time * 0.11) * 0.04;
      this.player.update(dt, this.house.colliders, { x: 0, y: 0, roll: 0 }, this.time);
      this.house.update(dt, this.time, this.player.pos);
      this.house.setLightning(0);
      this.dust.update(dt, this.time, this.player, 0, this.projScale());
    } else {
      if (mode === 'PLAYING') {
        this.runTime += simDt;
        this.player.enabled = !noteOpen;
        this.player.extraDrain = this.ghost.burning ? 1.9 : 0;
        this.player.update(simDt, this.house.colliders, shake, this.time);
        this.house.update(simDt, this.time, this.player.pos);
        this.director.update(simDt, this.player.pos);
        const inBeam = this.beamHitsGhost();
        this.ghost.update(simDt, this.time, this.player.pos, inBeam);
        this.updateInteract(simDt);
        this.updateMeters();
      } else {
        // CAUGHT / ESCAPING / ESCAPED: keep the world breathing
        this.house.update(dt, this.time, this.player.pos);
        this.player.update(0.0001, this.house.colliders, shake, this.time);
        if (mode === 'ESCAPING') this.updateEscape(dt);
        this.director.lightning = 0;
      }
      this.dust.update(dt, this.time, this.player, 0, this.projScale());
    }
    this.hud.update(dt);
    this.updateAudio(dt);
    this.camera.fov = 72 + (this.audioDanger || 0) * 5; this.camera.updateProjectionMatrix();
    if (!skipRender) this.render();
  }

  projScale() { return this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)); }

  updateMeters() {
    const P = this.player, g = this.ghost;
    this.hud.setBattery(P.battery);
    this.hud.setBurn(g.burnable ? g.burn : 0);
  }

  updateEscape(dt) {
    this.escaping += dt;
    const e = this.escaping;
    this.house.escapeGlow.material.opacity = Math.min(1, e / 1.2);
    this.house.setLightning(Math.min(1.2, e * 0.8));
    if (e > 1.1) this.hud.holdFlash('#dfe9ff', Math.min(1, (e - 1.1) / 1.2));
    // drift the player toward the doorway
    this.player.pos.z += dt * 0.8; this.player.pos.z = Math.min(this.player.pos.z, 7.6);
    if (e > 2.8) {
      this.state = { mode: 'ESCAPED', playing: false, caught: false };
      this.hud.showHUD(false); this.player.unlock();
      const m = Math.floor(this.runTime / 60), s = Math.floor(this.runTime % 60);
      this.hud.showWin(true, `${m}:${String(s).padStart(2, '0')}`, this.banishCount);
      this.hud.holdFlash('#dfe9ff', 0);
    }
  }

  updateAudio(dt) {
    const a = this.audio, g = this.ghost, P = this.player;
    if (!a.ready) return;
    const fwd = P.forward(this._fw || (this._fw = new THREE.Vector3()));
    a.setListener({ x: P.pos.x, y: P.pos.y, z: P.pos.z }, fwd);
    let danger = this.director.adrenaline * 0.7;
    if (g.isActive && g.dist !== undefined) {
      const prox = Math.max(0, Math.min(1, 1 - (g.dist - 1.5) / 10));
      danger = Math.max(danger, prox * (g.state === 'chase' ? 1 : 0.85));
      a.setEntity({ x: g.pos.x, y: 1.8, z: g.pos.z }, g.visibleNow || g.state === 'chase' ? Math.max(0.12, prox) : 0);
    } else a.setEntity(null, 0);
    if (this.state.mode !== 'PLAYING') danger = 0;
    this.audioDanger = danger;
    a.setDanger(danger);
    if (this.director.chasing && this.state.mode === 'PLAYING') a.setChaseIntensity(danger);
    a.update(dt);
  }

  adaptive(dt) {
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc < 1.2) return;
    const avg = this.fpsAcc / this.fpsN; this.fpsAcc = 0; this.fpsN = 0;
    if (avg > 0.0225) { this.slow++; this.fast = 0; } else if (avg < 0.0145) { this.fast++; this.slow = 0; } else { this.slow = 0; this.fast = 0; }
    if (this.slow >= 2 && this.pixelRatio > 0.7) { this.setPR(this.pixelRatio - 0.15); this.slow = 0; }
    else if (this.fast >= 6 && this.pixelRatio < this.maxPR) { this.setPR(Math.min(this.maxPR, this.pixelRatio + 0.1)); this.fast = 0; }
  }
  setPR(v) { this.pixelRatio = v; this.renderer.setPixelRatio(v); this.composer.setPixelRatio(v); this.composer.setSize(window.innerWidth, window.innerHeight); }

  render() { this.composer.render(); }
}
