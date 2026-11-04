// Mist Bank: a vault with a street window. The street sees that a payout happened; the ledger shows only the on-chain
// commitment to the amount. The API no longer returns the amount, salt or viewing key, and this view never shows an amount.
// Data: D6 BANK when the host provides it (tech app), else the live-read snapshot in data/live.js (tools/snapshot.mjs).
import { THREE, room, put, makeRobot, C, CSS, radial } from '../js/core.js';
import { row, h3, note, proof, paper, esc } from './_ui.js';
import * as D from '../../D6_dashboards/src/data.js';
import { BANK } from '../data/live.js';
import { M as PM, brassM, mesh, lantern, candle, rug } from './_props.js';

const B = D.BANK || BANK;
// The room's one-line summary of how a payout runs (room copy; the README is the charter worker's).
export const ROOM_LINE = 'One fresh payee per payout; the Zcash send is run by an operator worker.';
const LEG = { shield: 'Shield ZEC into a confidential balance', transfer: 'Transfer between confidential balances', unshield: 'Unshield to a public Intents balance' };
const short = c => `${String(c).slice(0, 8)}…${String(c).slice(-6)}`;
function live(b) {
  const s = b.street;
  return proof(
    note(ROOM_LINE),
    h3('The street window · public explorer, live read'),
    row({ k: 'A payout happened. The amount is hidden.', why: 'The public record shows a shielded payment and a small fee. This page never shows the amount.', st: s.hidden ? 'ok' : 'no', stText: s.hidden ? 'amount hidden' : 'amount visible', src: 'live' }),
    `<details class="more"><summary>Technical details</summary>`,
    row({ k: `Recorded at block ${s.height}`, why: s.hidden ? `The amount stays inside a shielded pool. The fee is ${s.fee} of the smallest Zcash unit.` : `Amount visible: ${s.reasons.join(', ')}`, st: s.hidden ? 'ok' : 'no', stText: s.hidden ? 'hidden' : 'visible', src: 'live' }),
    note(`<a class="tx" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.txid.slice(0, 12))}… ↗</a> · ${esc(String(s.confirmations))} confirmations${b.at ? ' · read ' + esc(b.at) : ''}`),
    h3('The oath · NEAR testnet'),
    row({ k: `Payout approved by clause ${b.oath.clause}`, why: 'the memo on chain holds only a commitment to the amount', st: b.oath.ok ? 'ok' : 'no', stText: b.oath.ok ? 'allowed' : 'not verified', tx: b.oath.tx }),
    h3('The commitment · NEAR testnet memo'),
    row({ k: `sha256 ${short(b.commitment.value)}`, why: 'binds the paid amount without showing it; this app never receives the amount, salt or viewing key', st: 'ok', stText: 'amount hidden', src: 'testnet' }),
    `<p class="kv">${esc(b.commitment.value)}</p>`,
    note(`Auditor check: with the payee viewing key, read the amount and salt from the encrypted memo and hash them, or ${esc(b.auditor?.verify || 'POST /api/mistbank/verify')}. A match proves the paid amount is the committed one.`),
    ...(b.binding && !b.binding.capsAmount ? [note('The charter approves the payout and stores the commitment; it does not cap the Zcash amount.')] : []),
    h3('The desk · NEAR Intents Confidential, dry quotes'),
    ...(b.desk?.length ? b.desk.map(l => row({ k: LEG[l.leg] || l.leg, why: `privacy ${l.privacy} · signature ${l.sig ? 'verified' : 'FAILED'} · echo ${l.echo ? 'ok' : 'differs'}`, st: l.ok ? 'ok' : 'no', stText: l.ok ? 'quoted' : 'rejected', src: 'live' }))
      : [row({ k: 'Confidential quotes', why: 'not available on this server', st: 'no', stText: 'off', src: 'live' })]),
    note('Practice quotes only: nothing was spent.'),
    `</details>`);
}
const HERO = `<span class="commit" title="sha256 commitment on NEAR testnet">${esc(String(B.commitment?.value || '').slice(0, 8))}…</span><span class="unit">amount hidden</span>`;
// For the 2D fallback (js/flat.js)
export const FLAT = { src: 'testnet', cls: 'testnet', label: 'Street sees a payout, not the amount · operator-run worker', hero: HERO };
export const PROOF = live(B);

export default async function bank() {
  const { scene, camera } = await room({ cam: [2.6, 3.8, 8.2], look: [0, .9, 0] });
  const wall = mesh(scene, new THREE.BoxGeometry(3.4, 2.1, .22), PM.plaster, [0, 1.05, -.9]);
  mesh(scene, new THREE.BoxGeometry(3.5, .14, .3), PM.stone, [0, 2.12, -.9]); mesh(scene, new THREE.BoxGeometry(3.5, .18, .3), PM.stone, [0, .09, -.9]);
  // the street window: frosted, mist drifting past; the payout is only a soft brass shape
  const wx = -.85, wy = 1.2, wz = -.775;
  [[0, .44], [0, -.44]].forEach(([x, y]) => mesh(scene, new THREE.BoxGeometry(1.28, .07, .08), PM.dark, [wx + x, wy + y, wz]));
  [-.64, .64, 0].forEach(x => mesh(scene, new THREE.BoxGeometry(.07, .95, .08), PM.dark, [wx + x, wy, wz]));
  const glass = mesh(scene, new THREE.PlaneGeometry(1.22, .84), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, transparent: true, opacity: .5, roughness: 1 }), [wx, wy, wz + .02], { cast: false });
  const shape = mesh(scene, new THREE.CircleGeometry(.18, 24), new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: .75 }), [wx - .25, wy - .05, wz - .02], { cast: false });
  const mistT = radial('#f3ead8'), mist = [0, 1, 2, 3].map(i => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistT, transparent: true, opacity: .35, depthWrite: false })); m.scale.set(.7, .45, 1); m.position.set(wx - .4 + i * .3, wy - .15 + (i % 2) * .25, wz + .05); scene.add(m); return m; });
  // the vault door: round, brass, bolted
  const vx = .95, vy = 1.0, vz = -.775;
  mesh(scene, new THREE.CylinderGeometry(.56, .56, .06, 40), PM.dark, [vx, vy, vz], { rx: Math.PI / 2 });
  mesh(scene, new THREE.CylinderGeometry(.48, .48, .1, 40), brassM(), [vx, vy, vz + .03], { rx: Math.PI / 2 });
  mesh(scene, new THREE.TorusGeometry(.4, .02, 8, 40), PM.dark, [vx, vy, vz + .085]);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; mesh(scene, new THREE.SphereGeometry(.025, 8, 6), PM.dark, [vx + Math.cos(a) * .44, vy + Math.sin(a) * .44, vz + .08]); }
  const wheel = new THREE.Group(); wheel.position.set(vx, vy, vz + .1); scene.add(wheel);
  for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(.42, .035, .035), PM.dark); sp.rotation.z = i * Math.PI / 3; wheel.add(sp); }
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(.21, .02, 8, 32), PM.dark));
  // the ledger desk: open book with the commitment and a wax seal (no amount anywhere), the brass viewing key, a candle
  const desk = mesh(scene, new THREE.BoxGeometry(1.3, .1, .66), PM.wood, [.75, .7, .55]);
  [[-.58, -.27], [.58, -.27], [-.58, .27], [.58, .27]].forEach(([x, z]) => mesh(scene, new THREE.BoxGeometry(.07, .66, .07), PM.dark, [.75 + x, .33, .55 + z]));
  const cm = String(B.commitment?.value || '');
  const page = paper(THREE, 320, 200, (x, w, h) => { x.fillStyle = '#efe6d2'; x.fillRect(0, 0, w, h); x.fillStyle = '#c9b993'; x.fillRect(w / 2 - 2, 0, 4, h);
    x.fillStyle = '#7b6a55'; for (let i = 0; i < 6; i++) { x.fillRect(16, 22 + i * 26, 100 - (i * 17) % 40, 4); if (i < 3) x.fillRect(w / 2 + 16, 22 + i * 26, 90 - (i * 23) % 40, 4); }
    x.fillStyle = '#3b2a1e'; x.font = '600 15px ui-monospace, Menlo, monospace'; for (let i = 0; i < 4; i++) x.fillText(cm.slice(i * 8, i * 8 + 8), w / 2 + 16, 116 + i * 18);
    x.fillStyle = '#c0463e'; x.beginPath(); x.arc(w - 34, 168, 17, 0, Math.PI * 2); x.fill(); x.fillStyle = '#8a2b26'; x.beginPath(); x.arc(w - 34, 168, 9, 0, Math.PI * 2); x.fill(); });
  mesh(scene, new THREE.PlaneGeometry(.78, .49), new THREE.MeshStandardMaterial({ map: page, roughness: 1 }), [.75, .757, .55], { rx: -Math.PI / 2, cast: false });
  const key = new THREE.Group(); key.position.set(1.28, .77, .42); key.rotation.y = .5; scene.add(key);
  const kb = new THREE.Mesh(new THREE.TorusGeometry(.05, .016, 8, 20), brassM()); kb.rotation.x = Math.PI / 2; key.add(kb);
  const ks = new THREE.Mesh(new THREE.BoxGeometry(.18, .02, .02), brassM()); ks.position.x = .13; key.add(ks);
  [.18, .21].forEach(x => { const t = new THREE.Mesh(new THREE.BoxGeometry(.015, .02, .05), brassM()); t.position.set(x, 0, .025); key.add(t); });
  candle(scene, .2, .75, .38); rug(scene, .3, 1.3, 2.4, 1.4, 0x5e3427);
  await put(scene, 'decoration/props/sack', { x: -1.55, z: .1, fitW: .42 }); await put(scene, 'decoration/props/sack', { x: -1.2, z: -.3, ry: 1.2, fitW: .38 });
  await put(scene, 'decoration/props/crate_B_small', { x: -1.75, z: .75, fitW: .45 });
  lantern(scene, -1.9, -.5, { h: 1.5 });
  const rob = await makeRobot(scene); rob.at(1.45, .95); rob.lookAt(new THREE.Vector3(.75, 0, .55), { toViewer: .8 }); rob.face = rob.faceGoal; rob.g.rotation.y = rob.face;
  let t = 0;
  return {
    rob, scene, camera, tags: [],
    panel: { title: 'Mist Bank', src: 'testnet', srcNote: 'Operator-run worker: the Zcash testnet send is made by a worker Nearcarta runs, not by your charter or a contract.', label: FLAT.label, hero: HERO, action: null },
    proof: PROOF,
    update(dt) { t += dt; rob.update(dt); mist.forEach((m, i) => { m.position.x = wx - .42 + ((t * .08 + i * .3) % .84); m.material.opacity = .25 + .12 * Math.sin(t + i); }); shape.material.opacity = .6 + .15 * Math.sin(t * .8); wheel.rotation.z = Math.sin(t * .3) * .08; },
  };
}
