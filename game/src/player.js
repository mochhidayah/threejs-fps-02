// Player movement: acceleration, friction, gravity, crouch and jump, resolved as a box against
// the world's colliders one axis at a time, so a wall never swallows the player.
// Health and armor: Kevlar absorbs 50% of incoming damage until it depletes.
// Hit meshes: transparent (opacity 0) boxes/sphere at the body, so bot raycasts can hit the
// player while the first-person camera never sees them.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const MAX_HEALTH = 100;
const MAX_ARMOR = 100;

export function createPlayer(colliders, scene) {
  const player = {
    position: new THREE.Vector3(0, 0, 9.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    health: MAX_HEALTH,
    armor: 0,
    alive: true,
    lastHitDir: new THREE.Vector3(),
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // Hit meshes follow the player. One shared invisible material: visible = true (so the
  // raycaster intersects them) but opacity 0, so nothing renders in the player's view.
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  function hitMesh(geometry, part, y) {
    const mesh = new THREE.Mesh(geometry, hitMaterial);
    mesh.position.y = y;
    mesh.userData.part = part;
    return mesh;
  }
  const hitGroup = new THREE.Group();
  const torsoMesh = hitMesh(new THREE.BoxGeometry(0.68, 0.75, 0.38), 'torso', 1.2);
  const headMesh = hitMesh(new THREE.SphereGeometry(0.17, 12, 8), 'head', 1.6);
  const legsMesh = hitMesh(new THREE.BoxGeometry(0.6, 0.85, 0.34), 'legs', 0.425);
  hitGroup.add(torsoMesh, headMesh, legsMesh);
  hitGroup.position.copy(player.position);
  if (scene) scene.add(hitGroup);
  const hitMeshes = [torsoMesh, headMesh, legsMesh];

  // lift keeps the feet and the crown out of the horizontal tests, so standing on the floor
  // is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  // Armor absorbs half the damage until it runs out; returns the health damage dealt.
  function damage(amount, fromDir) {
    if (!player.alive) return 0;
    const absorbed = Math.min(player.armor, amount * 0.5);
    player.armor -= absorbed;
    const dealt = amount - absorbed;
    player.health = Math.max(0, player.health - dealt);
    if (fromDir) player.lastHitDir.copy(fromDir);
    if (player.health <= 0) player.alive = false;
    return dealt;
  }

  function addArmor(amount) {
    player.armor = Math.min(MAX_ARMOR, player.armor + amount);
  }

  function reset(spawn) {
    player.position.copy(spawn);
    player.velocity.set(0, 0, 0);
    player.yaw = 0;
    player.pitch = 0;
    player.eye = STAND_EYE;
    player.onGround = true;
    player.crouching = false;
    player.height = STAND_HEIGHT;
    player.health = MAX_HEALTH;
    player.armor = 0;
    player.alive = true;
    hitGroup.position.copy(spawn);
    hitGroup.scale.y = 1;
  }

  function step(dt, keys) {
    if (!player.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;

    const nextX = player.position.x + player.velocity.x * dt;
    if (!overlaps(nextX, player.position.y, player.position.z, player.height, 0.04)) player.position.x = nextX;
    else player.velocity.x = 0;
    const nextZ = player.position.z + player.velocity.z * dt;
    if (!overlaps(player.position.x, player.position.y, nextZ, player.height, 0.04)) player.position.z = nextZ;
    else player.velocity.z = 0;

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
    player.velocity.y = Math.max(-30, player.velocity.y);
    hitGroup.position.copy(player.position);
    hitGroup.scale.y = player.height / STAND_HEIGHT;
  }

  return {
    state: player,
    step,
    look,
    recoil,
    damage,
    addArmor,
    reset,
    hitMeshes,
    hitGroup,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
  };
}
