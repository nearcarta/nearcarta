// Vault Arena (static): Guardians stand round the vault. Five real lab attacks marked where they struck; none got in.
import { THREE, room, put, makeRobot, load, Char, C, CSS, radial } from '../js/core.js';
import { M as PM, brassM, mesh, lantern, banner } from './_props.js';
import { ATTACKS, LAB } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, acct, mainnet } from './_ui.js';
import { livePrompts } from './arenalive.js';

// Proof list at module level so the 2D view (js/flat.js) can show it without building the scene.
export const PROOF = mainnet('arena') + proof(h3('Attacks on ' + LAB.oath), ...ATTACKS.map(a => row({ k: a.name, why: a.cls + ' · ' + a.reason, st: 'no', stText: 'refused', tx: a.tx })), note(`Lab oath ${acct(LAB.oath)}. The Guardians are a picture of the checks, not separate code.`));
export default async function arena() {
  const liveP = livePrompts();
  const { scene, camera } = await room({ cam: [0, 5, 9], look: [0, .8, 0] });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: .5, metalness: .25 }); // bronze, lit: the vault reads as an object, not a hole
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1, .2, 6), PM.stone); plinth.position.y = .1;
  const vault = new THREE.Mesh(new THREE.BoxGeometry(.9, .8, .7), metal); vault.position.y = .6; const door = new THREE.Mesh(new THREE.TorusGeometry(.22, .035, 8, 32), new THREE.MeshStandardMaterial({ color: C.accent, metalness: .8, roughness: .3 })); door.position.set(0, .6, .36);
  [plinth, vault, door].forEach(m => { m.castShadow = m.receiveShadow = true; scene.add(m); });
  // the vault's shield: a faint brass hex-lattice dome; the five strikes sit on it as coral scorch marks with impact rings and an incoming trail
  const R = 1.9, dome = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 2), new THREE.MeshBasicMaterial({ color: C.accent, wireframe: true, transparent: true, opacity: .13, depthWrite: false }));
  dome.position.y = .2; scene.add(dome); dome.geometry.translate(0, 0, 0);
  const mk = new THREE.MeshBasicMaterial({ color: C.no, side: THREE.DoubleSide }), glowT = radial(CSS.no || '#ff6b6b'), rings = [];
  ATTACKS.forEach((a, i) => { const ang = -1.1 + i * .55, el = .72 + (i % 2) * .3; const dir = new THREE.Vector3(Math.sin(ang) * Math.cos(el), Math.sin(el), Math.cos(ang) * Math.cos(el)); const p = dir.clone().multiplyScalar(R).add(new THREE.Vector3(0, .2, 0));
    const g = new THREE.Group(); g.position.copy(p); g.lookAt(dir.clone().multiplyScalar(5).add(new THREE.Vector3(0, .2, 0)));
    [1, -1].forEach(s => { const bar = new THREE.Mesh(new THREE.PlaneGeometry(.38, .07), mk); bar.rotation.z = s * Math.PI / 4; bar.position.z = .01; g.add(bar); });
    const rg = new THREE.Mesh(new THREE.RingGeometry(.2, .235, 32), new THREE.MeshBasicMaterial({ color: C.no, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })); g.add(rg); rings.push({ m: rg, ph: i * .7 });
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .55 })); gl.scale.setScalar(.7); g.add(gl);
    const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone().add(dir.clone().multiplyScalar(1.4)), p.clone().add(dir.clone().multiplyScalar(.12))]), new THREE.LineDashedMaterial({ color: C.no, dashSize: .1, gapSize: .07, transparent: true, opacity: .6 })); trail.computeLineDistances(); scene.add(trail);
    scene.add(g); });
  lantern(scene, -2.4, -1.4, { h: 1.4 }); lantern(scene, 2.4, -1.4, { h: 1.4, light: false });
  banner(scene, -1.1, 1.9, -2.4, 0xa8644a, { w: .42, h: .9 }); banner(scene, 1.1, 1.9, -2.4, 0xa8644a, { w: .42, h: .9 });
  [-1.1, 1.1].forEach(x => mesh(scene, new THREE.CylinderGeometry(.03, .04, 1.95, 6), PM.dark, [x + (x < 0 ? -.27 : .27), .97, -2.4]));
  await put(scene, 'decoration/props/weaponrack', { x: -2.5, z: .9, ry: 1.0 }); await put(scene, 'decoration/props/bucket_arrows', { x: 2.5, z: .6, fitW: .32 }); await put(scene, 'decoration/props/target', { x: 2.6, z: -.4, ry: -1.0, fitW: .7 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, .006, 4, 96), new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: .5 })); ring.rotation.x = Math.PI / 2; ring.position.y = .2; scene.add(ring);
  const kg = await load('chars/Knight.glb'); const guards = [[-1.7, .3, .9], [1.7, .3, -.9]].map(([x, z, f]) => { const k = new Char(kg, scene, { h: 1.0 }); k.root.traverse(m => { if (/Offhand|Rectangle|Round_Shield|Spike|2H_Sword/.test(m.name)) m.visible = false; }); k.at(x, z); k.g.rotation.y = f; k.play('Idle'); return k; });
  let t = 0; const rob = await makeRobot(scene); rob.at(.6, 2.2); rob.lookAt(new THREE.Vector3(0, 0, 0), { toViewer: .82 }); rob.face = rob.faceGoal; rob.g.rotation.y = rob.face;
  const ROOM = {
    rob, scene, camera, tags: [],
    panel: { title: 'Vault Arena', src: 'split', srcNote: 'arena.nearcarta.near is on mainnet. The shared arena you can try is the mainnet charter.', label: `${ATTACKS.length} attacks on the lab oath`, hero: `<b class="num">0</b><span class="unit">breaches</span>`, action: null },
    // The past prompts arrive after the room is up: the town drawer reads sh.proof when it opens.
    proof: PROOF,
    update(dt) { t += dt; rings.forEach(r => { const k = ((t * .6 + r.ph) % 1); r.m.scale.setScalar(1 + k * .9); r.m.material.opacity = .85 * (1 - k); }); rob.update(dt); guards.forEach(g => g.update(dt)); },
  };
  liveP.then(h => { ROOM.proof = PROOF + h; });
  return ROOM;
}
