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
// KayKit's palette atlas, recoloured swatch by swatch exactly like D9 (design/D9_world/js/world.js):
// blue team roofs → terracotta tile, water → sea-glass teal, acid grass → olive-sage. One shared texture.
const SW = { 8: ['#7fb3ad', '#3f6f6d'], 9: ['#6fa39e', '#2f5b5b'], 12: ['#93a46c', '#52653b'], 16: ['#8f9d63', '#55663a'], 17: ['#6f8a58', '#32503a'], 19: ['#a8977c', '#7b6a55'], 24: ['#a8644a', '#5e3427'], 27: ['#6b8754', '#2f4a36'] };
let ATLAS = null;
function atlasFrom(img) { if (ATLAS) return ATLAS; const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const sw = img.width / 8, sh = img.height / 4;
  for (const [i, [a, b]] of Object.entries(SW)) { const col = i % 8, row = (i / 8) | 0; const g = x.createLinearGradient(0, row * sh, 0, row * sh + sh); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(col * sw, row * sh, sw, sh); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; return ATLAS = t; }
const fixTex = (g, p) => { const hex = p.startsWith('hex/'); g.scene.traverse(m => { if (m.isMesh && m.material.map) { const t = m.material.map;
  if (hex && t.image && t.image.width === 1024) { m.material.map = atlasFrom(t.image); m.material.needsUpdate = true; return; }
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.anisotropy = 1; t.needsUpdate = true; } }); return g; };
export const load = p => { if (!cache.has(p)) cache.set(p, new Promise((res, rej) => loader.load(ASSETS + p + (p.endsWith('.glb') ? '' : '.gltf'), g => res(fixTex(g, p)), undefined, rej))); return cache.get(p); };
export function shade(o, cast = true, recv = true) { o.traverse(m => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; }
export async function put(scene, name, { x = 0, y = 0, z = 0, ry = 0, s = 1, fitW = 0 } = {}) {
  const g = await load('hex/' + name); const o = g.scene.clone(true);
  if (fitW) { const b = new THREE.Box3().setFromObject(o); const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z); s = fitW / w; }
  o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); scene.add(shade(o)); return o;
}
export function radial(c) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, c); g.addColorStop(.35, c + '88'); g.addColorStop(1, c + '00'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }

// colour roles (PRINCIPLES.md §2). The scene uses these too.
// Values are read at boot from the D8 role variables in styles.css, which point at the D7 tokens (design/D7_system/tokens/tokens.css).
export const C = { base: 0x17130f, raised: 0x1f1a15, line: 0x3a3128, text: 0xf3ead8, muted: 0x9c9182, accent: 0xd6b46a, ok: 0x00ec97, no: 0xff6b6b, ice: 0xa8d8ff };
export const CSS = {};
export function readTokens() { const cs = getComputedStyle(document.documentElement); const probe = document.createElement('i'); document.body.appendChild(probe);
  for (const k of Object.keys(C)) { const raw = cs.getPropertyValue('--' + k).trim(); if (!raw) continue; probe.style.color = raw; const m = getComputedStyle(probe).color.match(/[\d.]+/g); if (!m) continue; const [r, g, b] = m.map(Number); C[k] = (r << 16) | (g << 8) | b; CSS[k] = '#' + C[k].toString(16).padStart(6, '0'); }
  probe.remove(); return C; }

// the Lamplighter (RobotExpressive, CC0), tinted gold like D2, with a lantern in the accent colour
export class Char {
  constructor(g, scene, { h = 1.05, tint = null, outline = 0x241810 } = {}) {
    this.scene = scene;
    this.root = skClone(g.scene);
    this.root.traverse(m => { if (m.isMesh) { m.castShadow = true; if (tint && m.material.name === tint[0]) { m.material = m.material.clone(); m.material.color.set(tint[1]); m.material.emissive = new THREE.Color(tint[2]); m.material.emissiveIntensity = .12; } } });
    this.g = new THREE.Group(); this.g.add(this.root); scene.add(this.g);
    this.root.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(this.root); const s = h / (box.max.y - box.min.y); this.root.scale.setScalar(s); this.root.position.y = -box.min.y * s; this.h = h;
    // a thin dark inverted-hull outline so characters read against bright scenes (owner QA: stronger characters)
    if (outline != null) { this.root.updateMatrixWorld(true); const skin = []; this.root.traverse(m => { if (m.isSkinnedMesh) skin.push(m); });
      skin.forEach(m => { const ws = new THREE.Vector3(); m.getWorldScale(ws); const ow = (.012 / ws.x).toFixed(5);
        const om = new THREE.MeshBasicMaterial({ color: outline, side: THREE.BackSide }); om.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${ow};`); }; om.customProgramCacheKey = () => 'outline' + ow;
        const o = new THREE.SkinnedMesh(m.geometry, om); o.bind(m.skeleton, m.bindMatrix); o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale); o.frustumCulled = false; o.castShadow = false;
        if (m.morphTargetInfluences) { o.morphTargetInfluences = m.morphTargetInfluences; o.morphTargetDictionary = m.morphTargetDictionary; } m.parent.add(o); }); }
    this.mixer = new THREE.AnimationMixer(this.root); this.act = {}; g.animations.forEach(c => this.act[c.name] = this.mixer.clipAction(c));
    this.path = []; this.speed = 1.6; this.face = 0; this.onStep = null; this.stepAcc = 0;
  }
  play(n, { once = false, fade = .25, ts = 1 } = {}) { const a = this.act[n]; if (!a) return; if (this.cur === a && !once) return; a.reset(); a.setEffectiveTimeScale(ts); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = once; a.enabled = true; a.setEffectiveWeight(1); if (this.cur) this.cur.crossFadeTo(a, fade, false); a.play(); this.cur = a; }
  at(x, z) { this.g.position.set(x, 0, z); return this; }
  walk(pts) { if (RM) { const l = pts[pts.length - 1]; this.g.position.set(l.x, 0, l.z); const p = pts.length > 1 ? pts[pts.length - 2] : null; if (p) this.faceGoal = Math.atan2(l.x - p.x, l.z - p.z); this.play('Idle'); return () => true; } this.path = pts.map(p => p.clone()); this.play('Walking'); return () => this.path.length === 0; }
  // in a shop (room() puts its camera on the scene) the character turns half-way to the viewer, so we see a face, not a back
  lookAt(v, { toViewer = .5 } = {}) { const p = this.g.position; let a = Math.atan2(v.x - p.x, v.z - p.z); const cam = this.scene?.userData.camera;
    if (cam && toViewer) { const c = Math.atan2(cam.position.x - p.x, cam.position.z - p.z); let d = c - a; d = Math.atan2(Math.sin(d), Math.cos(d)); a += d * toViewer; }
    this.faceGoal = a; if (RM) this.face = this.faceGoal; }
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
  const lan = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial(CSS.accent || '#e2b35b'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: .5, fog: false })); lan.scale.setScalar(.38); lan.position.set(.3, .8, .12); c.g.add(lan); c.lan = lan;
  const L = new THREE.PointLight(C.accent, 1.0, 2.4, 1.6); L.position.set(.3, .85, .1); c.g.add(L); c.play('Idle'); return c;
}

// tokens and icons (D7 files; every amount gets its icon)
const TOK = { NEAR: 'near', USDC: 'usdc', ETH: 'eth', BTC: 'btc', ZEC: 'zec' };
const CHAIN = { Base: 'base', NEAR: 'near', 'Base Sepolia': 'base', Zcash: 'zec' };
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
  // bright, warm and even: no detail is left in shadow (owner QA 28 Oct); the front fill lifts tile sides and faces
  const hemi = new THREE.HemisphereLight(0xfff4e2, 0x5a4632, 1.55); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe7cc, 2.5); key.position.set(-6, 9, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 }); key.shadow.bias = -.0005; key.shadow.normalBias = .03; scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe2b0, 1.0); rim.position.set(6, 5, -7); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xfff0dc, .85); fill.position.set(cam[0] * .6 + 2, cam[1] * .7, cam[2]); scene.add(fill);
  const list = tiles || [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  await Promise.all(list.map(([q, r, kind]) => put(scene, 'tiles/base/' + (kind || 'hex_grass'), { ...hx(q, r) })));
  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, .3, 200); camera.position.set(...cam); camera.lookAt(...look); camera.userData.look = new THREE.Vector3(...look); camera.userData.home = camera.position.clone(); scene.userData.camera = camera;
  return { scene, camera, key };
}
