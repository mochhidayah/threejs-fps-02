// IRONBOUND: boot and the one loop — a fixed 60 Hz simulation feeding a render
// at the display's rate. Shooting, grenades, round flow and the deterministic
// ?shot=start|play|site|end captures (render twice, freeze, window.__shotReady).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon } from './weapon.js';
import { createBots } from './bots.js';
import { createObjective } from './objective.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createRounds } from './rounds.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in three 0.187
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 18, 46);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const weapon = createWeapon(camera);
const hud = createHud();
const audio = createAudio();
const player = createPlayer(world.colliders, scene);
const bots = createBots(scene, world, audio);
const objective = createObjective(scene, world);
const input = createInput(renderer.domElement, onLockChange, onBuyKey);
const rounds = createRounds({
  weapon, objective, bots, player, audio, hud, spawns: world.spawns,
  onRoundStart() {
    deathNotified = false;
    hud.banner(`ROUND ${rounds.round}`, 'Plant the device — or clear the Sentinels');
  },
  onMatchEnd() {
    hud.showOverlay('match', { v: rounds.scores.vanguard, s: rounds.scores.sentinel });
    if (document.pointerLockElement) document.exitPointerLock();
  },
});

// G is the one state object. events is one reused array, cleared at the end of
// every fixed step after the bots have consumed it.
const G = {
  player, bots, weapons: weapon, rounds, objective, audio, hud, world,
  events: [], time: 0, rng: random,
};
window.__ironbound = G; // debug handle for headless playtests; read-only use
window.__step = settle; // test hook: advance the fixed-step sim N steps at once

const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const direction = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const chestPos = new THREE.Vector3();
const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
const SHOT_KIND = { p9: 'pistol', vk9: 'rifle', wasp9: 'smg', longbow: 'dmr' };

// Tracer: one reused line, positions rewritten per shot, fades in 60 ms.
const tracerGeo = new THREE.BufferGeometry();
const tracerPos = new Float32Array(6);
tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 });
const tracer = new THREE.Line(tracerGeo, tracerMat);
tracer.visible = false;
tracer.frustumCulled = false;
scene.add(tracer);
let tracerLife = 0;

// Event pool: main.js pushes at most a shot and an explosion per step, so a
// small ring of preallocated entries never overwrites a live one.
const evPool = [];
for (let i = 0; i < 8; i += 1) evPool.push({ type: 'shot', pos: new THREE.Vector3(), radius: 30, team: 'vanguard' });
let evI = 0;
function pushEvent(type, pos, radius, team) {
  const e = evPool[evI];
  evI = (evI + 1) % evPool.length;
  e.type = type;
  e.pos.copy(pos);
  e.radius = radius;
  e.team = team;
  G.events.push(e);
}

// Grenades: a pool of 3 visible meshes; active throws are plain objects.
const grenadeMeshes = [];
for (let i = 0; i < 3; i += 1) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 }),
  );
  m.visible = false;
  scene.add(m);
  grenadeMeshes.push(m);
}
const grenades = [];
let selectedGrenade = 'he';

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;
let started = false;
let paused = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let lastDigit = '';
let deathNotified = false;
let prevObjState = objective.state;

const objCtx = {
  player, bots: bots.list, time: 0, audio, events: G.events,
  onRoundEnd: (winner, reason) => rounds.endRound(winner, reason),
};
const botCtx = {
  playerPos: player.state.position,
  playerAlive: true,
  playerHitMeshes: player.hitMeshes,
  playerSpeed: 0,
  bomb: objective,
  time: 0,
  events: G.events,
  rng: random,
  onPlayerDamaged(dmg, part, botPos) {
    if (!player.state.alive) return;
    tmpDir.copy(player.state.position).sub(botPos);
    tmpDir.y = 0;
    player.damage(dmg, tmpDir);
    hud.setHealth(player.state.health, player.state.armor);
    const ang = Math.atan2(-(botPos.x - player.state.position.x), -(botPos.z - player.state.position.z));
    let rel = ang - player.state.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    hud.damageFlash(rel);
  },
  onBotKilled(bot, killer) {
    hud.killfeed(`${killer.name} ▸ ${bot.name}`);
  },
};

function onBuyKey() {
  if (shot || rounds.phase !== 'buy') return;
  if (hud.buyOpen()) hud.hideBuy();
  else hud.showBuy(rounds.items, rounds.money);
}

hud.onBuy((id) => { rounds.buy(id); });
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.phase === 'match' || rounds.phase === 'menu') {
    if (rounds.phase === 'match') rounds.resetMatch();
    rounds.startBuyPhase();
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    paused = false;
    hud.hideOverlay();
  } else if (rounds.phase === 'match') {
    // Match overlay already shown by onMatchEnd; leave it alone.
  } else if (!started) {
    hud.showOverlay('start');
  } else {
    paused = true;
    hud.hideBuy();
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function botChest(bot) {
  return chestPos.set(bot.pos.x, bot.pos.y + 1.25, bot.pos.z);
}

function shoot(spread) {
  if (!weapon.takeRound()) { audio.dry(); return false; }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const botHit = raycaster.intersectObjects(bots.hitMeshes, false)[0];
  const worldHit = raycaster.intersectObjects(world.shootables, false)[0];
  const endPoint = tmpPos;
  if (botHit && (!worldHit || botHit.distance < worldHit.distance)) {
    endPoint.copy(botHit.point);
    const bot = botHit.object.userData.bot;
    const part = botHit.object.userData.part || 'torso';
    const mult = part === 'head' ? 2 : part === 'legs' ? 0.75 : 1;
    const killed = bots.damage(bot, weapon.current.damage * mult, part);
    if (part === 'head') audio.headshot();
    else audio.hit();
    hud.hitMarker(killed, markerHoldMs);
    if (killed) {
      rounds.addKill();
      hud.killfeed(`You ▸ ${bot.name}${part === 'head' ? ' — headshot' : ''}`);
      audio.kill();
    }
  } else if (worldHit) {
    endPoint.copy(worldHit.point);
  } else {
    endPoint.copy(camera.position).addScaledVector(direction, 80);
  }
  tracerPos[0] = camera.position.x;
  tracerPos[1] = camera.position.y;
  tracerPos[2] = camera.position.z;
  tracerPos[3] = endPoint.x;
  tracerPos[4] = endPoint.y;
  tracerPos[5] = endPoint.z;
  tracerGeo.attributes.position.needsUpdate = true;
  tracer.visible = true;
  tracerMat.opacity = 0.9;
  tracerLife = 0.06;
  weapon.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(SHOT_KIND[weapon.state.name] || 'rifle');
  pushEvent('shot', camera.position, 30, 'vanguard');
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.current.label);
  return true;
}

function throwGrenade(kind) {
  if (rounds.phase !== 'live' || !player.state.alive) return;
  if (rounds.grenades[kind] <= 0 || grenades.length >= 3) return;
  const mesh = grenadeMeshes.find((m) => !m.visible);
  if (!mesh) return;
  rounds.grenades[kind] -= 1;
  camera.getWorldDirection(direction);
  const pos = camera.position.clone().addScaledVector(direction, 0.4);
  pos.y -= 0.1;
  const vel = direction.clone().multiplyScalar(14);
  vel.y += 2.5;
  vel.addScaledVector(player.state.velocity, 0.5);
  grenades.push({ pos, vel, fuse: kind === 'he' ? 3 : 1, kind, mesh, bounced: false });
  mesh.visible = true;
  mesh.position.copy(pos);
}

function detonate(g) {
  g.mesh.visible = false;
  if (g.kind === 'he') {
    audio.explosion();
    pushEvent('explosion', g.pos, 60, 'vanguard');
    for (const bot of bots.list) {
      if (!bot.alive || bot.team !== 'sentinel') continue;
      const d = Math.hypot(bot.pos.x - g.pos.x, bot.pos.y + 1.2 - g.pos.y, bot.pos.z - g.pos.z);
      if (d >= 6) continue;
      const killed = bots.damage(bot, 90 * (1 - d / 6), 'torso');
      if (killed) {
        rounds.addKill();
        hud.killfeed(`You ▸ ${bot.name} — HE blast`);
        audio.kill();
      }
    }
    const pd = Math.hypot(
      player.state.position.x - g.pos.x,
      player.state.position.y + 1.0 - g.pos.y,
      player.state.position.z - g.pos.z,
    );
    if (pd < 6 && player.state.alive) {
      tmpDir.copy(player.state.position).sub(g.pos);
      player.damage(90 * (1 - pd / 6), tmpDir);
      hud.setHealth(player.state.health, player.state.armor);
      hud.damageFlash(0);
    }
  } else {
    audio.flash();
    tmpDir.copy(g.pos).sub(camera.position);
    const dist = tmpDir.length();
    if (dist < 18) {
      tmpDir.normalize();
      camera.getWorldDirection(direction);
      const facing = direction.dot(tmpDir) > 0.1;
      if (facing && world.losClear(camera.position, g.pos)) {
        hud.flashWhite(Math.min(1, 1.3 - dist / 18));
      }
    }
    for (const bot of bots.list) {
      if (!bot.alive) continue;
      tmpPos.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
      tmpDir.copy(g.pos).sub(tmpPos);
      const bd = tmpDir.length();
      if (bd >= 18) continue;
      tmpDir.normalize();
      const bfacing = -Math.sin(bot.yaw) * tmpDir.x - Math.cos(bot.yaw) * tmpDir.z > 0.1;
      if (bfacing && world.losClear(tmpPos, g.pos)) bots.blind(bot, 2, G.time);
    }
  }
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 20 * dt;
    const nx = g.pos.x + g.vel.x * dt;
    if (!world.moveBox(tmpPos.set(nx, g.pos.y, g.pos.z), 0.12, 0.12, 0.24)) g.pos.x = nx;
    else { g.vel.x *= -0.4; if (!g.bounced) { g.bounced = true; if (g.kind === 'he') g.fuse = Math.min(g.fuse, 1.2); } }
    const nz = g.pos.z + g.vel.z * dt;
    if (!world.moveBox(tmpPos.set(g.pos.x, g.pos.y, nz), 0.12, 0.12, 0.24)) g.pos.z = nz;
    else { g.vel.z *= -0.4; if (!g.bounced) { g.bounced = true; if (g.kind === 'he') g.fuse = Math.min(g.fuse, 1.2); } }
    const ny = g.pos.y + g.vel.y * dt;
    if (ny <= 0) {
      g.pos.y = 0;
      if (Math.abs(g.vel.y) > 0.5) g.vel.y = -g.vel.y * 0.4;
      else g.vel.y = 0;
      if (!g.bounced) { g.bounced = true; if (g.kind === 'he') g.fuse = Math.min(g.fuse, 1.2); }
    } else if (!world.moveBox(tmpPos.set(g.pos.x, ny, g.pos.z), 0.12, 0.12, 0.24)) {
      g.pos.y = ny;
    } else {
      g.vel.y *= -0.4;
      if (!g.bounced) { g.bounced = true; if (g.kind === 'he') g.fuse = Math.min(g.fuse, 1.2); }
    }
    g.mesh.position.set(g.pos.x, g.pos.y + 0.09, g.pos.z);
    if (g.fuse <= 0) {
      detonate(g);
      grenades.splice(i, 1);
    }
  }
}

function bombText() {
  if (rounds.phase === 'buy') return 'Buy phase — press B for the shop';
  if (rounds.phase === 'menu' || rounds.phase === 'match') return '';
  if (objective.state === 'planted') return `Device planted — detonation in ${Math.max(0, Math.ceil(objective.fuseLeft))} s`;
  if (objective.state === 'defusing') return 'Device being defused — stop them!';
  if (objective.state === 'planting') return `Planting… ${Math.round(objective.plantProgress * 100)}%`;
  if (objective.state === 'dropped') return 'Device dropped — a teammate is fetching it';
  if (objective.state === 'detonated') return 'Device detonated';
  if (objective.state === 'defused') return 'Device defused';
  return 'Carry the device to Foundry (A) or Depot (B) — hold E to plant';
}

function syncHud() {
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.current.label);
  hud.setMoney(rounds.money);
  hud.setScore(rounds.scores.vanguard, rounds.scores.sentinel);
  hud.setRound(rounds.round);
  hud.setTimer(Math.max(0, Math.ceil(rounds.timer)));
  hud.setBomb(bombText());
  hud.setSpread(6 + Math.min(34, weapon.spread(player.groundSpeed(), weapon.state.bloom) * 900));
}

function step(dt) {
  G.time += dt;
  player.step(dt, input.state.keys);
  weapon.step(dt);
  if (rounds.phase === 'buy' || rounds.phase === 'live' || rounds.phase === 'over') {
    if (input.state.keys.has('KeyE')) objective.tryPlant();
    stepGrenades(dt);
    rounds.step(dt);
    objCtx.time = G.time;
    objective.step(dt, objCtx);
    if (objective.state === 'planted' && prevObjState !== 'planted') rounds.plantBonus();
    prevObjState = objective.state;
    if (rounds.phase === 'live') {
      botCtx.playerAlive = player.state.alive;
      botCtx.playerSpeed = player.groundSpeed();
      botCtx.time = G.time;
      bots.step(dt, botCtx);
    }
    if (!player.state.alive) {
      if (objective.carrier === 'player') objective.drop(player.state.position);
      if (!deathNotified) {
        deathNotified = true;
        hud.banner('YOU ARE DOWN', 'A teammate carries the fight — watch for the next round');
      }
    }
  }
  if (tracerLife > 0) {
    tracerLife -= dt;
    tracerMat.opacity = Math.max(0, tracerLife / 0.06) * 0.9;
    if (tracerLife <= 0) tracer.visible = false;
  }
  G.events.length = 0;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const cur = weapon.current;
    const wantFire = input.state.firing && rounds.phase === 'live' && player.state.alive && input.state.locked;
    if (wantFire && weapon.ready()) {
      if (cur.auto || !prevFiring) shoot(weapon.spread(player.groundSpeed(), weapon.state.bloom));
    } else if (wantFire && !cur.auto && !prevFiring && weapon.state.mag === 0) {
      audio.dry();
    }
    prevFiring = input.state.firing;
    const rlBefore = weapon.state.reloadLeft;
    if (input.state.keys.has('KeyR')) weapon.reload();
    if (weapon.state.reloadLeft > 0 && rlBefore === 0) audio.reload();
    if (input.takeGrenade()) throwGrenade(selectedGrenade);
    if (input.takeCycle()) selectedGrenade = selectedGrenade === 'he' ? 'flash' : 'he';
    const scoped = input.state.rmb && weapon.state.name === 'longbow';
    weapon.setScoped(scoped);
    const fov = scoped ? 40 : 74;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    let digit = '';
    for (const code of DIGIT_CODES) {
      if (input.state.keys.has(code)) { digit = code; break; }
    }
    if (digit && digit !== lastDigit && rounds.phase === 'live') {
      if (digit === 'Digit1') weapon.select('p9');
      else if (digit === 'Digit2' && rounds.hasWeapon('vk9')) weapon.select('vk9');
      else if (digit === 'Digit3' && rounds.hasWeapon('wasp9')) weapon.select('wasp9');
      else if (digit === 'Digit4') throwGrenade('he');
      else if (digit === 'Digit5') throwGrenade('flash');
    }
    lastDigit = digit;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function placeBot(bot, x, z) {
  bot.pos.set(x, 0, z);
  bot.state = 'hold';
  bot.engage = 'player';
  bot.seen = true;
  // Staged bots face the player but must not fire during the settle: with
  // reactT 0 they land ~3 burst shots in 20 steps and kill the player, so
  // the ?shot=play capture showed 0 HP. A still cannot show a burst anyway.
  bot.reactT = 999;
  bot.burstLeft = 4;
  bot.pauseT = 0;
  bot.aimPos.set(player.state.position.x, 1.25, player.state.position.z);
  bot.yaw = Math.atan2(-(player.state.position.x - x), -(player.state.position.z - z));
  bot.holdYaw = bot.yaw;
}

function runShot(name) {
  hud.hideOverlay();
  rounds.resetMatch();
  bots.reset(1);
  objective.reset();
  player.reset(world.spawns.vanguard[2]);
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start');
  } else if (name === 'play') {
    rounds.money = 5000;
    rounds.startBuyPhase();
    rounds.buy('1');
    rounds.startRound();
    const sents = bots.list.filter((b) => b.team === 'sentinel');
    placeBot(sents[0], 1.5, -2);
    placeBot(sents[1], -2.5, -7);
    settle(20);
    aimAt(botChest(sents[0]));
    shoot(0);
    settle(8);
    aimAt(botChest(sents[0]));
    shoot(0);
    settle(8);
    aimAt(botChest(sents[1]));
    shoot(0);
    settle(1);
  } else if (name === 'site') {
    rounds.startBuyPhase();
    rounds.startRound();
    player.reset(new THREE.Vector3(-15, 0, -10));
    const sent = bots.list.find((b) => b.team === 'sentinel');
    placeBot(sent, -12, -6);
    for (let i = 0; i < 20; i += 1) {
      objective.tryPlant();
      step(FIXED_STEP);
    }
    aimAt(botChest(sent));
    // Poke the progress after the last step: objective.step consumes the
    // plant hold each step, so an earlier poke would be reset to 'carried'.
    objective.plantProgress = 0.55;
  } else if (name === 'end') {
    rounds.startBuyPhase();
    rounds.startRound();
    rounds.endRound('vanguard', 'detonation');
    player.reset(world.spawns.vanguard[2]);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
  } else {
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
