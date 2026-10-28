// Town Hall: a council table with vote stones. Proposal 4 (real, testnet) lowered the reward cap from 0.25 to 0.15 NEAR.
import { THREE, room, put, makeRobot, sfx, wait, tween, tok, C } from '../js/core.js';
import { TH } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, acct } from './_ui.js';

export default async function hall(ctx) {
  const { scene, camera } = await room({ cam: [0, 4.4, 8.6], look: [0, .8, 0] });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .85 }), stone = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: .95 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, .1, 32), wood); top.position.y = .62; const leg = new THREE.Mesh(new THREE.CylinderGeometry(.16, .26, .6, 12), wood); leg.position.y = .3;
  [top, leg].forEach(m => { m.castShadow = m.receiveShadow = true; scene.add(m); });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.26, .18, .1, 20, 1, true), stone); bowl.material.side = THREE.DoubleSide; bowl.position.y = .72; scene.add(bowl);
  const stools = [[-1.4, .5], [1.4, .5]].map(([x, z]) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .4, 12), wood); s.position.set(x, .2, z); s.castShadow = true; scene.add(s); return s; });
  // the oath plaque: a slab with a cap gauge (height = cap)
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.7, .16), stone); slab.position.set(0, .85, -1.7); slab.castShadow = slab.receiveShadow = true; scene.add(slab);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(.2, 1.2), new THREE.MeshBasicMaterial({ color: C.base })); track.position.set(0, .9, -1.61); scene.add(track);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(.2, 1.2), new THREE.MeshBasicMaterial({ color: C.text })); fill.geometry.translate(0, .6, 0); fill.position.set(0, .3, -1.605); scene.add(fill);
  const MAX = .25; const setCap = c => fill.scale.y = c / MAX;
  await put(scene, 'decoration/props/flag_blue', { x: -1.3, z: -1.5 }).then(o => o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.set(0x9aa0aa); } }));
  const stones = [0, 1].map(i => { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 0), new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: .8 })); s.castShadow = true; s.position.set(stools[i].position.x * .75, .78, .4); scene.add(s); return s; });
  const rob = await makeRobot(scene); rob.at(1.9, 3.2);
  const v2 = TH.versions[1], v3 = TH.versions[2];
  return {
    scene, camera, tags: [],
    panel: { title: 'Town Hall', src: 'testnet', label: 'Reward cap · Proposal 4', hero: tok('0.25', 'NEAR'), action: 'Count the votes' },
    proof: proof(
      h3('Proposal 4'), row({ k: 'Filed', why: TH.proposal.tag, tx: TH.proposal.filed }), ...TH.proposal.votes.map((v, i) => row({ k: `Vote ${i + 1}`, why: 'council · approve', st: 'ok', stText: 'counted', tx: v })),
      h3('Oath versions'), ...TH.versions.map(v => row({ k: `v${v.v} · cap ${v.cap} · total ${v.total} NEAR`, why: v.how, tx: v.tx })),
      h3('What the hall refused'), ...TH.log.filter(l => !l.ok).map(l => row({ k: `${l.who} ${l.what}`, why: l.res, st: 'no', stText: 'refused', tx: l.tx })),
      note(`DAO ${acct(TH.dao)}. All rows are real testnet transactions; the stones are a re-enactment.`)),
    *intro() { setCap(v2.cap); yield rob.walk([new THREE.Vector3(1.2, 0, -1.2)]); rob.lookAt(slab.position); },
    *act() {
      for (const s of stones) { const y0 = s.position.y, p0 = s.position.clone(); sfx('click'); yield tween(.5, k => { s.position.lerpVectors(p0, new THREE.Vector3(stones.indexOf(s) ? .05 : -.05, .74, 0), k); s.position.y = y0 + Math.sin(k * Math.PI) * .35 - .04 * k; }); yield wait(.25); }
      yield wait(.2); sfx('swap');
      yield tween(.8, k => setCap(v2.cap + (v3.cap - v2.cap) * k));
      ctx.setHero(tok('0.15', 'NEAR')); ctx.setResult('ok', 'Passed · 2 votes'); sfx('allowed'); rob.lookAt(camera.position); rob.play('Yes', { once: true }); yield wait(1.4); rob.play('Idle');
    },
    update(dt) { rob.update(dt); },
  };
}
