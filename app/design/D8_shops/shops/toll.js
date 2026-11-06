// Toll: the live policy sets the fee. The recorded payments are in mainnet.json.
import { THREE, room, put, makeRobot, C, D7, wait, tween, hx } from '../js/core.js';
import { MPC } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, acct, mainnet } from './_ui.js';
import { M as PM, brassM, mesh, lantern } from './_props.js';

// Proof list at module level so the 2D view (js/flat.js) can show it without building the scene.
const sig = MPC.oathPay;
export const PROOF = mainnet('toll') + proof(h3('Signed under the oath'), row({ k: 'NEAR toll allowed', why: acct(MPC.oath), st: 'ok', stText: 'allowed', tx: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz' }),
      h3('Refused before signing'), row({ k: 'Payee not on the list', why: 'Nothing was paid.', st: 'no', stText: 'refused', tx: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR' }));
export default async function toll() {
  // Grass first so the door can open. Water, the bridge and the tower arrive after the tray is up.
  const T = [[0, 0], [-1, 0], [0, 1], [-1, 1], [1, -1], [0, -1]];
  const { scene, camera } = await room({ tiles: T, cam: [-1.2, 4.4, 8.6], look: [1.4, .4, 0] });
  for (const [q, r, kind] of [[2, -1, 'hex_water'], [1, 0, 'hex_water'], [2, 0, 'hex_water'], [1, 1, 'hex_water'], [3, -1, 'hex_water']]) {
    const p = hx(q, r);
    put(scene, 'tiles/base/' + kind, { x: p.x, z: p.z }).catch(() => null);
  }
  put(scene, 'buildings/neutral/building_bridge_A', { x: 2.9, z: .3, ry: Math.PI / 2, fitW: 2.2 }).catch(() => null);
  put(scene, 'buildings/blue/building_tower_base_blue', { x: -1.2, z: -.6, fitW: 1.4 }).catch(() => null);
  // the far shore is only an outline in the fog
  const fog = new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.14, .2, 6), new THREE.MeshStandardMaterial({ color: C.muted, transparent: true, opacity: .14, depthWrite: false })); fog.position.set(5.6, 0, .3); scene.add(fog);
  scene.fog = new THREE.Fog(C.base, 9, 15);
  // the toll gate at the bridge head: a striped boom across the road, and the 16 MPC node stones in an arc; 11 lit = the signers
  const bx = 1.2, bz = .3;
  mesh(scene, new THREE.BoxGeometry(.14, .7, .14), PM.dark, [bx, .35, bz - .62]); mesh(scene, new THREE.BoxGeometry(.18, .06, .18), brassM(), [bx, .72, bz - .62]);
  const boom = new THREE.Group(); boom.position.set(bx, .62, bz - .62); scene.add(boom);
  for (let i = 0; i < 6; i++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .22), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xeef2ff : 0xa8644a, roughness: .8 })); seg.position.z = .14 + i * .22; seg.castShadow = true; boom.add(seg); }
  let actGen = 0;
  const lit = new THREE.MeshStandardMaterial({ color: C.ok, emissive: C.ok, emissiveIntensity: .9, roughness: .4 });
  const stones = 6;
  for (let i = 0; i < stones; i++) { const a = Math.PI * .55 + (i / (stones - 1)) * Math.PI * .9, r = .95; mesh(scene, new THREE.CylinderGeometry(.06, .075, .16, 6), lit, [bx - .15 + Math.cos(a) * r, .08, bz + Math.sin(a) * r]); }
  lantern(scene, 1.75, 1.2, { h: 1.1 });
  // The robot is the slow mesh. The tray opens on the grass; the figure walks in when the file arrives.
  const rob = { play() {}, update() {}, g: { rotation: { y: 0 } } };
  makeRobot(scene).then(real => {
    real.at(1.75, -.95);
    real.g.rotation.y = -.35;
    rob.play = (...args) => real.play(...args);
    rob.update = dt => real.update(dt);
    rob.g = real.g;
  }).catch(() => null);
  const tags = [
    { pos: new THREE.Vector3(5.6, .6, .3), html: '<img src="/tokens/chains/base.svg" width="20" height="20" alt="Base">', cls: 'bare' },
    { pos: new THREE.Vector3(bx, 1.35, bz), html: '<b data-testid="toll-seal-3d">Pass refused</b>', cls: 'no hide' },
  ];
  const hideRefuse = () => {
    const el = tags[1]?.el;
    if (!el) return;
    el.classList.add('hide');
    el.setAttribute('hidden', '');
  };
  const showRefuse = () => {
    const el = tags[1]?.el;
    if (!el) return;
    el.classList.remove('hide');
    el.removeAttribute('hidden');
    try { rob.play('No', { once: true }); } catch { /* the seal still shows */ }
  };
  return {
    rob, scene, camera, tags, hideRefuse, showRefuse,
    panel: { title: 'Toll', src: 'mainnet', srcNote: 'The fee comes from the live policy. A refusal pays nothing.', label: 'Live policy', hero: '<b class="num">Policy</b><span class="unit">fee</span>', action: null },
    proof: PROOF,
    *act(opts = {}) {
      if (!opts.success && !opts.basePaid) return;
      const mine = ++actGen;
      hideRefuse();
      boom.rotation.x = 0;
      yield tween(1.1, k => { if (mine === actGen) boom.rotation.x = -1.15 * k; });
      if (mine !== actGen) return;
      try { rob.play('Yes', { once: true }); } catch { /* the boom still lifts */ }
      yield wait(.8);
      if (mine !== actGen) return;
      try { rob.play('Idle'); } catch { /* pose is optional */ }
    },
    update(dt) { rob.update(dt); },
  };
}
