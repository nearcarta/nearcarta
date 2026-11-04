// Payouts (C3): the counting house. A ledger desk with one coin stack per payout and a brass batch seal: the charter
// pays the whole list in one propose_batch, or refuses all of it. The live flow is the tray app (js/shopui.js, APPS.payouts).
import { THREE, room, put, makeRobot, C } from '../js/core.js';
import { row, h3, note, proof, paper, acct } from './_ui.js';
import { M as PM, brassM, mesh, lantern, candle, rug, banner } from './_props.js';

// The R17 charter factory these batches run on (shared/deployments/testnet.json vault, judges/proofs/r17-factory.json).
const F = 'nccharters-53836.testnet';
const BATCH_PROOF = proof(
  h3('Batch payouts on testnet'),
  row({ k: 'Rule code published', why: 'anyone can rebuild it and get the same file', st: 'ok', stText: 'matches', tx: 'EqTuyP3yv3mhrNTbDbu8ckMNQyB2MSY56m6QPDNMfnR8' }),
  row({ k: 'Charter maker uses that code', why: 'every new charter runs it', st: 'ok', stText: 'live', tx: '9VJ3iRzE5quEz4pn8k2ZPzDqot2idAuj5kVJJ6Xi6iWc' }),
  row({ k: 'Charter maker locked', why: 'nobody can change it now', st: 'ok', stText: '0 keys', tx: 'D4W8yGEx5ZFhXo5m3d6tqQwJ3KomBhsuC3pcTuHeXVhm' }),
  note(`Factory ${acct(F)}. Up to 5 payouts per batch; one over budget refuses them all.`));
// Testnet USDC payroll (judges/proofs/payroll-usdc.json; live at /api/payouts/usdc).
export const USDC_PROOF = proof(
  h3('USDC payroll on testnet'),
  row({ k: 'You set the rule', why: '2 staff · 1 USDC per payment · 2 USDC a day', st: 'ok', stText: 'on chain', tx: 'EegQrPE6mPxZ6qiB1hgQvptFB2MFN3FCd6FwQh7y6jpA' }),
  row({ k: 'Staff registered on USDC', why: 'each wallet opened so it can receive USDC', st: 'ok', stText: 'done', tx: 'FZP13pFCrQgJUadCHcLoHHbF64UcwPbeJL7UK7wC2hk5' }),
  row({ k: 'Agent paid 0.5 USDC', why: 'inside the cap', st: 'ok', stText: 'paid', tx: '9mj13hmpnQV11FSy6tNZ4yoJbQeaJVMWhwAbPdSx6DDi' }),
  row({ k: 'Agent asked for 1.5 USDC', why: 'over the 1 USDC cap', st: 'no', stText: 'refused', tx: '6yMgMiRLfCtyum7aYJuL5Qkyy5hr74WPgQJmVrx7L6bv' }),
  note(`Charter ${acct('payroll-rveu.nccharters-22195.testnet')}. Token: Circle testnet USDC.`));
export const PROOF = USDC_PROOF + BATCH_PROOF;
export const MORE = null;
// For the 2D fallback (js/flat.js and the town's fb.js)
export const FLAT = { src: 'testnet', cls: 'testnet', label: 'One batch · all or nothing', hero: '<b class="num">5</b><span class="unit">max per batch</span>' };
export default async function payouts() {
  const { scene, camera } = await room({ cam: [.4, 3.9, 8.0], look: [0, .85, 0] });
  // the counting desk
  mesh(scene, new THREE.BoxGeometry(2.3, .1, .9), PM.wood, [0, .74, 0]);
  [[-1.05, -.38], [1.05, -.38], [-1.05, .38], [1.05, .38]].forEach(([x, z]) => mesh(scene, new THREE.BoxGeometry(.08, .72, .08), PM.dark, [x, .36, z]));
  // the ledger: ruled lines, five marks (no words, no amounts)
  const led = paper(THREE, 384, 240, (x, w, h) => { x.fillStyle = '#efe6d2'; x.fillRect(0, 0, w, h); x.fillStyle = '#c9b993'; x.fillRect(w / 2 - 2, 0, 4, h);
    for (let i = 0; i < 5; i++) { const y = 34 + i * 40; x.fillStyle = '#b9a988'; x.fillRect(18, y + 10, w / 2 - 40, 2); x.fillRect(w / 2 + 18, y + 10, w / 2 - 40, 2);
      x.fillStyle = i < 3 ? '#00a46a' : '#7b6a55'; x.beginPath(); x.arc(w / 2 + 30, y, 7, 0, 7); x.fill(); x.fillStyle = '#6f5d48'; x.fillRect(w / 2 + 48, y - 3, 60 + (i * 23) % 50, 5); } });
  mesh(scene, new THREE.PlaneGeometry(.86, .54), new THREE.MeshStandardMaterial({ map: led, roughness: 1 }), [-.5, .797, .05], { rx: -Math.PI / 2, cast: false });
  // one coin stack per payout, a tray under them
  mesh(scene, new THREE.BoxGeometry(.95, .03, .3), PM.dark, [.52, .805, .12]);
  const coinM = brassM(), stacks = [3, 5, 2, 4, 3].map((h, i) => { const g = new THREE.Group(); g.position.set(.16 + i * .18, .82, .12); scene.add(g);
    for (let k = 0; k < h; k++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .02, 20), coinM); c.position.y = k * .022; c.castShadow = true; g.add(c); } return g; });
  // the batch seal: a brass stamp on a wax disc, beside a candle
  mesh(scene, new THREE.CylinderGeometry(.09, .09, .02, 24), new THREE.MeshStandardMaterial({ color: C.no ?? 0xc0463e, roughness: .5 }), [.75, .8, -.25]);
  const stamp = new THREE.Group(); stamp.position.set(.75, .86, -.25); scene.add(stamp);
  stamp.add(new THREE.Mesh(new THREE.CylinderGeometry(.07, .08, .05, 20), brassM())); const hdl = new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, .16, 12), PM.wood); hdl.position.y = .1; stamp.add(hdl);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.045, 12, 8), PM.wood); knob.position.y = .2; stamp.add(knob);
  candle(scene, -1.0, .79, -.3);
  // back wall shelves, banners, a rug and lanterns
  mesh(scene, new THREE.BoxGeometry(3.2, 2.0, .2), PM.plaster, [0, 1.0, -1.5]);
  [.75, 1.3].forEach(y => mesh(scene, new THREE.BoxGeometry(1.6, .05, .26), PM.wood, [-.6, y, -1.33]));
  const bk = [0x7a3e2c, 0x5e6b4a, 0x8a6a3a, 0x4a4060, 0x9a5a3a];
  [.75, 1.3].forEach((y, j) => { let x = -1.3; for (let i = 0; i < 6; i++) { const w = .06 + ((i + j) % 3) * .015, h = .2 + ((i * 7 + j) % 4) * .03;
    mesh(scene, new THREE.BoxGeometry(w, h, .17), new THREE.MeshStandardMaterial({ color: bk[(i + j * 2) % 5], roughness: .9 }), [x, y + .025 + h / 2, -1.33]); x += w + .015; } });
  mesh(scene, new THREE.CylinderGeometry(.08, .1, .16, 14), brassM(), [.1, 1.405, -1.33]); mesh(scene, new THREE.CylinderGeometry(.07, .07, .12, 14), brassM(), [-.05, .855, -1.33]);
  banner(scene, 1.15, 1.75, -1.38, 0xa8644a, { w: .36, h: .85 });
  rug(scene, 0, 1.3, 2.6, 1.4, 0x5e3427); lantern(scene, -2.0, -.6, { h: 1.4 }); lantern(scene, 2.1, -.9, { h: 1.4, light: false });
  await put(scene, 'decoration/props/sack', { x: -1.75, z: .55, fitW: .4 }).catch(() => null);
  await put(scene, 'decoration/props/crate_B_small', { x: 1.75, z: .45, ry: .3, fitW: .42 }).catch(() => null);
  const rob = await makeRobot(scene); rob.at(1.55, 1.0); rob.lookAt(new THREE.Vector3(.4, 0, .1), { toViewer: .8 }); rob.face = rob.faceGoal; rob.g.rotation.y = rob.face;
  let t = 0;
  return {
    rob, scene, camera, tags: [],
    panel: { title: 'Payouts', src: 'testnet', label: 'One batch · all or nothing', hero: '<b class="num">5</b><span class="unit">max per batch</span>', action: null },
    proof: PROOF,
    update(dt) { t += dt; rob.update(dt); stamp.position.y = .86 + Math.max(0, Math.sin(t * 1.1)) * .03; stacks.forEach((s, i) => { s.rotation.y = Math.sin(t * .5 + i) * .08; }); },
  };
}
