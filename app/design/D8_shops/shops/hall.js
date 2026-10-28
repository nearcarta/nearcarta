// Town Hall: a council table with vote stones. Proposal 4 (real, testnet) lowered the reward cap from 0.25 to 0.15 NEAR.
import { THREE, room, put, makeRobot, sfx, wait, tween, tok, C } from '../js/core.js';
import { TH } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, acct, paper } from './_ui.js';
import { M as PM, brassM, mesh, lantern, banner, candle, rug } from './_props.js';

// Proof list at module level so the 2D view (js/flat.js) can show it without building the scene.
export const PROOF = proof(
      h3('Proposal 4'), row({ k: 'Filed', why: TH.proposal.tag, tx: TH.proposal.filed }), ...TH.proposal.votes.map((v, i) => row({ k: `Vote ${i + 1}`, why: 'council · approve', st: 'ok', stText: 'counted', tx: v })),
      h3('Oath versions'), ...TH.versions.map(v => row({ k: `v${v.v} · cap ${v.cap} · total ${v.total} NEAR`, why: v.how, tx: v.tx })),
      h3('What the hall refused'), ...TH.log.filter(l => !l.ok).map(l => row({ k: `${l.who} ${l.what}`, why: l.res, st: 'no', stText: 'refused', tx: l.tx })),
      note(`DAO ${acct(TH.dao)}. All rows are real testnet transactions; the stones are a re-enactment.`));
export default async function hall(ctx) {
  const { scene, camera } = await room({ cam: [0, 4.4, 8.6], look: [0, .8, 0] });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .85 }), stone = PM.stone;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, .1, 32), wood); top.position.y = .62; const leg = new THREE.Mesh(new THREE.CylinderGeometry(.16, .26, .6, 12), wood); leg.position.y = .3;
  [top, leg].forEach(m => { m.castShadow = m.receiveShadow = true; scene.add(m); });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.26, .18, .1, 20, 1, true), stone); bowl.material.side = THREE.DoubleSide; bowl.position.y = .72; scene.add(bowl);
  const stools = [[-1.4, .5], [1.4, .5]].map(([x, z]) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .4, 12), wood); s.position.set(x, .2, z); s.castShadow = true; scene.add(s); return s; });
  // the oath plaque: a slab with a cap gauge (height = cap)
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.7, .16), stone); slab.position.set(0, .85, -1.7); slab.castShadow = slab.receiveShadow = true; scene.add(slab);
  // the cap dial: a brass-rimmed half dial, 0 to 0.30 NEAR; mint below the new cap, brass up to the old one, coral beyond
  const RNG = .30, face = paper(THREE, 512, 300, (x, w, h) => {
    const cx = w / 2, cy = h - 34, R = 210, ang = c => Math.PI + (c / RNG) * Math.PI;
    x.fillStyle = '#1f1a15'; x.beginPath(); x.arc(cx, cy, R + 26, Math.PI, 0); x.lineTo(cx + R + 26, h); x.lineTo(cx - R - 26, h); x.fill();
    x.strokeStyle = '#d6b46a'; x.lineWidth = 10; x.beginPath(); x.arc(cx, cy, R + 20, Math.PI, 0); x.stroke();
    [[0, .15, '#00ec97'], [.15, .25, '#d6b46a'], [.25, .30, '#ff6b6b']].forEach(([a0, a1, c]) => { x.strokeStyle = c; x.lineWidth = 22; x.beginPath(); x.arc(cx, cy, R - 14, ang(a0) + .01, ang(a1) - .01); x.stroke(); });
    for (let i = 0; i <= 30; i++) { const a = ang(i / 100), maj = i % 5 === 0, r0 = R - (maj ? 58 : 40); x.strokeStyle = maj ? '#f3ead8' : '#9c9182'; x.lineWidth = maj ? 5 : 2; x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30)); x.stroke(); }
    x.fillStyle = '#f3ead8'; x.font = '600 28px Inter, sans-serif'; x.textAlign = 'center'; [[.15, '0.15'], [.25, '0.25']].forEach(([c, t]) => { const a = ang(c); x.fillText(t, cx + Math.cos(a) * (R - 92), cy + Math.sin(a) * (R - 92) + 10); });
  });
  const dial = mesh(scene, new THREE.PlaneGeometry(1.1, 1.1 * 300 / 512), new THREE.MeshStandardMaterial({ map: face, roughness: .6 }), [0, 1.18, -1.615], { cast: false });
  const piv = new THREE.Group(); piv.position.set(0, 1.18 - (1.1 * 300 / 512) / 2 + 1.1 * 34 / 512, -1.6); scene.add(piv);
  const mkNeedle = (col, op = 1) => { const n = new THREE.Mesh(new THREE.BoxGeometry(.03, .36, .012), new THREE.MeshStandardMaterial({ color: col, metalness: .6, roughness: .35, transparent: op < 1, opacity: op })); n.geometry.translate(0, .18, 0); const g = new THREE.Group(); g.add(n); piv.add(g); return g; };
  const ghost = mkNeedle(0x9c9182, .55); ghost.visible = false; const needle = mkNeedle(C.accent);
  mesh(scene, new THREE.CylinderGeometry(.045, .045, .03, 20), brassM(), [piv.position.x, piv.position.y, -1.585], { rx: Math.PI / 2 });
  const capAng = c => Math.PI / 2 - (c / RNG) * Math.PI;
  const setCap = c => needle.rotation.z = capAng(c); setCap(.25);
  // brass frame on the slab, banners either side, candles and the vote bowl on the table
  mesh(scene, new THREE.BoxGeometry(1.36, .05, .2), brassM(), [0, 1.72, -1.7]); mesh(scene, new THREE.BoxGeometry(1.36, .05, .2), brassM(), [0, .02, -1.7]);
  banner(scene, -.98, 1.65, -1.62, 0xa8644a, { w: .38, h: .95 }); banner(scene, .98, 1.65, -1.62, 0xa8644a, { w: .38, h: .95 });
  candle(scene, -.55, .67, -.35); candle(scene, .55, .67, -.35); candle(scene, 0, .67, .7);
  rug(scene, 0, .2, 3.2, 2.2); lantern(scene, -2.1, -1.2, { h: 1.4 }); lantern(scene, 2.1, -1.2, { h: 1.4, light: false });
  await put(scene, 'decoration/props/crate_A_big', { x: -2.3, z: -.5, ry: .4, fitW: .45 });
  await put(scene, 'decoration/props/flag_blue', { x: -1.6, z: -1.5 });
  const stones = [0, 1].map(i => { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 0), new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: .8 })); s.castShadow = true; s.position.set(stools[i].position.x * .75, .78, .4); scene.add(s); return s; });
  const rob = await makeRobot(scene); rob.at(1.9, 3.2);
  const v2 = TH.versions[1], v3 = TH.versions[2];
  return {
    scene, camera, tags: [],
    panel: { title: 'Town Hall', src: 'testnet', label: 'Reward cap · Proposal 4', hero: tok('0.25', 'NEAR'), action: 'Count the votes' },
    proof: PROOF,
    *intro() { setCap(v2.cap); yield rob.walk([new THREE.Vector3(1.2, 0, -1.2)]); rob.lookAt(slab.position); },
    *act() {
      for (const s of stones) { const y0 = s.position.y, p0 = s.position.clone(); sfx('click'); yield tween(.5, k => { s.position.lerpVectors(p0, new THREE.Vector3(stones.indexOf(s) ? .05 : -.05, .74, 0), k); s.position.y = y0 + Math.sin(k * Math.PI) * .35 - .04 * k; }); yield wait(.25); }
      yield wait(.2); sfx('swap');
      ghost.rotation.z = capAng(v2.cap); ghost.visible = true;
      yield tween(.9, k => setCap(v2.cap + (v3.cap - v2.cap) * k), k => 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * .06);
      ctx.setHero(tok('0.15', 'NEAR')); ctx.setResult('ok', 'Passed · 2 votes'); sfx('allowed'); rob.lookAt(camera.position); rob.play('Yes', { once: true }); yield wait(1.4); rob.play('Idle');
    },
    update(dt) { rob.update(dt); },
  };
}
