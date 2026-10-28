// D8 core: shared clock, loaders, robot, tokens, sound. Reuses D2 assets and the D7 kit by relative path (read-only).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { audio } from '../../D2_game/d7/js/audio.js';
export { THREE };

export const P = new URLSearchParams(location.search);
export const CAPTURE = P.has('capture');
export const RM = P.has('rm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ASSETS = '../D2_game/assets/';
export const D7 = '../D2_game/d7/';
export const $ = s => document.querySelector(s);

// deterministic sim clock + coroutines (frame-steppable for capture)
export const clock = { T: 0 };
const routines = [];
export function run(gen) { const r = { g: gen, cond: null, dead: false }; routines.push(r); step(r); return r; }
function step(r) { while (!r.dead) { if (r.cond && !r.cond()) return; const n = r.g.next(); if (n.done) { r.dead = true; return; } r.cond = n.value; } }
export function tickRoutines() { for (const r of [...routines]) step(r); for (let i = routines.length - 1; i >= 0; i--) if (routines[i].dead) routines.splice(i, 1); }
export function killAll() { routines.forEach(r => r.dead = true); routines.length = 0; }
export const wait = s => { const t = clock.T + (RM ? Math.min(s, .05) : s); return () => clock.T >= t; };
export const tween = (dur, f, ease = easeOut) => { const t0 = clock.T, d = RM ? .001 : dur; f(0); return () => { const k = Math.min(1, (clock.T - t0) / d); f(ease(k)); return k >= 1; }; };
export const easeOut = k => 1 - Math.pow(1 - k, 4);           // ≈ cubic-bezier(.16,1,.3,1)
export const easeInOut = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

// event log: every sound cue gets a timestamp, so the video's audio track can be rebuilt in ffmpeg
export const events = [];
const snd = audio({ base: D7 + 'assets/audio/', howler: D7 + 'assets/engines/howler/howler.min.js' });
export const sound = snd;
export function sfx(name, opt) { events.push({ t: +clock.T.toFixed(3), name }); snd.play(name, opt); }

// glTF loader with cache
const loader = new GLTFLoader(); const cache = new Map();
const fixTex = g => { g.scene.traverse(m => { if (m.isMesh && m.material.map) { const t = m.material.map; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.anisotropy = 1; t.needsUpdate = true; } }); return g; };
export const load = p => { if (!cache.has(p)) cache.set(p, new Promise((res, rej) => loader.load(ASSETS + p + (p.endsWith('.glb') ? '' : '.gltf'), g => res(fixTex(g)), undefined, rej))); return cache.get(p); };
export function shade(o, cast = true, recv = true) { o.traverse(m => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; }
export async function put(scene, name, { x = 0, y = 0, z = 0, ry = 0, s = 1, fitW = 0 } = {}) {
  const g = await load('hex/' + name); const o = g.scene.clone(true);
  if (fitW) { const b = new THREE.Box3().setFromObject(o); const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z); s = fitW / w; }
  o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); scene.add(shade(o)); return o;
}
export function radial(c) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, c); g.addColorStop(.35, c + '88'); g.addColorStop(1, c + '00'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }

// colour roles (PRINCIPLES.md §2). The scene uses these too.
// Values are read at boot from the D8 role variables in styles.css, which point at the D7 tokens (design/D7_system/tokens/tokens.css).
export const C = { base: 0x0f1115, raised: 0x171a1f, line: 0x2a2e36, text: 0xeceef1, muted: 0x8e95a1, accent: 0xe2b35b, ok: 0x46c08a, no: 0xec5d57, ice: 0x9fd0ee };
export const CSS = {};
export function readTokens() { const cs = getComputedStyle(document.documentElement); const probe = document.createElement('i'); document.body.appendChild(probe);
  for (const k of Object.keys(C)) { const raw = cs.getPropertyValue('--' + k).trim(); if (!raw) continue; probe.style.color = raw; const m = getComputedStyle(probe).color.match(/[\d.]+/g); if (!m) continue; const [r, g, b] = m.map(Number); C[k] = (r << 16) | (g << 8) | b; CSS[k] = '#' + C[k].toString(16).padStart(6, '0'); }
  probe.remove(); return C; }

// the Lamplighter (RobotExpressive, CC0), tinted gold like D2, with a lantern in the accent colour
export class Char {
  constructor(g, scene, { h = .95, tint = null } = {}) {
    this.root = skClone(g.scene);
    this.root.traverse(m => { if (m.isMesh) { m.castShadow = true; if (tint && m.material.name === tint[0]) { m.material = m.material.clone(); m.material.color.set(tint[1]); m.material.emissive = new THREE.Color(tint[2]); m.material.emissiveIntensity = .3; } } });
    this.g = new THREE.Group(); this.g.add(this.root); scene.add(this.g);
    this.root.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(this.root); const s = h / (box.max.y - box.min.y); this.root.scale.setScalar(s); this.root.position.y = -box.min.y * s; this.h = h;
    this.mixer = new THREE.AnimationMixer(this.root); this.act = {}; g.animations.forEach(c => this.act[c.name] = this.mixer.clipAction(c));
    this.path = []; this.speed = 1.6; this.face = 0; this.onStep = null; this.stepAcc = 0;
  }
  play(n, { once = false, fade = .25, ts = 1 } = {}) { const a = this.act[n]; if (!a) return; if (this.cur === a && !once) return; a.reset(); a.setEffectiveTimeScale(ts); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = once; a.enabled = true; a.setEffectiveWeight(1); if (this.cur) this.cur.crossFadeTo(a, fade, false); a.play(); this.cur = a; }
  at(x, z) { this.g.position.set(x, 0, z); return this; }
  walk(pts) { if (RM) { const l = pts[pts.length - 1]; this.g.position.set(l.x, 0, l.z); const p = pts.length > 1 ? pts[pts.length - 2] : null; if (p) this.faceGoal = Math.atan2(l.x - p.x, l.z - p.z); this.play('Idle'); return () => true; } this.path = pts.map(p => p.clone()); this.play('Walking'); return () => this.path.length === 0; }
  lookAt(v) { this.faceGoal = Math.atan2(v.x - this.g.position.x, v.z - this.g.position.z); if (RM) this.face = this.faceGoal; }
  update(dt) {
    this.mixer.update(dt);
    if (this.path.length) { const t = this.path[0]; const d = t.clone().sub(this.g.position); d.y = 0; const L = d.length(), st = this.speed * dt;
      if (L <= st) { this.g.position.set(t.x, 0, t.z); this.path.shift(); if (!this.path.length) this.play('Idle'); }
      else { this.g.position.addScaledVector(d.normalize(), st); this.faceGoal = Math.atan2(d.x, d.z); this.stepAcc += dt; if (this.stepAcc > .36) { this.stepAcc = 0; this._s = !this._s; if (!this.quiet) sfx(this._s ? 'step-a' : 'step-b'); } } }
    if (this.faceGoal !== undefined) { let df = this.faceGoal - this.face; df = Math.atan2(Math.sin(df), Math.cos(df)); this.face += df * Math.min(1, dt * 8); this.g.rotation.y = this.face; }
  }
}
export async function makeRobot(scene) {
  const g = await load('chars/RobotExpressive.glb'); const c = new Char(g, scene, { tint: ['Main', 0xd9a441, 0x4a2a00] });
  const lan = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial(CSS.accent || '#e2b35b'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: .8 })); lan.scale.setScalar(.55); lan.position.set(.3, .8, .12); c.g.add(lan);
  const L = new THREE.PointLight(C.accent, 1.4, 3, 1.5); L.position.set(.3, .85, .1); c.g.add(L); c.play('Idle'); return c;
}

// tokens and icons (D7 files; every amount gets its icon)
const TOK = { NEAR: 'near', USDC: 'usdc', ETH: 'eth', BTC: 'btc', ZEC: 'zec' };
const CHAIN = { Base: 'base', NEAR: 'near', 'Base Sepolia': 'base' };
export function tok(amount, sym, { chain = null, cls = '' } = {}) {
  const f = sym === 'NEAR' ? null : TOK[sym]; const ic = sym === 'NEAR' ? `<span class="ti coin" aria-hidden="true">N</span>` : f ? `<img class="ti" src="${D7}assets/tokens/tokens/${f}.svg" alt="" width="20" height="20">` : `<span class="ti coin" aria-hidden="true">${sym.slice(0, 1)}</span>`;
  const ch = chain && chain !== 'NEAR' && CHAIN[chain] ? `<img class="ci" src="${D7}assets/tokens/chains/${CHAIN[chain]}.svg" alt="${chain}" title="on ${chain}" width="12" height="12">` : '';
  return `<span class="tok ${cls}"><span class="tic">${ic}${ch}</span>${amount != null ? `<b class="num">${amount}</b>` : ''}<span class="sym">${sym}</span></span>`;
}
export const i3 = (n, size = 32) => `<img class="i3" src="${D7}assets/3dicons/192/${n}-premium.webp" alt="" width="${size}" height="${size}" decoding="async">`;
export const NB = h => `https://testnet.nearblocks.io/txns/${h}`;
export const short = h => h.length > 14 ? h.slice(0, 6) + '…' + h.slice(-4) : h;
export const txLink = h => `<a class="tx" href="${NB(h)}" target="_blank" rel="noopener">${short(h)} ↗</a>`;

export function desat(mat, k = .55) { mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
 diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(.299,.587,.114))), diffuseColor.rgb, ${k.toFixed(2)});`); }; mat.customProgramCacheKey = () => 'desat' + k; return mat; }
// a "little world": a hex island in an empty void (Monument Valley, RESEARCH B7)
export const SQ3 = Math.sqrt(3); export const hx = (q, r) => new THREE.Vector3(2 * q + r, 0, SQ3 * r);
export async function room({ tiles = null, cam = [0, 6.5, 11], look = [0, .6, 0], fov = 30 } = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(C.base);
  const hemi = new THREE.HemisphereLight(0xe6e2da, 0x1a1c22, 1.0); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe7cc, 2.1); key.position.set(-6, 9, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 }); key.shadow.bias = -.0005; key.shadow.normalBias = .03; scene.add(key);
  const rim = new THREE.DirectionalLight(0xd8cfc0, .4); rim.position.set(6, 4, -7); scene.add(rim);
  const list = tiles || [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  await Promise.all(list.map(([q, r, kind]) => put(scene, 'tiles/base/' + (kind || 'hex_grass'), { ...hx(q, r) }).then(o => { const wet = /water|river/.test(kind || ''); o.traverse(m => { if (m.isMesh) { m.material = desat(m.material.clone(), wet ? .3 : .55); m.material.color.set(wet ? 0x8fa3ab : 0x9aa58f); } }); })));
  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, .3, 200); camera.position.set(...cam); camera.lookAt(...look); camera.userData.look = new THREE.Vector3(...look); camera.userData.home = camera.position.clone();
  return { scene, camera, key };
}
