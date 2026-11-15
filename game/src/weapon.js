// The weapon set: four hitscan guns, one view model each. This module owns the
// numbers, the magazine, the reload, the bloom and the kick; main.js owns the ray
// and the damage. Ammo is kept per weapon, so switching keeps what you had.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MOVE_REFERENCE = 5.2;
const SPREAD_MOVING = 0.028;
const BLOOM_STEP = 0.0015;
const BLOOM_MAX = 0.012;
const BLOOM_DECAY = 0.02;
const MUZZLE_TIME = 0.06;

const DEFS = {
  p9: { label: 'P9 Sidearm', damage: 34, gap: 0.16, reloadTime: 1.4, magSize: 12, reserveMax: 36, spreadStill: 0.003, auto: false, kick: 0.05 },
  vk9: { label: 'VK-9 Jackal', damage: 34, gap: 0.096, reloadTime: 1.9, magSize: 30, reserveMax: 90, spreadStill: 0.0022, auto: true, kick: 0.055 },
  wasp9: { label: 'Wasp-9 SMG', damage: 26, gap: 0.07, reloadTime: 1.7, magSize: 32, reserveMax: 96, spreadStill: 0.006, auto: true, kick: 0.04 },
  longbow: { label: 'Longbow DMR', damage: 80, gap: 0.9, reloadTime: 2.6, magSize: 10, reserveMax: 30, spreadStill: 0.0008, auto: false, kick: 0.09 },
};
const ALIASES = {
  p9: 'p9', sidearm: 'p9', pistol: 'p9',
  vk9: 'vk9', jackal: 'vk9', rifle: 'vk9',
  wasp9: 'wasp9', wasp: 'wasp9', smg: 'wasp9',
  longbow: 'longbow', dmr: 'longbow',
};

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });

  function part(group, w, h, d, mat, x, y, z, rx = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    group.add(mesh);
    return mesh;
  }

  function build(kind) {
    const model = new THREE.Group();
    if (kind === 'p9') {
      part(model, 0.05, 0.06, 0.24, body, 0, 0.01, -0.08);
      part(model, 0.045, 0.13, 0.07, grip, 0, -0.07, 0.03, 0.25);
      part(model, 0.02, 0.02, 0.03, dark, 0, 0.05, -0.18);
    } else if (kind === 'vk9') {
      part(model, 0.09, 0.1, 0.42, body, 0, 0, 0);
      part(model, 0.045, 0.045, 0.4, grip, 0, 0.025, -0.38);
      part(model, 0.075, 0.08, 0.22, grip, 0, -0.02, 0.3);
      part(model, 0.05, 0.15, 0.08, dark, 0, -0.11, -0.02);
    } else if (kind === 'wasp9') {
      part(model, 0.1, 0.11, 0.3, body, 0, 0, 0);
      part(model, 0.06, 0.06, 0.28, dark, 0, 0.01, -0.28);
      part(model, 0.05, 0.13, 0.05, grip, 0, -0.11, -0.16);
      part(model, 0.05, 0.17, 0.07, dark, 0, -0.12, 0.04);
    } else {
      part(model, 0.07, 0.09, 0.4, body, 0, 0, 0);
      part(model, 0.035, 0.035, 0.62, grip, 0, 0.02, -0.5);
      part(model, 0.05, 0.06, 0.22, dark, 0, 0.09, -0.05);
      part(model, 0.06, 0.07, 0.26, grip, 0, -0.01, 0.3);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = { p9: build('p9'), vk9: build('vk9'), wasp9: build('wasp9'), longbow: build('longbow') };
  const ammo = {};
  for (const key of Object.keys(DEFS)) {
    ammo[key] = { mag: DEFS[key].magSize, reserve: DEFS[key].reserveMax, cooldown: 0, reloadLeft: 0 };
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = { flash: 0, kick: 0, bloom: 0, scoped: false, name: 'p9' };
  for (const key of ['mag', 'reserve', 'cooldown', 'reloadLeft']) {
    Object.defineProperty(state, key, {
      enumerable: true,
      get() { return ammo[state.name][key]; },
      set(v) { ammo[state.name][key] = v; },
    });
  }
  models.p9.visible = true;
  let sinceShot = 99;

  function step(dt) {
    sinceShot += dt;
    if (sinceShot > 0.12 && state.bloom > 0) state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
    const cur = ammo[state.name];
    const def = DEFS[state.name];
    const model = models[state.name];
    cur.cooldown = Math.max(0, cur.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (cur.reloadLeft > 0) {
      cur.reloadLeft = Math.max(0, cur.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - cur.reloadLeft) * 2);
      if (cur.reloadLeft === 0) {
        const take = Math.min(def.magSize - cur.mag, cur.reserve);
        cur.mag += take;
        cur.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    get current() {
      const def = DEFS[state.name];
      const cur = ammo[state.name];
      return { name: state.name, label: def.label, damage: def.damage, gap: def.gap, reloadTime: def.reloadTime, magSize: def.magSize, auto: def.auto, mag: cur.mag, reserve: cur.reserve, scoped: state.scoped };
    },
    ready() {
      const cur = ammo[state.name];
      return cur.mag > 0 && cur.cooldown === 0 && cur.reloadLeft === 0;
    },
    pullTrigger() {
      const def = DEFS[state.name];
      ammo[state.name].cooldown = def.gap;
      state.flash = MUZZLE_TIME;
      state.kick = def.kick;
      state.bloom = Math.min(BLOOM_MAX, state.bloom + BLOOM_STEP);
      sinceShot = 0;
    },
    takeRound() {
      const cur = ammo[state.name];
      if (cur.mag <= 0) return false;
      cur.mag -= 1;
      return true;
    },
    reload() {
      const cur = ammo[state.name];
      const def = DEFS[state.name];
      if (cur.reloadLeft > 0 || cur.mag === def.magSize || cur.reserve === 0) return;
      cur.reloadLeft = def.reloadTime;
    },
    spread(speed, bloom) {
      const def = DEFS[state.name];
      const b = bloom === undefined ? state.bloom : bloom;
      let s = def.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * SPREAD_MOVING + b;
      if (state.scoped && state.name === 'longbow') s *= 0.5;
      return s;
    },
    select(name) {
      const key = ALIASES[String(name).toLowerCase().replace(/[^a-z0-9]/g, '')];
      if (!key || key === state.name) return !!key;
      models[state.name].visible = false;
      state.name = key;
      state.kick = 0;
      state.flash = 0;
      state.scoped = false;
      models[key].visible = true;
      return true;
    },
    setScoped(on) {
      state.scoped = !!on;
      if (state.name === 'longbow') models.longbow.visible = !state.scoped;
    },
    refill() {
      const cur = ammo[state.name];
      const def = DEFS[state.name];
      cur.mag = def.magSize;
      cur.reserve = def.reserveMax;
      cur.cooldown = 0;
      cur.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
