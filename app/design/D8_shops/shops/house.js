// Your House (static): the oath hangs on the wall as a charter. Real policy v4 of the core oath. No action here: freezing is the owner's key, not a demo button.
import { THREE, room, put, makeRobot, tok, C } from '../js/core.js';
import { CORE, CLAUSES } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, paper, acct } from './_ui.js';

export default async function house() {
  const { scene, camera } = await room({ cam: [-1.6, 3.4, 7.8], look: [0, 1, 0] });
  const plaster = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 1 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, .16), plaster); wall.position.set(0, 1.1, -.9); wall.castShadow = wall.receiveShadow = true; scene.add(wall);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.3, .06), new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: .7 })); frame.position.set(0, 1.25, -.79); scene.add(frame);
  const tex = paper(THREE, 256, 320, (x, w, h) => { x.fillStyle = '#e9e3d6'; x.fillRect(0, 0, w, h); x.fillStyle = '#6f675c'; x.fillRect(60, 30, 136, 8); for (let i = 0; i < 7; i++) x.fillRect(30, 76 + i * 28, 150 + (i * 29) % 46, 5); x.strokeStyle = '#8a3b36'; x.lineWidth = 4; x.beginPath(); x.arc(w - 56, h - 50, 22, 0, 7); x.stroke(); });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(.92, 1.16), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })); sheet.position.set(0, 1.25, -.755); scene.add(sheet);
  await put(scene, 'decoration/props/barrel', { x: 1.4, z: -.4 });
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .42, 12), new THREE.MeshStandardMaterial({ color: 0x6b4a33 })); stool.position.set(.9, .21, .9); stool.castShadow = true; scene.add(stool);
  const rob = await makeRobot(scene); rob.at(-.9, 1.0); rob.lookAt(sheet.position);
  const tip = CLAUSES[0];
  return {
    scene, camera, tags: [],
    panel: { title: 'Your House', src: 'testnet', label: `Tip cap · policy v${CORE.policyVersion}`, hero: tok(String(tip.cap), 'NEAR'), action: null },
    proof: proof(h3('The oath'), row({ k: 'Policy version ' + CORE.policyVersion, why: CORE.policyHash.slice(0, 16) + '…' }), row({ k: 'Contract code', why: CORE.codeHash }), row({ k: 'Freeze epoch ' + CORE.freezeEpoch, why: 'owner or DAO can freeze' }),
      h3('Clauses'), ...CLAUSES.map(c => row({ k: `${c.id} · cap ${c.cap} · budget ${c.budget} NEAR`, why: `spent ${c.spent} · payee ${c.payees.join(', ')}`, tx: c.tx })),
      note(`Oath ${acct(CORE.oath)}, owner ${acct(CORE.owner)}. Snapshot ${CORE.snapshot}.`)),
    update(dt) { rob.update(dt); },
  };
}
