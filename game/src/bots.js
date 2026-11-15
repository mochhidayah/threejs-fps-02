// 9 bots, 5v5: 4 Vanguard friendlies + 5 Sentinel enemies. Each bot is a small
// box-and-sphere body that walks waypoint routes, holds lanes, rotates on sound,
// fetches a dropped bomb, plants, or defuses. Combat is burst fire through the
// bot's own raycaster against the player's hit meshes (or an enemy bot's) with
// world.shootables blocking. No allocation in the hot loop: shared temps only.
// Assumptions on the world contract (GAME_DESIGN.md): world.moveBox(pos, halfX,
// halfZ, height) returns true when the box overlaps a collider; world.losClear(a, b)
// is true when nothing blocks the segment. Both have a local fallback below.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const SENTINEL = PALETTE.sentinel;
const BOT_DMG = 34;
const VIEW_DIST = 40;
const FOV_COS = Math.cos((100 * Math.PI) / 360);
const EYE_Y = 1.55;
const RADIUS = 0.34;
const HEIGHT = 1.72;
const FALL_TIME = 0.4;
const NAMES = { vanguard: ['Ash', 'Bramble', 'Cinder', 'Dusk'], sentinel: ['Flint', 'Gage', 'Harrow', 'Ivo', 'Jett'] };
const FALLBACK_SITES = { A: { x: -15, z: -10 }, B: { x: 15, z: 10 } };
const FALLBACK_SPAWNS = {
  vanguard: [[-4, 13], [0, 13], [4, 13], [-2, 13]],
  sentinel: [[-6, -13], [0, -13], [6, -13], [-3, -13], [3, -13]],
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const _site = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _box = new THREE.Box3();

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

function turnToward(cur, target, max) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > max) return cur + max;
  if (d < -max) return cur - max;
  return target;
}

export function createBots(scene, world, audio) {
  const rng0 = mulberry32(0x1b07);
  const list = [];
  const hitMeshes = [];

  function losClear(a, b) {
    if (world.losClear) return world.losClear(a, b);
    _d.copy(b).sub(a);
    const dist = _d.length();
    if (dist < 0.001) return true;
    _ray.set(a, _d.multiplyScalar(1 / dist));
    _ray.far = dist;
    return _ray.intersectObjects(world.shootables, false).length === 0;
  }

  function blocked(x, y, z) {
    if (world.moveBox) return world.moveBox(_b.set(x, y, z), RADIUS, RADIUS, HEIGHT);
    _box.min.set(x - RADIUS, y + 0.04, z - RADIUS);
    _box.max.set(x + RADIUS, y + HEIGHT - 0.04, z + RADIUS);
    for (const c of world.colliders) if (_box.intersectsBox(c)) return true;
    return false;
  }

  function siteCenter(site, out) {
    const s = world.sites && world.sites[site];
    if (s) return out.copy(s.center);
    const f = FALLBACK_SITES[site];
    return out.set(f.x, 0, f.z);
  }

  function nearestWp(x, z) {
    const wps = world.waypoints;
    if (!wps || !wps.length) return null;
    let best = null;
    let bd = Infinity;
    for (const w of wps) {
      const dx = w.x - x;
      const dz = w.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  // BFS over the waypoint graph; returns [{x,z}...] or null. Runs on assignment only.
  function route(from, to) {
    const wps = world.waypoints;
    if (!wps || !wps.length || !from || !to) return null;
    const byId = new Map();
    for (const w of wps) byId.set(w.id, w);
    const prev = new Map();
    const q = [from.id];
    prev.set(from.id, null);
    while (q.length) {
      const id = q.shift();
      if (id === to.id) break;
      const w = byId.get(id);
      if (!w) continue;
      for (const n of (w.links || [])) {
        if (!prev.has(n)) { prev.set(n, id); q.push(n); }
      }
    }
    if (!prev.has(to.id)) return null;
    const ids = [];
    let cur = to.id;
    while (cur !== null) { ids.push(cur); cur = prev.get(cur); }
    ids.reverse();
    return ids.map((id) => ({ x: byId.get(id).x, z: byId.get(id).z }));
  }

  function setPath(bot, tx, tz) {
    // Route through the waypoint graph, then always finish on the exact target:
    // without this a target that shares its nearest node with the bot (e.g. a
    // dropped bomb near spawn) collapses the route to a node metres away.
    const r = route(nearestWp(bot.pos.x, bot.pos.z), nearestWp(tx, tz));
    bot.path = r || [];
    bot.path.push({ x: tx, z: tz });
    bot.pathI = 0;
  }

  function makeBot(team, name) {
    const accent = team === 'vanguard' ? PALETTE.accent : SENTINEL;
    const group = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), roughness: 0.8, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.85 });
    const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
    function part(w, h, dpt, mat, x, y, z, partName) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dpt), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.userData.part = partName;
      group.add(mesh);
      return mesh;
    }
    const torso = part(0.56, 0.66, 0.32, torsoMat, 0, 1.12, 0, 'torso');
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), headMat);
    head.position.set(0, 1.58, 0);
    head.castShadow = true;
    head.userData.part = 'head';
    group.add(head);
    const legL = part(0.2, 0.78, 0.24, darkMat, -0.14, 0.39, 0, 'legs');
    const legR = part(0.2, 0.78, 0.24, darkMat, 0.14, 0.39, 0, 'legs');
    const gun = part(0.07, 0.09, 0.55, gunMat, 0.2, 1.15, -0.35, 'gun');
    gun.userData.part = '';
    scene.add(group);
    const bot = {
      team, name, group, gun, head, torso, legL, legR,
      pos: group.position, yaw: 0, hp: 100, alive: true,
      state: 'push', site: 'A', speed: 3.4 + rng0() * 0.8,
      path: [], pathI: 0, holdYaw: 0, moving: false, walkPhase: rng0() * 6,
      scanT: rng0() * 0.12, seen: false, reactT: 0, engage: null, aimHead: false,
      aimPos: new THREE.Vector3(), burstLeft: 0, burstT: 0, pauseT: 0,
      crouching: false, crouchK: 0, crouchT: 2 + rng0() * 4,
      deathT: 0, carrying: false, atBomb: false, blindUntil: 0,
      lastHeard: new THREE.Vector3(), eventPos: new THREE.Vector3(),
      meshes: [torso, head, legL, legR],
    };
    for (const m of bot.meshes) m.userData.bot = bot;
    return bot;
  }

  for (const name of NAMES.vanguard) list.push(makeBot('vanguard', name));
  for (const name of NAMES.sentinel) list.push(makeBot('sentinel', name));
  for (const b of list) for (const m of b.meshes) hitMeshes.push(m);

  function reset(round) {
    const rng = mulberry32(0xb07 + round * 7919);
    const v = list.filter((b) => b.team === 'vanguard');
    const s = list.filter((b) => b.team === 'sentinel');
    for (const arr of [v, s]) {
      for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
    }
    v.forEach((b, i) => { b.site = i < 2 ? 'A' : 'B'; });
    s.forEach((b, i) => { b.site = i < 3 ? 'A' : 'B'; });
    for (const b of list) {
      const spawns = (world.spawns && world.spawns[b.team]) || FALLBACK_SPAWNS[b.team];
      const sp = spawns[list.indexOf(b) % spawns.length];
      const sx = sp.x !== undefined ? sp.x : sp[0];
      const sz = sp.z !== undefined ? sp.z : sp[1];
      b.pos.set(sx + (rng() - 0.5), 0, sz + (rng() - 0.5));
      b.hp = 100;
      b.alive = true;
      b.state = 'push';
      b.carrying = false;
      b.atBomb = false;
      b.engage = null;
      b.seen = false;
      b.reactT = 0;
      b.burstLeft = 0;
      b.pauseT = 0;
      b.deathT = 0;
      b.blindUntil = 0;
      b.crouchK = 0;
      b.crouching = false;
      groupReset(b);
      b.yaw = Math.atan2(-(0 - b.pos.x), -(0 - b.pos.z));
      b.holdYaw = b.yaw;
      siteCenter(b.site, _site);
      setPath(b, _site.x, _site.z);
    }
  }

  function groupReset(b) {
    b.group.rotation.set(0, b.yaw, 0);
    b.group.visible = true;
  }

  function canSee(bot, tx, ty, tz) {
    const dx = tx - bot.pos.x;
    const dy = ty - (bot.pos.y + EYE_Y);
    const dz = tz - bot.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > VIEW_DIST * VIEW_DIST) return false;
    const d = Math.sqrt(d2) || 1;
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    if ((dx * fx + dz * fz) / d < FOV_COS) return false;
    _a.set(bot.pos.x, bot.pos.y + EYE_Y, bot.pos.z);
    _b.set(tx, ty, tz);
    return losClear(_a, _b);
  }

  function scan(bot, ctx, rng) {
    bot.engage = null;
    if (ctx.time !== undefined && ctx.time < bot.blindUntil) { bot.seen = false; return; }
    if (bot.team === 'sentinel' && ctx.playerAlive && ctx.playerPos) {
      const py = ctx.playerPos.y + (bot.aimHead ? 1.58 : 1.25);
      if (canSee(bot, ctx.playerPos.x, py, ctx.playerPos.z)) {
        bot.engage = 'player';
        bot.aimPos.set(ctx.playerPos.x, py, ctx.playerPos.z);
      }
    }
    if (!bot.engage) {
      let best = null;
      let bd = Infinity;
      for (const o of list) {
        if (o === bot || o.team === bot.team || !o.alive) continue;
        const dx = o.pos.x - bot.pos.x;
        const dz = o.pos.z - bot.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= bd) continue;
        const oy = o.pos.y + 1.25;
        if (canSee(bot, o.pos.x, oy, o.pos.z)) { best = o; bd = d2; }
      }
      if (best) {
        bot.engage = best;
        bot.aimPos.set(best.pos.x, best.pos.y + (bot.aimHead ? 1.58 : 1.25), best.pos.z);
      }
    }
    if (bot.engage) {
      if (!bot.seen) {
        bot.seen = true;
        bot.reactT = 0.25 + rng() * 0.25;
        bot.aimHead = rng() < 0.1;
      }
    } else {
      bot.seen = false;
      bot.reactT = 0;
    }
  }

  function hear(bot, ctx) {
    if (!ctx.events) return;
    for (const e of ctx.events) {
      const r = e.radius || (e.type === 'shot' ? 30 : 60);
      const dx = e.pos.x - bot.pos.x;
      const dz = e.pos.z - bot.pos.z;
      if (dx * dx + dz * dz > r * r) continue;
      bot.lastHeard.copy(e.pos);
      if (bot.carrying) continue; // the carrier never abandons the plant run
      if (bot.state !== 'hold' && bot.state !== 'push') continue;
      if (e.type === 'plant' || e.type === 'explosion') {
        bot.state = 'rotate';
        setPath(bot, e.pos.x, e.pos.z);
      } else if (e.type === 'shot' && bot.team === 'sentinel') {
        const other = bot.site === 'A' ? 'B' : 'A';
        siteCenter(other, _site);
        const ox = e.pos.x - _site.x;
        const oz = e.pos.z - _site.z;
        if (ox * ox + oz * oz < 144) { bot.state = 'rotate'; setPath(bot, e.pos.x, e.pos.z); }
      }
    }
  }

  function think(bot, dt, ctx, rng) {
    bot.scanT -= dt;
    if (bot.scanT <= 0) {
      bot.scanT = 0.12;
      scan(bot, ctx, rng);
    }
    if (bot.seen && bot.reactT > 0) bot.reactT -= dt;
    if (bot.state === 'hold') {
      bot.crouchT -= dt;
      if (bot.crouchT <= 0) {
        bot.crouchT = 2 + rng() * 4;
        if (rng() < 0.5) bot.crouching = !bot.crouching;
      }
    } else {
      bot.crouching = false;
    }
    const bomb = ctx.bomb;
    const bState = bomb ? (typeof bomb === 'string' ? bomb : bomb.state) : null;
    if (bot.state === 'fetchBomb' && bState !== 'dropped') {
      bot.state = 'push';
      siteCenter(bot.site, _site);
      setPath(bot, _site.x, _site.z);
    }
  }

  function atSite(bot) {
    siteCenter(bot.site, _site);
    const dx = bot.pos.x - _site.x;
    const dz = bot.pos.z - _site.z;
    return dx * dx + dz * dz <= 12.25;
  }

  function move(bot, dt) {
    let tx = 0;
    let tz = 0;
    let moving = false;
    if (bot.state === 'push' || bot.state === 'rotate' || bot.state === 'fetchBomb' || bot.state === 'defuse') {
      const wp = bot.path[bot.pathI];
      if (wp) {
        const dx = wp.x - bot.pos.x;
        const dz = wp.z - bot.pos.z;
        if (dx * dx + dz * dz < 0.36) {
          bot.pathI += 1;
        } else {
          tx = wp.x;
          tz = wp.z;
          moving = true;
        }
      }
      if (!wp || bot.pathI >= bot.path.length) {
        if (bot.state === 'push') {
          if (bot.carrying && !atSite(bot)) {
            // Carrier with a stale/empty path (e.g. just picked the bomb up):
            // route to the assigned site instead of planting where it stands.
            siteCenter(bot.site, _site);
            setPath(bot, _site.x, _site.z);
          } else {
            bot.state = bot.carrying ? 'plant' : 'hold';
            bot.holdYaw = Math.atan2(-(0 - bot.pos.x), -(0 - bot.pos.z));
          }
        } else if (bot.state === 'rotate') {
          bot.state = 'hold';
          bot.holdYaw = bot.yaw;
        } else if (bot.state === 'fetchBomb') {
          bot.atBomb = true;
        }
      }
    }
    if (moving) {
      const dx = tx - bot.pos.x;
      const dz = tz - bot.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = bot.engage ? bot.speed * 0.55 : bot.speed;
      const vx = (dx / d) * sp * dt;
      const vz = (dz / d) * sp * dt;
      if (!bot.engage) bot.yaw = turnToward(bot.yaw, Math.atan2(-dx, -dz), dt * 6);
      const nx = bot.pos.x + vx;
      if (!blocked(nx, bot.pos.y, bot.pos.z)) bot.pos.x = nx;
      const nz = bot.pos.z + vz;
      if (!blocked(bot.pos.x, bot.pos.y, nz)) bot.pos.z = nz;
      bot.moving = true;
      bot.walkPhase += dt * sp * 2.2;
    } else {
      bot.moving = false;
    }
    if (bot.state === 'hold' && !bot.engage) bot.yaw = turnToward(bot.yaw, bot.holdYaw, dt * 2);
  }

  function shootBot(bot, ctx, rng) {
    const targets = bot.engage === 'player' ? ctx.playerHitMeshes : bot.engage.meshes;
    if (!targets || !targets.length) return;
    _m.set(bot.pos.x, bot.pos.y + 1.35, bot.pos.z);
    const dx = bot.aimPos.x - _m.x;
    const dy = bot.aimPos.y - _m.y;
    const dz = bot.aimPos.z - _m.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const tgtSpeed = bot.engage === 'player' ? (ctx.playerSpeed || 0) : bot.engage.speed;
    const ownMove = bot.moving ? bot.speed : 0;
    const err = 0.012 + dist * 0.0009 + tgtSpeed * 0.0012 + ownMove * 0.004;
    _d.set(dx / dist + (rng() * 2 - 1) * err, dy / dist + (rng() * 2 - 1) * err, dz / dist + (rng() * 2 - 1) * err).normalize();
    _ray.set(_m, _d);
    _ray.far = 60;
    const hitT = _ray.intersectObjects(targets, false)[0];
    const hitW = _ray.intersectObjects(world.shootables, false)[0];
    if (hitT && (!hitW || hitT.distance < hitW.distance)) {
      const part = hitT.object.userData.part || 'torso';
      const mult = part === 'head' ? 2 : part === 'legs' ? 0.75 : 1;
      const dmg = BOT_DMG * mult;
      if (bot.engage === 'player') {
        if (ctx.onPlayerDamaged) ctx.onPlayerDamaged(dmg, part, bot.pos);
      } else {
        const killed = damage(bot.engage, dmg, part);
        if (killed && ctx.onBotKilled) ctx.onBotKilled(bot.engage, bot);
      }
    }
    if (audio && ctx.playerPos && _m.distanceToSquared(ctx.playerPos) < 2025) audio.shot('rifle');
    if (ctx.events) {
      bot.eventPos.copy(_m);
      ctx.events.push({ type: 'shot', pos: bot.eventPos, radius: 30, team: bot.team });
    }
  }

  function combat(bot, dt, ctx, rng) {
    if (ctx.time !== undefined && ctx.time < bot.blindUntil) { bot.burstLeft = 0; return; }
    if (!bot.engage || !bot.seen || bot.reactT > 0) {
      bot.burstLeft = 0;
      return;
    }
    bot.yaw = turnToward(bot.yaw, Math.atan2(-(bot.aimPos.x - bot.pos.x), -(bot.aimPos.z - bot.pos.z)), dt * 6);
    if (bot.pauseT > 0) {
      bot.pauseT -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(rng() * 3);
      bot.burstT = 0;
    }
    bot.burstT -= dt;
    if (bot.burstT > 0) return;
    bot.burstT = 0.096 + rng() * 0.03;
    bot.burstLeft -= 1;
    shootBot(bot, ctx, rng);
    if (bot.burstLeft <= 0) bot.pauseT = 0.4 + rng() * 0.5;
  }

  function animate(bot, dt) {
    if (!bot.alive) {
      bot.deathT += dt;
      const k = Math.min(1, bot.deathT / FALL_TIME);
      bot.group.rotation.x = -1.45 * k;
      return;
    }
    bot.group.rotation.y = bot.yaw;
    const target = bot.crouching ? 1 : 0;
    bot.crouchK += (target - bot.crouchK) * Math.min(1, dt * 6);
    const drop = 0.32 * bot.crouchK;
    bot.torso.position.y = 1.12 - drop;
    bot.head.position.y = 1.58 - drop;
    bot.gun.position.y = 1.15 - drop;
    const swing = bot.moving ? Math.sin(bot.walkPhase) * 0.5 : 0;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
  }

  function damage(bot, amount, part) {
    if (!bot || !bot.alive) return false;
    void part; // multipliers (head x2, legs x0.75) are applied by the caller
    bot.hp -= amount;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.engage = null;
      bot.carrying = false;
      bot.deathT = 0;
      return true;
    }
    return false;
  }

  function step(dt, ctx) {
    const rng = ctx.rng || Math.random;
    const bomb = ctx.bomb;
    const bState = bomb ? (typeof bomb === 'string' ? bomb : bomb.state) : null;
    const bPos = bomb && typeof bomb === 'object' ? (bomb.pos || ctx.bombPos || null) : (ctx.bombPos || null);
    if (bState === 'dropped' && bPos) {
      let fetching = false;
      let best = null;
      let bd = Infinity;
      for (const b of list) {
        if (!b.alive || b.team !== 'vanguard') continue;
        if (b.state === 'fetchBomb') { fetching = true; break; }
        if (b.state === 'push' || b.state === 'hold' || b.state === 'rotate') {
          const dx = b.pos.x - bPos.x;
          const dz = b.pos.z - bPos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = b; }
        }
      }
      if (!fetching && best) {
        best.state = 'fetchBomb';
        best.atBomb = false;
        setPath(best, bPos.x, bPos.z);
      }
    }
    if (bState === 'planted' && bPos) {
      let defusing = false;
      let best = null;
      let bd = Infinity;
      for (const b of list) {
        if (!b.alive || b.team !== 'sentinel') continue;
        if (b.state === 'defuse') { defusing = true; break; }
        if (b.state === 'push' || b.state === 'hold' || b.state === 'rotate') {
          const dx = b.pos.x - bPos.x;
          const dz = b.pos.z - bPos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = b; }
        }
      }
      if (!defusing && best) {
        best.state = 'defuse';
        setPath(best, bPos.x, bPos.z);
      }
    }
    for (const b of list) if (b.alive) hear(b, ctx);
    for (const b of list) {
      if (!b.alive) { animate(b, dt); continue; }
      think(b, dt, ctx, rng);
      move(b, dt);
      combat(b, dt, ctx, rng);
      animate(b, dt);
    }
  }

  return {
    list,
    hitMeshes,
    step,
    damage,
    blind(bot, seconds, now) {
      if (bot && bot.alive) bot.blindUntil = Math.max(bot.blindUntil || 0, now + seconds);
    },
    reset,
    aliveCount(team) {
      let n = 0;
      for (const b of list) if (b.team === team && b.alive) n += 1;
      return n;
    },
  };
}
