import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createMaterials } from './world/Textures.js';
import { createHouse } from './world/House.js';
import { Player } from './player/Player.js';
import { AudioEngine } from './systems/AudioEngine.js';
import { Ghost } from './systems/Ghost.js';
import { ScareDirector } from './systems/ScareDirector.js';
import { HUD } from './ui/HUD.js';

const BEAM_COS = Math.cos(0.5);

function chainVisible(obj) {
  let node = obj;
  while (node) {
    if (node.visible === false) return false;
    node = node.parent;
  }
  return true;
}

function kindNode(obj) {
  let node = obj;
  while (node) {
    if (node.userData && node.userData.kind) return node;
    node = node.parent;
  }
  return null;
}

export class Game {
  constructor() {
    this.state = 'title';
    this.held = new Set();
    this.keysFound = 0;
    this.banishes = 0;
    this.elapsed = 0;
    this.burn = 0;
    this.hintT = 0;
    this.unlockT = 0;
    this.endT = 0;
    this.time = 0;
    this._eye = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._chest = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.ray.far = 2.45;
    this.ray.layers.enable(1);
    this.losRay = new THREE.Raycaster();
    this.ready = false;
  }

  init() {
    const stage = document.getElementById('stage');
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.075);

    this.materials = createMaterials();
    this.world = createHouse(this.scene, this.materials);
    this.player = new Player(this.scene, this.materials.cookie);
    this.audio = new AudioEngine();
    this.hud = new HUD(this.materials.entityCanvas);
    this.ghost = new Ghost(this.scene, this.materials, this.world.safeSpots);
    this.director = new ScareDirector(this.world, this.audio, this.hud, this.ghost);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.player.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.16, 0.84);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this._bind();
    this._resize();
    this.ready = true;

    const params = new URLSearchParams(location.search);
    this.shot = params.get('shot');
    if (params.has('debug') || this.shot) {
      if (params.has('debug')) this._buildDebug();
      window.__bridge = this;
    }
    if (this.shot) this._enterShot();

    this.clock = new THREE.Clock();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  _bind() {
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('mousemove', (e) => {
      if (!this.ready || this.state !== 'playing') return;
      if (document.pointerLockElement !== this.canvas) return;
      this.player.applyLook(e.movementX, e.movementY);
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code.startsWith('Arrow')) e.preventDefault();
      this.held.add(e.code);
      if (e.code === 'KeyF' && this.state === 'playing') this.player.toggleLight();
      if (e.code === 'KeyE') this._onUse();
      if (e.code === 'F9' && this.debugGroup) {
        this.debugGroup.visible = !this.debugGroup.visible;
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    this.canvas.addEventListener('click', () => this.resume());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _resize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    if (this.composer.setPixelRatio) this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  start() {
    if (!this.ready || this.state === 'playing') return;
    this.audio.start();
    this.player.resetPose();
    this.player.spot.intensity = 56;
    this.state = 'playing';
    this.elapsed = 0;
    this.hintT = 12;
    this.unlockT = 0;
    this.director.enabled = true;
    this.hud.hideTitle();
    this.hud.setHint(true);
    this.hud.setObjective('Find the three brass keys.');
    this.hud.setKeys(0);
    this.canvas.requestPointerLock();
  }

  resume() {
    if (this.state === 'playing') this.canvas.requestPointerLock();
  }

  restart() {
    this.world.reset();
    this.player.resetPose();
    this.ghost.reset();
    this.director.reset();
    this.director.enabled = true;
    this.audio.calm();
    this.keysFound = 0;
    this.banishes = 0;
    this.elapsed = 0;
    this.burn = 0;
    this.endT = 0;
    this.hintT = 8;
    this.unlockT = 0;
    this.player.burning = false;
    this.hud.hideEnd();
    this.hud.hideNote();
    this.hud.hideJumpscare();
    this.hud.setKeys(0);
    this.hud.setBurn(false, 0);
    this.hud.setDanger(0);
    this.hud.setPrompt('');
    this.hud.setObjective('Find the three brass keys.');
    this.hud.setHint(true);
    this.state = 'playing';
    document.body.classList.add('playing');
    document.body.classList.remove('menu');
    this.canvas.requestPointerLock();
  }

  closeNote() {
    if (this.state !== 'note') return;
    this.hud.hideNote();
    this.state = 'playing';
    this.canvas.requestPointerLock();
  }

  _onUse() {
    if (this.state === 'note') {
      this.closeNote();
      return;
    }
    if (this.state !== 'playing') return;
    this._interact();
  }

  _frame() {
    requestAnimationFrame(this._frame);
    if (!this.ready) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    if (this.state === 'shot') {
      this.player.blackout = false;
      this.player.update(dt, this.world.colliders, { forward: 0, strafe: 0, sprint: false });
      const lightOn = this.player.lightOn && this.player.battery > 0;
      this.world.update(dt, this.time, this.player, lightOn);
      this.composer.render();
      return;
    }

    if (this.state === 'title') {
      this.player.yaw.rotation.y = Math.sin(this.time * 0.12) * 0.42;
      this.player.pitch.rotation.x = -0.08 + Math.sin(this.time * 0.07) * 0.05;
      this.player.spot.intensity = 0;
      this.world.update(dt, this.time, this.player, false);
      this.director.update(dt, this.player);
      this.hud.update(dt);
      this.composer.render();
      return;
    }

    if (this.state === 'note') {
      this.hud.update(dt);
      this.composer.render();
      return;
    }

    if (this.state === 'caught' || this.state === 'escaped' || this.state === 'escaping') {
      this.endT -= dt;
      if (this.state === 'escaping' && this.endT <= 0) this._showWin();
      if (this.state === 'caught' && this.endT <= 0 && this._deathPending) {
        this._deathPending = false;
        this.hud.showDeath(this.elapsed);
      }
      this.world.update(dt, this.time, this.player, false);
      this.hud.update(dt);
      this.composer.render();
      return;
    }

    const locked = document.pointerLockElement === this.canvas;
    if (!locked) {
      this.unlockT += dt;
      if (this.unlockT > 0.45) {
        this.hud.showPause();
        this.hud.update(dt);
        this.composer.render();
        return;
      }
    } else {
      this.unlockT = 0;
      this.hud.hidePause();
    }

    this.elapsed += dt;
    this.hintT -= dt;
    this.hud.setHint(this.hintT > 0);

    const input = {
      forward: (this.held.has('KeyW') || this.held.has('ArrowUp') ? 1 : 0)
        - (this.held.has('KeyS') || this.held.has('ArrowDown') ? 1 : 0),
      strafe: (this.held.has('KeyD') || this.held.has('ArrowRight') ? 1 : 0)
        - (this.held.has('KeyA') || this.held.has('ArrowLeft') ? 1 : 0),
      sprint: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
    };

    this.player.blackout = this.world.blackout;
    const step = this.player.update(dt, this.world.colliders, input);
    if (step.stepped) this.audio.footstep(step.sprint);

    const lightOn = this.player.lightOn && this.player.battery > 0 && !this.world.blackout;
    this.world.update(dt, this.time, this.player, lightOn);
    this.director.update(dt, this.player);

    const allowManifest = this.director.quiet <= 0 && this.director.sequence !== 'blackout';
    const ghostEvents = this.ghost.update(dt, this.player.x, this.player.z, allowManifest);
    this._fight(dt, ghostEvents, lightOn);
    this._prompt();

    const front = this.world.doors.front;
    const throughDoor = this.keysFound >= 3
      && front
      && front.openAmount > 0.62
      && this.player.z > 7.78
      && Math.abs(this.player.x) < 0.52;
    if (throughDoor) {
      this._escape();
    }

    this._audioMood(dt);
    this.hud.setBattery(this.player.battery, this.player.battery < 0.2);
    this.hud.update(dt);
    this.audio.updateListener(this.player.camera);
    this.composer.render();
  }

  _fight(dt, events, lightOn) {
    const ghost = this.ghost;
    const chest = ghost.chest(this._chest);
    this.player.eye(this._eye);
    this._to.copy(chest).sub(this._eye);
    const dist = this._to.length();
    if (dist > 0.001) this._to.multiplyScalar(1 / dist);
    this.player.aimDirection(this._aim);
    const dot = this._aim.dot(this._to);
    const fighting = ghost.active && (ghost.state === 'stalk' || ghost.state === 'chase');
    const aimed = lightOn && fighting && dist < 11 && dot > BEAM_COS;
    const blocked = aimed ? this._losBlocked(this._eye, this._to, dist) : true;
    const burning = aimed && !blocked;

    this.player.burning = burning;
    if (burning) this.burn = Math.min(1, this.burn + dt / 1.45);
    else this.burn = Math.max(0, this.burn - dt * 0.48);

    if (this.burn >= 1 && fighting) {
      this.burn = 0;
      this.banishes += 1;
      ghost.banish();
      this.audio.shriek();
      this.hud.flash('white', 0.28);
      this.hud.shake(7, 0.28);
    }

    this.hud.setBurn(fighting && (burning || this.burn > 0.02), this.burn);

    if (events.proximity && ghost.phase !== 'finale') {
      this.audio.shriek();
      this.hud.flash('red', 0.45);
      this.hud.shake(10, 0.35);
    }
    if (events.reformed) this.audio.growl();

    if (events.caught && this.state === 'playing') {
      const throughWall = this._losBlocked(this._eye, this._to, dist);
      if (!throughWall || dist < 0.68) this._caught();
    }

    let danger = 0;
    if (ghost.phase === 'stalk') danger = 0.28;
    if (ghost.phase === 'finale' || this.director.sequence) danger = Math.max(danger, 0.72);
    if (ghost.active) danger = Math.max(danger, 1 - Math.min(dist, 8) / 8);
    this.hud.setDanger(this.state === 'playing' ? Math.max(0, danger - 0.2) * 0.85 : 0);
    this._danger = danger;
  }

  _losBlocked(origin, dir, dist) {
    this.losRay.set(origin, dir);
    this.losRay.far = Math.max(0.2, dist);
    const hits = this.losRay.intersectObjects(this.world.rayMeshes, true);
    for (let i = 0; i < hits.length; i++) {
      if (!chainVisible(hits[i].object)) continue;
      return hits[i].distance < dist - 0.35;
    }
    return false;
  }

  _prompt() {
    this.player.eye(this._eye);
    this.player.aimDirection(this._aim);
    this.ray.set(this._eye, this._aim);
    const hits = this.ray.intersectObjects(this.world.rayMeshes, true);
    let text = '';
    let hot = false;
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (!chainVisible(hit.object)) continue;
      if (hit.distance > 2.35) break;
      const node = kindNode(hit.object);
      if (!node) break;
      const data = node.userData;
      if (data.kind === 'key' && data.ref && !data.ref.taken) {
        text = 'E  Take the key';
        hot = true;
      } else if (data.kind === 'battery' && data.ref && !data.ref.taken) {
        text = 'E  Take the battery';
        hot = true;
      } else if (data.kind === 'note') {
        text = 'E  Read';
        hot = true;
      } else if (data.kind === 'door') {
        const door = this.world.doors[data.id];
        if (!door) break;
        hot = true;
        if (door.id === 'front' && this.keysFound < 3) text = 'E  Locked — three keys';
        else if (door.id === 'front') text = 'E  Open the front door';
        else if (door.busy > 0) text = '';
        else text = door.openAmount > 0.2 ? 'E  Close door' : 'E  Open door';
      }
      break;
    }
    this.hud.setPrompt(text);
    this.hud.setCrosshairHot(hot);
    this._look = hot ? this._lookTarget(hits) : null;
  }

  _lookTarget(hits) {
    for (let i = 0; i < hits.length; i++) {
      if (!chainVisible(hits[i].object)) continue;
      return kindNode(hits[i].object);
    }
    return null;
  }

  _interact() {
    this._prompt();
    const node = this._look;
    if (!node) return;
    const data = node.userData;
    if (data.kind === 'key' && data.ref && !data.ref.taken) {
      data.ref.taken = true;
      data.ref.group.visible = false;
      this.keysFound += 1;
      this.audio.keyPickup();
      this.hud.setKeys(this.keysFound);
      this._onKey(data.ref);
      return;
    }
    if (data.kind === 'battery' && data.ref && !data.ref.taken) {
      data.ref.taken = true;
      data.ref.group.visible = false;
      this.player.battery = Math.min(1, this.player.battery + 0.48);
      this.player.lightOn = true;
      this.audio.batteryPickup();
      return;
    }
    if (data.kind === 'note') {
      this.state = 'note';
      this.hud.showNote(data.title, data.body);
      document.exitPointerLock();
      return;
    }
    if (data.kind === 'door') {
      const door = this.world.doors[data.id];
      if (!door) return;
      if (door.id === 'front' && this.keysFound < 3) {
        this.audio.doorRattle();
        this.hud.shake(2, 0.15);
        return;
      }
      if (door.id === 'front') {
        door.locked = false;
        if (door.openAmount < 0.2) {
          door.forceOpen();
          this.audio.doorCreak();
        }
        return;
      }
      if (door.busy > 0) return;
      if (door.toggle()) this.audio.doorCreak();
    }
  }

  _onKey(key) {
    if (this.keysFound >= 3) {
      this.world.doors.front.locked = false;
      this.hud.setObjective('The front door. Run.');
      this.director.onFinalKey();
      return;
    }
    if (key.id === 'study') this.director.onStudyKey();
    if (this.keysFound === 2) {
      this.director.onSecondKey();
      this.hud.setObjective('One key left. It is awake.');
    } else {
      this.hud.setObjective('Two keys remain.');
    }
  }

  _audioMood(dt) {
    const ghost = this.ghost;
    const dist = Math.hypot(ghost.group.position.x - this.player.x, ghost.group.position.z - this.player.z);
    const breath = ghost.active ? Math.max(0, 1 - dist / 7) : 0;
    this.audio.setBreath(breath, ghost.group.position.x, 1.5, ghost.group.position.z);
    this.audio.update(dt, this._danger || 0);
  }

  _caught() {
    if (this.state !== 'playing') return;
    this.state = 'caught';
    this._deathPending = true;
    this.endT = 0.95;
    this.player.burning = false;
    this.audio.setChase(false);
    this.audio.scream();
    this.hud.flash('white', 1);
    this.hud.shake(16, 0.45);
    this.hud.showJumpscare();
    this.hud.setBurn(false, 0);
    document.exitPointerLock();
  }

  _escape() {
    if (this.state !== 'playing') return;
    this.state = 'escaping';
    this.endT = 0.85;
    this.player.burning = false;
    this.audio.setChase(false);
    this.hud.flash('white', 0.55);
    this.ghost.group.visible = false;
    this.ghost.state = 'hidden';
    document.exitPointerLock();
  }

  _showWin() {
    this.state = 'escaped';
    this.audio.calm();
    this.hud.showWin(this.elapsed, this.banishes);
  }

  _enterShot() {
    document.getElementById('title-screen').classList.add('hidden');
    document.getElementById('hud').style.opacity = '0';
    document.body.classList.remove('menu');
    this.player.resetPose();
    this.player.lightOn = true;
    if (this.shot === 'hall') {
      this.player.yaw.position.set(-7.2, 0, 0);
      this.player.yaw.rotation.y = -Math.PI / 2;
    } else if (this.shot === 'kitchen') {
      this.player.yaw.position.set(6.9, 0, -3.5);
      this.player.yaw.rotation.y = -Math.PI / 2;
    } else if (this.shot === 'study') {
      this.player.yaw.position.set(-6.9, 0, -4.6);
      this.player.yaw.rotation.y = Math.PI / 2;
    } else if (this.shot === 'shadow') {
      this.player.yaw.position.set(6.35, 0, -3.15);
      this.player.yaw.rotation.y = 0.62;
      this.player.pitch.rotation.x = -0.58;
    } else if (this.shot === 'shelf') {
      this.player.yaw.position.set(-7.55, 0, -6.35);
      this.player.yaw.rotation.y = 2.45;
    }
    this.state = 'shot';
    let casters = 0;
    this.scene.traverse((obj) => {
      if (obj.isLight && obj.castShadow) casters += 1;
    });
    document.documentElement.dataset.shadowCasters = String(casters);
    document.documentElement.dataset.shot = this.shot;
  }

  _buildDebug() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x33ff88, wireframe: true });
    for (const c of this.world.colliders) {
      const w = Math.max(0.05, c.maxX - c.minX);
      const d = Math.max(0.05, c.maxZ - c.minZ);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), mat);
      mesh.position.set((c.minX + c.maxX) / 2, 0.2, (c.minZ + c.maxZ) / 2);
      group.add(mesh);
    }
    group.visible = false;
    this.scene.add(group);
    this.debugGroup = group;
  }
}
