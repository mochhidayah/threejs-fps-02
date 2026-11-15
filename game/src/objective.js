// The bomb: carried by the player, dropped on death, fetched and planted by a
// friendly bot, defused by a Sentinel. Plant 3 s, defuse 5 s, fuse 35 s. The
// carrier bot and the defuser are driven here; bots.js only walks them into place.
// tryPlant/tryDefuse are called every step while E is held (main.js); the step
// consumes that hold, so letting go of E cancels the progress.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const FUSE_TIME = 35;
const SITE_RADIUS = 3.5;
const FALLBACK_SITES = { A: { x: -15, z: -10 }, B: { x: 15, z: 10 } };

export function createObjective(scene, world) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.4 }),
  );
  body.position.y = 0.11;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
  bulb.position.y = 0.32;
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  light.position.y = 0.32;
  group.add(body, bulb, light);
  group.visible = false;
  scene.add(group);

  const pos = new THREE.Vector3();
  const evPlant = new THREE.Vector3();
  const evBoom = new THREE.Vector3();
  let lastCtx = null;
  let plantHeld = false;
  let beepT = 0;
  let blinkT = 0;
  let bulbOn = true;
  let ended = false;

  const obj = {
    state: 'carried',
    carrier: 'player',
    plantProgress: 0,
    defuseProgress: 0,
    fuseLeft: FUSE_TIME,
    pos,
    reset() {
      obj.state = 'carried';
      obj.carrier = 'player';
      obj.plantProgress = 0;
      obj.defuseProgress = 0;
      obj.fuseLeft = FUSE_TIME;
      group.visible = false;
      light.intensity = 0;
      bulb.visible = true;
      beepT = 0;
      blinkT = 0;
      bulbOn = true;
      ended = false;
      plantHeld = false;
    },
    drop(p) {
      if (obj.state === 'detonated' || obj.state === 'defused') return;
      pos.copy(p);
      obj.state = 'dropped';
      obj.carrier = null;
      obj.plantProgress = 0;
      group.position.set(pos.x, 0, pos.z);
      group.visible = true;
    },
    pickup(bot) {
      if (obj.state !== 'dropped' || !bot || !bot.alive) return false;
      obj.carrier = bot;
      obj.state = 'carried';
      group.visible = false;
      bot.carrying = true;
      bot.atBomb = false;
      bot.site = nearestSite(bot.pos.x, bot.pos.z);
      bot.state = 'push';
      return true;
    },
    tryPlant() {
      plantHeld = true;
      if ((obj.state !== 'carried' && obj.state !== 'planting') || obj.carrier !== 'player') return false;
      if (!lastCtx || !inSite(playerPos(lastCtx))) return false;
      if (obj.state === 'carried') obj.state = 'planting';
      return true;
    },
    tryDefuse() {
      // Only Sentinels defuse, and the player is a Vanguard; bot defuses run in step().
      return false;
    },
    step(dt, ctx) {
      lastCtx = ctx;
      const audio = ctx.audio;
      if ((obj.state === 'carried' || obj.state === 'planting') && obj.carrier !== 'player' && obj.carrier && !obj.carrier.alive) {
        obj.drop(obj.carrier.pos);
      } else if ((obj.state === 'carried' || obj.state === 'planting') && obj.carrier === 'player' && !playerAlive(ctx)) {
        const pp = playerPos(ctx);
        if (pp) obj.drop(pp);
      }
      if (obj.state === 'carried' && obj.carrier && obj.carrier !== 'player' && obj.carrier.state === 'plant' && carrierInSite(ctx)) {
        obj.state = 'planting';
      }
      if (obj.state === 'planting') {
        const botCarrier = obj.carrier && obj.carrier !== 'player';
        const held = botCarrier ? obj.carrier.state === 'plant' : plantHeld;
        if (!held || !carrierInSite(ctx)) {
          obj.state = 'carried';
          obj.plantProgress = 0;
        } else {
          obj.plantProgress += dt / PLANT_TIME;
          if (obj.plantProgress >= 1) {
            obj.plantProgress = 1;
            obj.state = 'planted';
            obj.fuseLeft = FUSE_TIME;
            pos.copy(carrierPos(ctx));
            group.position.set(pos.x, 0, pos.z);
            group.visible = true;
            if (botCarrier) obj.carrier.state = 'hold';
            if (audio) audio.plant();
            if (ctx.events) ctx.events.push({ type: 'plant', pos: evPlant.copy(pos), radius: 60, team: 'vanguard' });
          }
        }
        plantHeld = false;
      } else if (obj.state === 'planted' || obj.state === 'defusing') {
        obj.fuseLeft -= dt;
        const interval = 0.25 + Math.max(0, obj.fuseLeft / FUSE_TIME) * 0.75;
        beepT -= dt;
        if (beepT <= 0) { beepT = interval; if (audio) audio.beep(); }
        blinkT -= dt;
        if (blinkT <= 0) {
          blinkT = interval * 0.5;
          bulbOn = !bulbOn;
          light.intensity = bulbOn ? 6 : 0;
          bulb.visible = bulbOn;
        }
        const defuser = defuserInSite(ctx);
        if (defuser) {
          obj.state = 'defusing';
          obj.defuseProgress += dt / DEFUSE_TIME;
          if (obj.defuseProgress >= 1) {
            obj.defuseProgress = 1;
            obj.state = 'defused';
            group.visible = false;
            endRound(ctx, 'sentinel', 'defused');
          }
        } else if (obj.state === 'defusing') {
          obj.state = 'planted';
          obj.defuseProgress = 0;
        }
        if (obj.state !== 'defused' && obj.fuseLeft <= 0) {
          obj.state = 'detonated';
          group.visible = false;
          if (audio) audio.explosion();
          if (ctx.events) ctx.events.push({ type: 'explosion', pos: evBoom.copy(pos), radius: 60, team: 'vanguard' });
          endRound(ctx, 'vanguard', 'detonation');
        }
      } else if (obj.state === 'dropped') {
        blinkT -= dt;
        if (blinkT <= 0) {
          blinkT = 0.5;
          bulbOn = !bulbOn;
          light.intensity = bulbOn ? 3 : 0;
          bulb.visible = bulbOn;
        }
        if (ctx.bots) {
          for (const b of ctx.bots) {
            if (b.team === 'vanguard' && b.alive && b.state === 'fetchBomb') {
              const dx = b.pos.x - pos.x;
              const dz = b.pos.z - pos.z;
              if (dx * dx + dz * dz < 1.44) { obj.pickup(b); break; }
            }
          }
        }
      }
    },
  };

  function endRound(ctx, winner, reason) {
    if (ended) return;
    ended = true;
    if (ctx.onRoundEnd) ctx.onRoundEnd(winner, reason);
  }

  const fallbackSites = {
    A: { center: new THREE.Vector3(FALLBACK_SITES.A.x, 0, FALLBACK_SITES.A.z), radius: SITE_RADIUS },
    B: { center: new THREE.Vector3(FALLBACK_SITES.B.x, 0, FALLBACK_SITES.B.z), radius: SITE_RADIUS },
  };

  function siteList() {
    return world.sites || fallbackSites;
  }

  function inSite(p) {
    if (!p) return false;
    const sites = siteList();
    for (const key of ['A', 'B']) {
      const s = sites[key];
      if (!s) continue;
      const c = s.center;
      const r = s.radius || SITE_RADIUS;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      if (dx * dx + dz * dz <= r * r) return true;
    }
    return false;
  }

  function nearestSite(x, z) {
    const sites = siteList();
    let best = 'A';
    let bd = Infinity;
    for (const key of ['A', 'B']) {
      const s = sites[key];
      if (!s) continue;
      const dx = x - s.center.x;
      const dz = z - s.center.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = key; }
    }
    return best;
  }

  function playerPos(ctx) {
    if (!ctx.player) return null;
    const s = ctx.player.state || ctx.player;
    return s.position || null;
  }

  function playerAlive(ctx) {
    if (!ctx.player) return true;
    const s = ctx.player.state || ctx.player;
    return s.alive === undefined ? true : !!s.alive;
  }

  function carrierPos(ctx) {
    if (obj.carrier === 'player') return playerPos(ctx) || pos;
    return obj.carrier ? obj.carrier.pos : pos;
  }

  function carrierInSite(ctx) {
    return inSite(carrierPos(ctx));
  }

  function defuserInSite(ctx) {
    if (!ctx.bots || !inSite(pos)) return null;
    for (const b of ctx.bots) {
      if (b.team === 'sentinel' && b.alive && b.state === 'defuse' && inSite(b.pos)) return b;
    }
    return null;
  }

  return obj;
}
