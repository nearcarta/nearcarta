// Chronicle (static): the crier's scroll. One mark per real decision from the core mainnet run; refusals in the refused colour.
import { THREE, room, put, makeRobot, C, CSS, tween } from '../js/core.js';
import { M as PM, brassM, mesh, lantern, banner, candle, rug } from './_props.js';
import { CORE_TXS, CORE, CLAUSES } from '../../D6_dashboards/src/data.js';
import { explain, replayPlan } from '../js/why.js';
import { row, h3, note, proof, paper, acct, esc } from './_ui.js';

// Proof list at module level so the 2D view (js/flat.js) can show it without building the scene.
const acts = CORE_TXS.filter(t => t.kind === 'action');
const whyOf = a => { if (!a.reason) return a.clause.replaceAll('_', ' '); const e = explain(a, CLAUSES); return `${e.rule}: ${e.plain}`; };
const REPLAY = `<div class="replay" data-testid="replay"><h3>Replay the run</h3><p class="note">The same ${acts.length} decisions at their recorded spacing, sped up.</p>
  <p>${[1, 8, 32].map(x => `<button type="button" class="rc" data-replay="${x}" data-testid="replay-${x}">${x}×</button>`).join(' ')}</p><ol class="feed" data-testid="replay-feed"></ol></div>`;
export const PROOF = proof(h3('Every action the agent tried'), ...acts.map(a => row({ k: a.what, why: whyOf(a), st: a.decision === 'denied' ? 'no' : a.decision === 'allowed' ? 'ok' : 'pend', stText: a.decision, tx: a.tx })), note(`Oath ${acct(CORE.oath)}. One mark on the scroll per row. Each refusal says which rule the contract applied and the numbers it compared.`), REPLAY);
// one delegated listener: works in the 3D drawer and the 2D view alike
let timers = [];
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-replay]'); if (!b) return;
  const feed = b.closest('.replay')?.querySelector('[data-testid="replay-feed"]'); if (!feed) return;
  timers.forEach(clearTimeout); timers = []; feed.innerHTML = '';
  for (const { at, act } of replayPlan(acts, +b.dataset.replay)) timers.push(setTimeout(() => {
    const st = act.decision === 'denied' ? 'no' : act.decision === 'allowed' ? 'ok' : 'pend';
    feed.insertAdjacentHTML('beforeend', `<li class="${st}"><span>${esc(act.time)}</span><span>${esc(act.what)}</span><span>${esc(act.decision)}${act.reason ? ' · ' + esc(explain(act, CLAUSES).rule) : ''}</span></li>`);
  }, at));
});
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
  // the crier's square: a brass bell on a yoke, a lectern with the day's seal, rolled scrolls waiting, lanterns either side
  mesh(scene, new THREE.BoxGeometry(.08, 1.6, .08), PM.dark, [-2.0, .8, -.2]); mesh(scene, new THREE.BoxGeometry(.08, 1.6, .08), PM.dark, [-1.5, .8, -.2]); mesh(scene, new THREE.BoxGeometry(.66, .08, .1), PM.dark, [-1.75, 1.6, -.2]);
  const bell = mesh(scene, new THREE.CylinderGeometry(.08, .19, .3, 20, 1, true), brassM(), [-1.75, 1.38, -.2]); bell.material.side = THREE.DoubleSide; mesh(scene, new THREE.SphereGeometry(.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), brassM(), [-1.75, 1.53, -.2]);
  mesh(scene, new THREE.SphereGeometry(.035, 8, 6), PM.dark, [-1.75, 1.22, -.2]);
  mesh(scene, new THREE.BoxGeometry(.1, .8, .1), PM.wood, [1.75, .4, .5]); mesh(scene, new THREE.BoxGeometry(.5, .05, .38), PM.wood, [1.75, .83, .5], { rx: .5 }); mesh(scene, new THREE.BoxGeometry(.4, .012, .28), new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 1 }), [1.75, .863, .515], { rx: .5 }); // the day's sheet, tilted to the viewer
  const seal = mesh(scene, new THREE.CylinderGeometry(.06, .06, .02, 20), new THREE.MeshStandardMaterial({ color: 0xc0463e, roughness: .5, emissive: 0x3a0c08 }), [1.84, .88, .53], { rx: .5 });
  const scroll = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 1 }); [[-1.25, .2, .55, 0], [-1.05, .2, .7, .5], [-1.15, .34, .62, .25]].forEach(([x, y, z, r]) => mesh(scene, new THREE.CylinderGeometry(.06, .06, .5, 12), scroll, [x, y - .1, z], { rz: Math.PI / 2, ry: r }));
  banner(scene, -.85, 2.25, -.05, 0xa8644a, { w: .2, h: .45 }); banner(scene, .85, 2.25, -.05, 0xa8644a, { w: .2, h: .45 });
  lantern(scene, -2.35, .7, { h: 1.3 }); lantern(scene, 2.05, -1.25, { h: 1.3, light: false }); rug(scene, 0, 1.0, 2.6, 1.3, 0x5e3427);
  await put(scene, 'decoration/props/crate_A_big', { x: 1.6, z: -1.75, ry: .4, fitW: .42 }).catch(() => null);
  const rob = await makeRobot(scene); rob.at(.6, 1.25); rob.lookAt(new THREE.Vector3(.2, 0, 3));
  const tags = [{ obj: seal, pos: new THREE.Vector3(0, .16, 0), html: 'Entry refused', cls: 'no hide' }];
  const hideRefuse = () => {
    const el = tags[0].el;
    if (!el) return;
    el.classList.add('hide');
    el.setAttribute('hidden', '');
  };
  const showRefuse = (text) => {
    const el = tags[0].el;
    if (!el) return;
    el.textContent = text || 'Entry refused';
    el.classList.remove('hide');
    el.removeAttribute('hidden');
  };
  function* act(opts = {}) {
    if (!opts.success || !opts.tx) return;
    hideRefuse();
    const base = bell.rotation.z;
    yield tween(.7, k => { bell.rotation.z = base + Math.sin(k * Math.PI * 3) * .4 * (1 - k); });
    bell.rotation.z = base;
  }
  return {
    rob, scene, camera, tags, hideRefuse, showRefuse, act,
    panel: { title: 'Chronicle', src: 'mainnet', label: 'Public ledger', hero: `<b class="num">${denied.length}</b><span class="unit">of ${acts.length} actions</span>`, action: null },
    proof: PROOF,
    update(dt) { rob.update(dt); },
  };
}
