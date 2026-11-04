// Toll (static): a bridge off the island into the fog, the other chains. Real MPC signature for Base Sepolia, 11 of 16 nodes.
import { THREE, room, put, makeRobot, C, D7 } from '../js/core.js';
import { MPC } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, acct, mainnet } from './_ui.js';
import { M as PM, brassM, mesh, lantern } from './_props.js';

// Proof list at module level so the 2D view (js/flat.js) can show it without building the scene.
const sig = MPC.oathPay;
export const PROOF = mainnet('toll') + proof(h3('Signed under the oath'), row({ k: `Pay ${sig.wei} wei to ${sig.to.slice(0, 8)}…`, why: `${MPC.signer} v${MPC.version} · ${sig.secs} s`, st: 'ok', stText: 'signed', tx: sig.tx }),
      row({ k: 'Broadcast on Base Sepolia', why: 'tx 0x86bab7…9054 · nonce 0', st: 'ok', stText: 'confirmed', src: 'none' }) + note('<a class="tx" href="https://sepolia.basescan.org/tx/0x86bab7a98f872cec2e60ac2a549d1154f7cb330b9aeb073ff191b57a42ef9054" target="_blank" rel="noopener">Base Sepolia tx ↗</a>'),
      h3('Refused before signing'), ...MPC.refusals.map(r => row({ k: r.what, st: 'no', stText: 'refused', tx: r.tx })),
      h3('Bitcoin check'), row({ k: `BTC tx verified · ${MPC.btcVerify.conf} confirmations`, why: MPC.btcVerify.secs + ' s', st: 'ok', stText: 'verified', tx: MPC.btcVerify.tx }),
      note(`Oath ${acct(MPC.oath)}. Threshold ${MPC.threshold} of ${MPC.nodes} is the testnet MPC network's own setting.`));
export default async function toll() {
  const T = [[0, 0], [-1, 0], [0, 1], [-1, 1], [1, -1], [0, -1], [2, -1, 'hex_water'], [1, 0, 'hex_water'], [2, 0, 'hex_water'], [1, 1, 'hex_water'], [3, -1, 'hex_water']];
  const { scene, camera } = await room({ tiles: T, cam: [-1.2, 4.4, 8.6], look: [1.4, .4, 0] });
  await put(scene, 'buildings/neutral/building_bridge_A', { x: 2.9, z: .3, ry: Math.PI / 2, fitW: 2.2 }).catch(() => null);
  await put(scene, 'buildings/blue/building_tower_base_blue', { x: -1.2, z: -.6, fitW: 1.4 });
  // the far shore is only an outline in the fog
  const fog = new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.14, .2, 6), new THREE.MeshStandardMaterial({ color: C.muted, transparent: true, opacity: .14, depthWrite: false })); fog.position.set(5.6, 0, .3); scene.add(fog);
  scene.fog = new THREE.Fog(C.base, 9, 15);
  // the toll gate at the bridge head: a striped boom across the road, and the 16 MPC node stones in an arc; 11 lit = the signers
  const bx = 1.2, bz = .3;
  mesh(scene, new THREE.BoxGeometry(.14, .7, .14), PM.dark, [bx, .35, bz - .62]); mesh(scene, new THREE.BoxGeometry(.18, .06, .18), brassM(), [bx, .72, bz - .62]);
  const boom = new THREE.Group(); boom.position.set(bx, .62, bz - .62); scene.add(boom);
  for (let i = 0; i < 6; i++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .22), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf3ead8 : 0xa8644a, roughness: .8 })); seg.position.z = .14 + i * .22; seg.castShadow = true; boom.add(seg); }
  const lit = new THREE.MeshStandardMaterial({ color: C.ok, emissive: C.ok, emissiveIntensity: .9, roughness: .4 }), off = PM.stone;
  for (let i = 0; i < MPC.nodes; i++) { const a = Math.PI * .55 + (i / (MPC.nodes - 1)) * Math.PI * .9, r = .95; mesh(scene, new THREE.CylinderGeometry(.06, .075, .16, 6), i >= MPC.nodes - 11 ? lit : off, [bx - .15 + Math.cos(a) * r, .08, bz + Math.sin(a) * r]); }
  lantern(scene, 1.75, 1.2, { h: 1.1 });
  const rob = await makeRobot(scene); rob.at(1.75, -.95); rob.g.rotation.y = -.35;
  const sig = MPC.oathPay;
  return {
    rob, scene, camera,
    tags: [{ pos: new THREE.Vector3(5.6, .6, .3), html: `<img src="${D7}assets/tokens/chains/base.svg" width="20" height="20" alt="Base">`, cls: 'bare' }],
    panel: { title: 'Toll', src: 'split', srcNote: 'toll.nearcarta.near is on mainnet. Paying the toll here is the free testnet trial.', label: 'MPC signature for Base Sepolia', hero: `<b class="num">11</b><span class="unit">of ${MPC.nodes} nodes</span>`, action: null },
    proof: PROOF,
    update(dt) { rob.update(dt); },
  };
}
