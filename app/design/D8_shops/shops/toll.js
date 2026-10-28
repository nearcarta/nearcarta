// Toll (static): a bridge off the island into the fog, the other chains. Real MPC signature for Base Sepolia, 11 of 16 nodes.
import { THREE, room, put, makeRobot, C, D7 } from '../js/core.js';
import { MPC } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, acct } from './_ui.js';

export default async function toll() {
  const T = [[0, 0], [-1, 0], [0, 1], [-1, 1], [1, -1], [0, -1], [2, -1, 'hex_water'], [1, 0, 'hex_water'], [2, 0, 'hex_water'], [1, 1, 'hex_water'], [3, -1, 'hex_water']];
  const { scene, camera } = await room({ tiles: T, cam: [-1.2, 4.4, 8.6], look: [1.4, .4, 0] });
  scene.traverse(m => { if (m.isMesh && /water/i.test(m.material.name || '')) { m.material = m.material.clone(); m.material.color.set(0x8fa3ab); } });
  await put(scene, 'buildings/neutral/building_bridge_A', { x: 2.9, z: .3, ry: Math.PI / 2, fitW: 2.2 }).catch(() => null);
  await put(scene, 'buildings/blue/building_tower_base_blue', { x: -1.2, z: -.6, fitW: 1.4 });
  // the far shore is only an outline in the fog
  const fog = new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.14, .2, 6), new THREE.MeshStandardMaterial({ color: C.muted, transparent: true, opacity: .14, depthWrite: false })); fog.position.set(5.6, 0, .3); scene.add(fog);
  scene.fog = new THREE.Fog(C.base, 9, 15);
  const rob = await makeRobot(scene); rob.at(.6, .9); rob.g.rotation.y = Math.PI / 2;
  const sig = MPC.oathPay;
  return {
    scene, camera,
    tags: [{ pos: new THREE.Vector3(5.6, .6, .3), html: `<img src="${D7}assets/tokens/chains/base.svg" width="20" height="20" alt="Base">`, cls: 'bare' }],
    panel: { title: 'Toll', src: 'testnet', label: 'MPC signature for Base Sepolia', hero: `<b class="num">11</b><span class="unit">of ${MPC.nodes} nodes</span>`, action: null },
    proof: proof(h3('Signed under the oath'), row({ k: `Pay ${sig.wei} wei to ${sig.to.slice(0, 8)}…`, why: `${MPC.signer} v${MPC.version} · ${sig.secs} s`, st: 'ok', stText: 'signed', tx: sig.tx }),
      row({ k: 'Broadcast on Base Sepolia', why: 'not confirmed in this run', st: 'pend', stText: 'pending', src: 'none' }),
      h3('Refused before signing'), ...MPC.refusals.map(r => row({ k: r.what, st: 'no', stText: 'refused', tx: r.tx })),
      h3('Bitcoin check'), row({ k: `BTC tx verified · ${MPC.btcVerify.conf} confirmations`, why: MPC.btcVerify.secs + ' s', st: 'ok', stText: 'verified', tx: MPC.btcVerify.tx }),
      note(`Oath ${acct(MPC.oath)}. Threshold ${MPC.threshold} of ${MPC.nodes} is the testnet MPC network's own setting.`)),
    update(dt) { rob.update(dt); },
  };
}
