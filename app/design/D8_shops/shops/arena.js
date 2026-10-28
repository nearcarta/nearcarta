// Vault Arena (static): Guardians stand round the vault. Five real lab attacks marked where they struck; none got in.
import { THREE, room, put, makeRobot, load, Char, C } from '../js/core.js';
import { ATTACKS, LAB } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, acct } from './_ui.js';

export default async function arena() {
  const { scene, camera } = await room({ cam: [0, 5, 9], look: [0, .8, 0] });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: .45, metalness: .6 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1, .2, 6), new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: .95 })); plinth.position.y = .1;
  const vault = new THREE.Mesh(new THREE.BoxGeometry(.9, .8, .7), metal); vault.position.y = .6; const door = new THREE.Mesh(new THREE.TorusGeometry(.22, .035, 8, 32), new THREE.MeshStandardMaterial({ color: 0xbfc3c9, metalness: .8, roughness: .3 })); door.position.set(0, .6, .36);
  [plinth, vault, door].forEach(m => { m.castShadow = m.receiveShadow = true; scene.add(m); });
  // five strike marks on an invisible dome: refused, so drawn in the refused colour, small
  const mk = new THREE.MeshBasicMaterial({ color: C.no });
  ATTACKS.forEach((a, i) => { const ang = -1.1 + i * .55, el = .5 + (i % 2) * .35, R = 1.9; const p = new THREE.Vector3(Math.sin(ang) * Math.cos(el) * R, .2 + Math.sin(el) * R, Math.cos(ang) * Math.cos(el) * R);
    const g = new THREE.Group(); g.position.copy(p); g.lookAt(0, .6, 0); [1, -1].forEach(s => { const bar = new THREE.Mesh(new THREE.PlaneGeometry(.2, .035), mk); bar.rotation.z = s * Math.PI / 4; g.add(bar); }); scene.add(g); });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, .006, 4, 96), new THREE.MeshBasicMaterial({ color: C.muted, transparent: true, opacity: .35 })); ring.rotation.x = Math.PI / 2; ring.position.y = .2; scene.add(ring);
  const kg = await load('chars/Knight.glb'); const guards = [[-1.7, .3, .9], [1.7, .3, -.9]].map(([x, z, f]) => { const k = new Char(kg, scene, { h: 1.0 }); k.root.traverse(m => { if (/Offhand|Rectangle|Round_Shield|Spike|2H_Sword/.test(m.name)) m.visible = false; }); k.at(x, z); k.g.rotation.y = f; k.play('Idle'); return k; });
  const rob = await makeRobot(scene); rob.at(.6, 2.2); rob.g.rotation.y = Math.PI;
  return {
    scene, camera, tags: [],
    panel: { title: 'Vault Arena', src: 'testnet', label: `${ATTACKS.length} attacks on the lab oath`, hero: `<b class="num">0</b><span class="unit">breaches</span>`, action: null },
    proof: proof(h3('Attacks on ' + LAB.oath), ...ATTACKS.map(a => row({ k: a.name, why: a.cls + ' · ' + a.reason, st: 'no', stText: 'refused', tx: a.tx })), note(`Lab oath ${acct(LAB.oath)}. The Guardians are a picture of the checks, not separate code.`)),
    update(dt) { rob.update(dt); guards.forEach(g => g.update(dt)); },
  };
}
