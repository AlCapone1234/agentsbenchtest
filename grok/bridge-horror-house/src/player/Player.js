import * as THREE from 'three';

export const PLAYER_RADIUS = 0.3;
export const EYE_HEIGHT = 1.64;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Move a point whose collision skin is `radius`.
 * Colliders are expanded into AABBs; the player is the point at the body center.
 * X is resolved before Z so walls slide instead of sticking.
 */
export function moveWithCollision(x, z, radius, dx, dz, colliders) {
  let nx = x + dx;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.active === false) continue;
    const minX = c.minX - radius;
    const maxX = c.maxX + radius;
    const minZ = c.minZ - radius;
    const maxZ = c.maxZ + radius;
    if (nx > minX && nx < maxX && z > minZ && z < maxZ) {
      nx = dx > 0 ? minX : maxX;
    }
  }
  let nz = z + dz;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.active === false) continue;
    const minX = c.minX - radius;
    const maxX = c.maxX + radius;
    const minZ = c.minZ - radius;
    const maxZ = c.maxZ + radius;
    if (nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
      nz = dz > 0 ? minZ : maxZ;
    }
  }
  return { x: nx, z: nz };
}

/**
 * Camera-relative planar basis, read from the camera every call.
 * Canonical check: camera looking down -Z → forward (0,0,-1), right (1,0,0).
 * right = forward × up. crossVectors(up, forward) would be left.
 */
export function cameraBasis(camera, forward, right) {
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  else forward.normalize();
  right.crossVectors(forward, UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  else right.normalize();
  return { forward, right };
}

export class Player {
  constructor(scene, cookie) {
    this.yaw = new THREE.Group();
    this.pitch = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.06, 42);
    this.yaw.add(this.pitch);
    this.pitch.add(this.camera);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    scene.add(this.yaw);

    this.pivot = new THREE.Group();
    this.camera.add(this.pivot);

    this.spot = new THREE.SpotLight(0xffe2bc, 56, 18, 0.78, 0.62, 2);
    this.spot.position.set(0.16, -0.15, 0.02);
    this.spot.map = cookie;
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.00018;
    this.spot.shadow.normalBias = 0.025;
    this.spot.shadow.radius = 6;
    this.spot.shadow.camera.near = 0.2;
    this.spot.shadow.camera.far = 18;
    this.spot.shadow.camera.fov = 92;
    this.pivot.add(this.spot);
    this.target = new THREE.Object3D();
    this.target.position.set(0.16, -0.15, -6);
    this.pivot.add(this.target);
    this.spot.target = this.target;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.4 }),
    );
    body.rotation.x = Math.PI / 2;
    body.position.set(0.18, -0.22, -0.12);
    body.castShadow = false;
    this.camera.add(body);
    this.torchMesh = body;

    this.fwd = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.aim = new THREE.Vector3();

    this.battery = 1;
    this.lightOn = true;
    this.sprinting = false;
    this.bob = 0;
    this.bobAmp = 0;
    this.stepDist = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.blackout = false;
    this.burning = false;
    this.baseFov = 62;

    this.resetPose();
  }

  resetPose() {
    this.yaw.position.set(0, 0, 6.15);
    this.yaw.rotation.y = 0;
    this.pitch.rotation.x = 0;
    this.vel.set(0, 0, 0);
    this.battery = 1;
    this.lightOn = true;
    this.bob = 0;
    this.stepDist = 0;
    this.blackout = false;
    this.burning = false;
  }

  get x() { return this.yaw.position.x; }
  get z() { return this.yaw.position.z; }

  applyLook(dx, dy) {
    const sens = 0.00215;
    this.yaw.rotation.y -= dx * sens;
    this.pitch.rotation.x -= dy * sens;
    const limit = 1.45;
    if (this.pitch.rotation.x > limit) this.pitch.rotation.x = limit;
    if (this.pitch.rotation.x < -limit) this.pitch.rotation.x = -limit;
    this.lookDX = dx;
    this.lookDY = dy;
  }

  toggleLight() {
    if (this.battery <= 0) return;
    this.lightOn = !this.lightOn;
  }

  basis() {
    return cameraBasis(this.camera, this.fwd, this.right);
  }

  update(dt, colliders, input) {
    const { forward, right } = this.basis();
    const sprint = !!input.sprint && (input.forward !== 0 || input.strafe !== 0);
    this.sprinting = sprint;
    const speed = sprint ? 4.75 : 2.35;
    this.wish.set(0, 0, 0);
    if (input.forward) this.wish.addScaledVector(forward, input.forward);
    if (input.strafe) this.wish.addScaledVector(right, input.strafe);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.wish.multiplyScalar(speed);

    const blend = 1 - Math.exp(-12 * dt);
    this.vel.lerp(this.wish, blend);

    const next = moveWithCollision(
      this.yaw.position.x,
      this.yaw.position.z,
      PLAYER_RADIUS,
      this.vel.x * dt,
      this.vel.z * dt,
      colliders,
    );
    const movedX = next.x - this.yaw.position.x;
    const movedZ = next.z - this.yaw.position.z;
    this.yaw.position.x = next.x;
    this.yaw.position.z = next.z;
    if (Math.abs(movedX) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x = 0;
    if (Math.abs(movedZ) < Math.abs(this.vel.z * dt) * 0.5) this.vel.z = 0;

    const moving = this.vel.lengthSq() > 0.15;
    if (moving) {
      this.bob += dt * (sprint ? 11.5 : 8.2);
      this.bobAmp = Math.min(1, this.bobAmp + dt * 4);
      this.stepDist += Math.hypot(movedX, movedZ);
    } else {
      this.bobAmp = Math.max(0, this.bobAmp - dt * 4);
    }
    const bobY = Math.sin(this.bob * 2) * 0.03 * this.bobAmp * (sprint ? 1.4 : 1);
    const bobX = Math.cos(this.bob) * 0.012 * this.bobAmp;
    this.camera.position.set(bobX, EYE_HEIGHT + bobY, 0);

    const targetFov = sprint ? 66 : this.baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();

    this.swayX += ((this.lookDY * 0.0012 + Math.sin(this.bob) * 0.01) - this.swayX) * Math.min(1, dt * 6);
    this.swayY += ((this.lookDX * 0.0012 + Math.sin(this.bob * 0.5) * 0.012) - this.swayY) * Math.min(1, dt * 6);
    this.pivot.rotation.x = this.swayX;
    this.pivot.rotation.y = this.swayY;
    this.lookDX = 0;
    this.lookDY = 0;

    this._updateLight(dt);

    const stepLen = sprint ? 1.15 : 1.45;
    let stepped = false;
    if (this.stepDist >= stepLen) {
      this.stepDist = 0;
      stepped = moving;
    }
    return { stepped, sprint: this.sprinting };
  }

  _updateLight(dt) {
    const on = this.lightOn && this.battery > 0 && !this.blackout;
    if (on) {
      const drain = (this.burning ? 0.034 : 0.0064) * dt;
      this.battery = Math.max(0, this.battery - drain);
      if (this.battery <= 0) this.lightOn = false;
    }
    let flick = 1;
    if (on && this.battery < 0.2) {
      const k = 1 - this.battery / 0.2;
      if (Math.random() < 0.04 + k * 0.25) flick = Math.random() * 0.25;
      else flick = 0.65 + Math.random() * 0.35;
    } else if (on) {
      flick = 0.96 + Math.sin(performance.now() * 0.02) * 0.04;
    }
    this.spot.intensity = on ? 56 * flick : 0;
    this.torchMesh.visible = true;
  }

  aimDirection(out) {
    this.camera.getWorldDirection(out);
    return out;
  }

  eye(out) {
    return this.camera.getWorldPosition(out);
  }
}
