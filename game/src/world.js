// The map: Ironbound Yard, a 44 x 32 m industrial yard with two bomb sites, three
// lanes and scattered cover. Every box is a collider for movement and a surface a
// bullet stops on. Plain geometry only, no models and no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and outer walls: 44 x 32 m, 4.6 m walls, open to the sky.
  box(44.4, 0.4, 32.4, 0, -0.2, 0, 'canvas');
  box(0.4, 4.6, 32.4, -22.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 32.4, 22.2, 2.3, 0, 'surface');
  box(44.4, 4.6, 0.4, 0, 2.3, -16.2, 'surface');
  box(44.4, 4.6, 0.4, 0, 2.3, 16.2, 'surface');

  // Cover: [width, height, depth, x, z, material]. y sits the box on the floor.
  // Lanes stay clear: mid x ~ 0, west x ~ -16, east x ~ +16.
  const cover = [
    // Site A Foundry (NW): furnace block, container, wall, crates.
    [3.0, 3.4, 2.2, -19.5, -13.5, 'hairline'],
    [4.8, 2.6, 2.4, -11.0, -14.0, 'surface'],
    [0.6, 2.2, 4.0, -20.0, -10.0, 'hairline'],
    [1.6, 1.1, 1.6, -18.0, -7.0, 'hairline'],
    [1.2, 1.1, 2.4, -12.0, -5.5, 'hairline'],
    // Site B Depot (SE): silo block, container, wall, crate.
    [2.2, 3.4, 2.2, 20.5, 6.5, 'hairline'],
    [4.0, 2.6, 2.0, 11.5, 14.5, 'surface'],
    [0.6, 2.2, 4.0, 19.0, 9.0, 'hairline'],
    [1.2, 1.1, 1.2, 18.0, 7.5, 'hairline'],
    // Mid walls flanking the centre lane.
    [3.0, 2.2, 0.6, -5.5, -6.0, 'hairline'],
    [3.0, 2.2, 0.6, 5.5, 6.0, 'hairline'],
    // Pillars around mid.
    [0.9, 3.0, 0.9, -7.0, 4.0, 'surface'],
    [0.9, 3.0, 0.9, 7.0, -4.0, 'surface'],
    [0.9, 3.0, 0.9, -7.0, -4.0, 'surface'],
    [0.9, 3.0, 0.9, 7.0, 4.0, 'surface'],
    // Mid-lane crates (crouch cover, north of centre, off the x = 0 line).
    [1.2, 1.1, 1.2, -2.5, -2.0, 'hairline'],
    [1.2, 1.1, 1.2, 2.5, -2.0, 'hairline'],
    // Side-lane crates (off the x = +/-16 lines).
    [1.2, 1.1, 2.4, -18.5, 4.0, 'hairline'],
    [1.2, 1.1, 1.2, -13.5, -2.0, 'hairline'],
    [1.2, 1.1, 2.4, 18.5, -4.0, 'hairline'],
    [1.2, 1.1, 1.2, 11.0, 2.0, 'hairline'],
    // Spawn cover, south (Vanguard) and north (Sentinel), tucked toward the walls.
    [1.6, 1.1, 1.6, -9.0, 13.5, 'hairline'],
    [1.6, 1.1, 1.6, 9.0, 13.5, 'hairline'],
    [1.6, 1.1, 1.6, -9.0, -13.5, 'hairline'],
    [1.6, 1.1, 1.6, 9.0, -13.5, 'hairline'],
  ];
  for (const [w, h, d, x, z, m] of cover) box(w, h, d, x, h / 2, z, m);

  // Site markers: flush accent plates (top at y = 0.01, too low to block movement).
  box(5.0, 0.03, 5.0, -15, -0.005, -10, 'accent');
  box(5.0, 0.03, 5.0, 15, -0.005, 10, 'accent');

  // Light: a warm key from the front right, a cool fill from behind, and a sky/ground gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.1);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.1);
  key.position.set(12, 16, 8);
  key.target.position.set(0, 0, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.55);
  fill.position.set(-10, 9, 12);
  scene.add(fill);

  // Bomb sites (radius 3.5 m) and spawns (x east, z south, y up).
  const sites = {
    A: { center: new THREE.Vector3(-15, 0, -10), radius: 3.5 },
    B: { center: new THREE.Vector3(15, 0, 10), radius: 3.5 },
  };
  const spawns = {
    vanguard: [-6, -3, 0, 3, 6].map((x) => new THREE.Vector3(x, 0, 13)),
    sentinel: [-6, -3, 0, 3, 6].map((x) => new THREE.Vector3(x, 0, -13)),
  };

  // Waypoint graph: spawns, lane entries, mid, both sites, hold spots.
  // Every link is a straight walkable line (no cover box crosses it).
  const waypoints = [
    { id: 1, x: 0, z: 13, links: [2, 3, 7, 8, 9] },
    { id: 2, x: -5, z: 13, links: [1, 8] },
    { id: 3, x: 5, z: 13, links: [1, 9] },
    { id: 4, x: 0, z: -13, links: [5, 6, 11, 12, 13] },
    { id: 5, x: -5, z: -13, links: [4, 12] },
    { id: 6, x: 5, z: -13, links: [4, 13] },
    { id: 7, x: 0, z: 8, links: [1, 8, 9, 10, 18, 22, 23] },
    { id: 8, x: -16, z: 8, links: [1, 2, 7, 20] },
    { id: 9, x: 16, z: 8, links: [1, 3, 7, 21] },
    { id: 10, x: 0, z: 0, links: [7, 11, 20, 21, 22, 23] },
    { id: 11, x: 0, z: -8, links: [4, 10, 12, 13, 15] },
    { id: 12, x: -16, z: -8, links: [4, 5, 11, 16, 20] },
    { id: 13, x: 16, z: -8, links: [4, 6, 11, 19, 21] },
    { id: 14, x: -15, z: -10, links: [15, 16, 24] },
    { id: 15, x: -9, z: -10, links: [11, 14, 24] },
    { id: 16, x: -15, z: -5, links: [12, 14, 20] },
    { id: 17, x: 15, z: 10, links: [18, 19, 25, 26] },
    { id: 18, x: 9, z: 10, links: [7, 17, 21, 26] },
    { id: 19, x: 15, z: 5, links: [13, 17, 21] },
    { id: 20, x: -16, z: 0, links: [8, 10, 12, 16] },
    { id: 21, x: 16, z: 0, links: [9, 10, 13, 18, 19] },
    { id: 22, x: -4, z: 0, links: [7, 10] },
    { id: 23, x: 4, z: 0, links: [7, 10] },
    { id: 24, x: -10, z: -12, links: [14, 15] },
    { id: 25, x: 19, z: 13, links: [17] },
    { id: 26, x: 11, z: 13, links: [17, 18] },
  ];

  // Reused temporaries: no allocation in the hot paths.
  const probe = new THREE.Box3();
  const rayDir = new THREE.Vector3();

  // True when an AABB (feet at pos, half extents, height) overlaps any collider.
  // The probe base is lifted 0.02 m: the floor box tops out exactly at y = 0,
  // and Box3 treats a touch as an overlap, so without the lift every ground
  // position reads as blocked (bots could never move). Walls and crates all
  // rise well above 0.02, so they still block; the flush site plates (top
  // y = 0.01) stay walkable, as intended.
  function moveBox(pos, halfX, halfZ, height) {
    probe.min.set(pos.x - halfX, pos.y + 0.02, pos.z - halfZ);
    probe.max.set(pos.x + halfX, pos.y + height, pos.z + halfZ);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  // True when the segment a -> b touches no collider (slab test, no raycast).
  function losClear(a, b) {
    rayDir.subVectors(b, a);
    for (const c of colliders) {
      let t0 = 0;
      let t1 = 1;
      let blocked = true;
      for (let i = 0; i < 3; i += 1) {
        const d = rayDir.getComponent(i);
        const o = a.getComponent(i);
        const mn = c.min.getComponent(i);
        const mx = c.max.getComponent(i);
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) { blocked = false; break; }
        } else {
          let ta = (mn - o) / d;
          let tb = (mx - o) / d;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) { blocked = false; break; }
        }
      }
      if (blocked) return false;
    }
    return true;
  }

  return { colliders, shootables, group, sites, spawns, waypoints, moveBox, losClear };
}
