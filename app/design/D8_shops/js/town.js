// The town view: the menu is the city. Layout adapted from D2 (same hexes, same roads), fewer props, no clouds, instanced tiles.
import { THREE, load, hx, SQ3, C, CSS, radial, makeRobot, run, wait, shade } from './core.js';

export const SHOPS = {
  guard:     { q: -4, r: 2,  m: 'buildings/blue/building_barracks_blue',   name: 'Guardhouse', icon: 'shield' },
  ferry:     { q: 3,  r: -2, m: 'buildings/blue/building_watermill_blue',  name: 'Ferry',      icon: 'travel' },
  hall:      { q: -2, r: -2, m: 'buildings/blue/building_castle_blue',     name: 'Town Hall',  icon: 'flag' },
  bank:      { q: 2,  r: -4, m: 'buildings/blue/building_church_blue',     name: 'Mist Bank',  icon: 'locker' },
  arena:     { q: 1,  r: 3,  m: 'buildings/blue/building_archeryrange_blue', name: 'Vault Arena', icon: 'trophy' },
  toll:      { q: -1, r: 5,  m: 'buildings/blue/building_tower_base_blue', name: 'Toll',       icon: 'link' },
  chronicle: { q: 0,  r: 0,  m: 'buildings/blue/building_tower_A_blue',    name: 'Chronicle',  icon: 'file-text' },
  house:     { q: -4, r: 0,  m: 'buildings/blue/building_home_A_blue',     name: 'Your House', icon: 'key' },
};
const ISLAND = 7, DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (q, r) => q + ',' + r, hdist = (q, r) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const tiles = new Map();
for (let q = -ISLAND; q <= ISLAND; q++) for (let r = -ISLAND; r <= ISLAND; r++) { const d = hdist(q, r); if (d > ISLAND) continue; tiles.set(key(q, r), { q, r, kind: q === 4 ? 'river' : q > 4 ? 'ghost' : (d <= 5 && q <= 3) ? 'town' : 'wild' }); }
const isTown = (q, r) => tiles.get(key(q, r))?.kind === 'town';
const bTile = new Map(); Object.entries(SHOPS).forEach(([id, s]) => bTile.set(key(s.q, s.r), id));
for (const s of Object.values(SHOPS)) { let best = null, bd = 1e9, bdir = 0; DIRS.forEach(([dq, dr], i) => { const q = s.q + dq, r = s.r + dr; if (!isTown(q, r) || bTile.has(key(q, r))) return; const d = hdist(q, r) + (i === 5 || i === 4 ? -.3 : 0); if (d < bd) { bd = d; best = [q, r]; bdir = i; } }); s.door = best; s.doorDir = bdir; }
SHOPS.chronicle.door = [0, 1]; SHOPS.chronicle.doorDir = 5;
const road = new Set(); DIRS.forEach(([dq, dr]) => road.add(key(dq, dr)));
function astar(start, goal, ok, costF) { const open = [[start, 0]], g = new Map([[key(...start), 0]]), from = new Map(); const gk = key(...goal);
  while (open.length) { open.sort((a, b) => a[1] - b[1]); const [cur] = open.shift(); const ck = key(...cur); if (ck === gk) break;
    for (const [dq, dr] of DIRS) { const n = [cur[0] + dq, cur[1] + dr], nk = key(...n); if (nk !== gk && !ok(...n)) continue; const ng = g.get(ck) + (costF ? costF(...n) : 1);
      if (!g.has(nk) || ng < g.get(nk)) { g.set(nk, ng); from.set(nk, ck); open.push([n, ng + hdist(n[0] - goal[0], n[1] - goal[1])]); } } }
  if (!from.has(gk) && gk !== key(...start)) return null; const out = [goal]; let k = gk; while (from.has(k)) { k = from.get(k); out.unshift(k.split(',').map(Number)); } return out; }
const free = (q, r) => isTown(q, r) && !bTile.has(key(q, r));
for (const [id, s] of Object.entries(SHOPS)) { if (id === 'chronicle') continue; (astar(s.door, [0, 1], free, (q, r) => road.has(key(q, r)) ? .3 : 1) || []).forEach(t => road.add(key(...t))); }
(astar([-5, 1], [0, 1], free, (q, r) => road.has(key(q, r)) ? .3 : 1) || []).forEach(t => road.add(key(...t)));
[[-6, 1], [-7, 1]].forEach(t => road.add(key(...t)));
const doorOf = new Map(); Object.entries(SHOPS).forEach(([id, s]) => doorOf.set(key(...s.door), id));
const RV = { A: [0, 3], B: [1, 3], C: [2, 3], D: [1, 3, 5], E: [0, 1, 3], F: [0, 3, 5], G: [2, 3, 4], I: [1, 2, 4, 5], J: [0, 3, 4, 5], K: [1, 2, 3, 4, 5], L: [0, 1, 2, 3, 4, 5], M: [3] };
function pickRoad(set) { let best = null, bs = -1e9; for (const [v, base] of Object.entries(RV)) for (let k = 0; k < 6; k++) { const s = new Set(base.map(d => (d + k) % 6)); let miss = 0, extra = 0; set.forEach(d => { if (!s.has(d)) miss++; }); s.forEach(d => { if (!set.has(d)) extra++; }); const sc = -miss * 10 - extra; if (sc > bs) { bs = sc; best = [v, k]; } } return best; }

// instanced placement: one draw call per model instead of one per tile
const groups = new Map();
const place = (name, pos, ry = 0, s = 1, tint = null) => { const k = name + '|' + (tint ?? ''); if (!groups.has(k)) groups.set(k, { name, tint, list: [] }); groups.get(k).list.push(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s))); };
async function flush(scene) {
  await Promise.all([...groups.values()].map(async ({ name, tint, list }) => { const g = await load('hex/' + name); g.scene.updateMatrixWorld(true);
    g.scene.traverse(m => { if (!m.isMesh) return; let mat = m.material; if (tint != null) { mat = mat.clone(); mat.color.set(tint); mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(.299,.587,.114))), diffuseColor.rgb, ' + (tint === WATER ? '.3' : '.55') + ');'); }; mat.customProgramCacheKey = () => 'desat' + tint; }
      const im = new THREE.InstancedMesh(m.geometry, mat, list.length); const local = m.matrixWorld; list.forEach((M, i) => im.setMatrixAt(i, M.clone().multiply(local)));
      im.castShadow = !/tiles\//.test(name); im.receiveShadow = true; scene.add(im); }); }));
}

export const B = {}; export let robot = null;
export const doorPos = id => { const s = SHOPS[id]; const b = hx(s.q, s.r), d = hx(...s.door); return { b, d, dir: d.clone().sub(b).normalize() }; };
const TILE = 0x9aa58f, WATER = 0x8fa3ab;

export async function buildTown(scene) {
  scene.background = new THREE.Color(C.base); scene.fog = new THREE.Fog(C.base, 46, 92);
  const hemi = new THREE.HemisphereLight(0xe6e2da, 0x1c2026, 1.05); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe7cc, 2.0); sun.position.set(-26, 22, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 90 }); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03; scene.add(sun);
  const rim = new THREE.DirectionalLight(0xd8cfc0, .35); rim.position.set(20, 16, -18); scene.add(rim);
  const sea = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshStandardMaterial({ color: new THREE.Color(C.base).lerp(new THREE.Color(C.muted), .12), roughness: .5 })); sea.rotation.x = -Math.PI / 2; sea.position.y = -.32; sea.receiveShadow = true; scene.add(sea);
  for (let q = -10; q <= 10; q++) for (let r = -10; r <= 10; r++) { const d = hdist(q, r); if (d > ISLAND && d <= 9) place('tiles/base/hex_water', hx(q, r), 0, 1, WATER); }
  const ghost = [];
  for (const t of tiles.values()) { const { q, r, kind } = t, k = key(q, r), p = hx(q, r);
    if (kind === 'river') place('tiles/rivers/hex_river_A', p, 2 * Math.PI / 3, 1, WATER);
    else if (kind === 'ghost') { ghost.push(p); place('tiles/base/hex_water', p, 0, 1, WATER); }
    else if (road.has(k)) { const set = new Set(); DIRS.forEach(([dq, dr], i) => { const nk = key(q + dq, r + dr); if (road.has(nk)) set.add(i); if (bTile.has(nk) && doorOf.get(k) === bTile.get(nk)) set.add(i); }); if (k === key(-7, 1)) set.add(3); if (k === key(0, 1)) set.add(2);
      const [v, rk] = pickRoad(set); place('tiles/roads/hex_road_' + v, p, rk * Math.PI / 3, 1, TILE); }
    else place('tiles/base/hex_grass', p, 0, 1, TILE);
  }
  // the other chains: a faint island past the river (only shape, no colour of its own)
  const gm = new THREE.MeshStandardMaterial({ color: C.muted, transparent: true, opacity: .07, depthWrite: false });
  const gg = new THREE.CylinderGeometry(1.14, 1.14, .2, 6); const gi = new THREE.InstancedMesh(gg, gm, ghost.length); ghost.forEach((p, i) => gi.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 0, p.z))); scene.add(gi);
  // trees: sparse, only in the wild ring so the town reads clearly
  const occupied = new Set([...road, ...bTile.keys()]);
  const trees = ['trees_A_large', 'trees_A_medium', 'trees_B_large', 'trees_B_medium', 'tree_single_A', 'tree_single_B'];
  for (const t of tiles.values()) { if (occupied.has(key(t.q, t.r))) continue; const x = rnd(), p = hx(t.q, t.r), k = ((rnd() * 6) | 0) * Math.PI / 3;
    if (t.kind === 'wild') { if (t.q < -3 && t.r < 0 && x < .45 && hdist(t.q, t.r) >= 6) place('decoration/nature/' + (x < .25 ? 'mountain_A_grass_trees' : 'hills_A_trees'), p, k, 1, TILE); else if (x < .6) place('decoration/nature/' + trees[(rnd() * trees.length) | 0], p, k, 1, TILE); }
    else if (t.kind === 'town' && x < .22) place('decoration/nature/' + ['tree_single_A', 'tree_single_B'][(rnd() * 2) | 0], p, k, .85, TILE); }
  const flushJob = flush(scene);
  const bJobs = Object.entries(SHOPS).map(async ([id, s]) => { const g = await load('hex/' + s.m); const o = g.scene.clone(true); const p = hx(s.q, s.r); o.position.copy(p); o.rotation.y = Math.PI / 3 * s.doorDir - Math.PI / 2; scene.add(shade(o)); o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.userData.id = id; } }); o.userData.id = id; B[id] = o; });
  // jetty + boat at the ferry (same spot as D2) so the Ferry reads from the town
  const jet = hx(3, -2).lerp(hx(4, -2), .62); const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .9 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, .06, .42), wood); deck.position.set(jet.x, .1, jet.z); deck.castShadow = true; scene.add(deck);
  scene.add(boat(new THREE.Vector3(hx(4, -2).x + .2, -.02, hx(4, -2).z + .55)));
  // street lamps: the accent colour comes from here (one point light each, few of them)
  const glowT = radial(CSS.accent || '#e2b35b'); const postM = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: .7 });
  [[0, 1, .62, .2], [1, -1, -.6, -.2], [-1, 0, -.6, .2], [-3, 1, .5, -.6], [-2, 3, .6, .5], [2, -2, .5, .6], [1, 2, -.6, .3], [-5, 1, .55, .75]].forEach(([q, r, dx, dz], i) => { const p = hx(q, r); const g = new THREE.Group(); g.position.set(p.x + dx, 0, p.z + dz);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.035, .05, 1.15, 6), postM); post.position.y = .58; post.castShadow = true; g.add(post);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(.1), new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: C.accent, emissiveIntensity: 2 })); head.position.y = 1.22; g.add(head);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .7 })); halo.scale.setScalar(1.1); halo.position.y = 1.22; g.add(halo);
    if (i % 2 === 0) { const L = new THREE.PointLight(0xffc477, 2, 4.2, 1.6); L.position.y = 1.15; g.add(L); } scene.add(g); });
  await Promise.all([flushJob, ...bJobs]);
  robot = await makeRobot(scene); const s = hx(0, 1); robot.at(s.x + .4, s.z + .3); robot.speed = 1.5;
  run(stroll());
}
export function boat(pos) { const g = new THREE.Group(); g.position.copy(pos);
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(.42, .3, .2, 6, 1), new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .85 })); hull.scale.set(1.5, 1, .7); hull.position.y = .1; hull.castShadow = true; g.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .8, 5), new THREE.MeshStandardMaterial({ color: 0x3b2a1e })); mast.position.y = .55; g.add(mast);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, .2, 0, 0, .9, 0, .4, .25, 0], 3)); sg.computeVertexNormals();
  const sail = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xe9e3d6, side: THREE.DoubleSide, roughness: 1 })); sail.castShadow = true; g.add(sail); return g; }

// the Lamplighter walks the roads between doors while you look around (no fast-forward, no text)
function roadPath(a, b) { return (astar(a, b, (q, r) => road.has(key(q, r))) || [b]).map(t => hx(...t)); }
function* stroll() { const order = ['ferry', 'guard', 'hall', 'arena', 'house', 'bank', 'toll']; let cur = [0, 1], i = 0;
  while (true) { const id = order[i++ % order.length]; const d = SHOPS[id].door; const p = roadPath(cur, d); cur = d; yield robot.walk(p.slice(1)); const { b } = doorPos(id); robot.lookAt(b); yield wait(2.2); } }

export function townCamera(cam) { cam.position.set(4, 30, 33); cam.lookAt(-.5, 0, 1); cam.userData.look = new THREE.Vector3(-.5, 0, 1); }
