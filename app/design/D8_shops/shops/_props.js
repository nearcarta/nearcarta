// Small shared set pieces for the interiors: warm materials, brass lanterns, candles, rugs, banners.
// Plain geometry + KayKit props only (CC0). No words in the world.
import { THREE, C, CSS, radial } from '../js/core.js';
export const M = {
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .85 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: .8 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: .95 }),
  plaster: new THREE.MeshStandardMaterial({ color: 0xc8bba4, roughness: 1 }),
  terra: new THREE.MeshStandardMaterial({ color: 0xa8644a, roughness: .9 }),
};
let brass; export const brassM = () => brass ||= new THREE.MeshStandardMaterial({ color: C.accent, metalness: .75, roughness: .32 });
let glowT; const glow = () => glowT ||= radial(CSS.accent || '#00ec97');
export function mesh(scene, geo, mat, [x, y, z] = [0, 0, 0], { rx = 0, ry = 0, rz = 0, cast = true } = {}) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m; }
// a standing or hanging brass lantern; light=false keeps the draw cost down
export function lantern(scene, x, z, { h = 1.25, light = true, post = true, s = 1 } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
  if (post) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.03, .045, h, 6), M.dark); p.position.y = h / 2; p.castShadow = true; g.add(p); }
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, .16, 6, 1, true), brassM()); cage.position.y = h + .06; g.add(cage);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(.1, .08, 6), brassM()); cap.position.y = h + .18; g.add(cap);
  const core = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8 })); core.position.y = h + .06; g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .45 })); halo.scale.setScalar(.55); halo.position.y = h + .06; g.add(halo);
  if (light) { const L = new THREE.PointLight(0xffc477, 1.6, 3.2, 1.6); L.position.y = h + .06; g.add(L); }
  scene.add(g); return g;
}
export function candle(scene, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z);
  const c = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .12, 8), new THREE.MeshStandardMaterial({ color: 0xeef2ff, roughness: .9 })); c.position.y = .06; g.add(c);
  const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .7 })); f.scale.setScalar(.16); f.position.y = .15; g.add(f); scene.add(g); return g; }
export function rug(scene, x, z, w, d, col = 0x7a3e2c) { const r = mesh(scene, new THREE.BoxGeometry(w, .015, d), new THREE.MeshStandardMaterial({ color: col, roughness: 1 }), [x, .008, z], { cast: false });
  const b = mesh(scene, new THREE.BoxGeometry(w * .86, .018, d * .8), new THREE.MeshStandardMaterial({ color: 0xc89a5a, roughness: 1 }), [x, .01, z], { cast: false }); b.scale.set(1, 1, 1); const in2 = mesh(scene, new THREE.BoxGeometry(w * .8, .02, d * .7), new THREE.MeshStandardMaterial({ color: col, roughness: 1 }), [x, .012, z], { cast: false }); return r; }
// a hanging cloth banner on a rod (colour = role colour or terracotta)
export function banner(scene, x, y, z, col = 0xa8644a, { w = .42, h = .8, ry = 0 } = {}) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, w + .12, 6), brassM()); rod.rotation.z = Math.PI / 2; g.add(rod);
  const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, -h); sh.lineTo(0, -h + .12); sh.lineTo(-w / 2, -h); sh.closePath();
  const cl = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({ color: col, roughness: 1, side: THREE.DoubleSide })); cl.position.z = .01; cl.castShadow = true; g.add(cl);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w, .03), brassM()); stripe.position.set(0, -.1, .015); g.add(stripe); scene.add(g); return g; }
