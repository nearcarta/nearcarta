// Chronicle (static): the crier's scroll. One mark per real decision from the core testnet run; refusals in the refused colour.
import { THREE, room, makeRobot, C, CSS } from '../js/core.js';
import { CORE_TXS, CORE } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, paper, acct } from './_ui.js';

export default async function chronicle() {
  const { scene, camera } = await room({ cam: [0, 3.6, 7.6], look: [0, 1.1, 0] });
  const acts = CORE_TXS.filter(t => t.kind === 'action'); const denied = acts.filter(t => t.decision === 'denied');
  const hexs = n => CSS[n] || '#' + C[n].toString(16).padStart(6, '0');
  const tex = paper(THREE, 256, 512, (x, w, h) => { x.fillStyle = '#e9e3d6'; x.fillRect(0, 0, w, h);
    acts.forEach((a, i) => { const y = 40 + i * 44; const c = a.decision === 'denied' ? hexs('no') : a.decision === 'allowed' ? hexs('ok') : '#8e8679'; x.fillStyle = c; x.beginPath(); x.arc(34, y, 8, 0, 7); x.fill(); x.fillStyle = '#6f675c'; x.fillRect(58, y - 3, 110 + (i * 41) % 70, 6); }); });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .85 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, 2.2, 8), wood); post.position.set(-.85, 1.1, 0); const post2 = post.clone(); post2.position.x = .85;
  const rollT = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 1.9, 12), wood); rollT.rotation.z = Math.PI / 2; rollT.position.set(0, 2.05, .02); const rollB = rollT.clone(); rollB.position.y = .55;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.45), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide })); sheet.position.set(0, 1.3, .03);
  [post, post2, rollT, rollB, sheet].forEach(m => { m.castShadow = true; scene.add(m); });
  const rob = await makeRobot(scene); rob.at(1.4, 1.1); rob.lookAt(new THREE.Vector3(0, 0, 3));
  return {
    scene, camera, tags: [],
    panel: { title: 'Chronicle', src: 'testnet', label: 'Refusals on the record', hero: `<b class="num">${denied.length}</b><span class="unit">of ${acts.length} actions</span>`, action: null },
    proof: proof(h3('Every action the agent tried'), ...acts.map(a => row({ k: a.what, why: (a.reason || a.clause).replaceAll('_', ' '), st: a.decision === 'denied' ? 'no' : a.decision === 'allowed' ? 'ok' : 'pend', stText: a.decision, tx: a.tx })), note(`Oath ${acct(CORE.oath)}. One mark on the scroll per row.`)),
    update(dt) { rob.update(dt); },
  };
}
