// Your House (static): the oath hangs on the wall as a charter. Real policy v4 of the core oath. No action here: freezing is the owner's key, not a demo button.
import { THREE, room, put, makeRobot, tok, C } from '../js/core.js';
import { CORE, CLAUSES } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, paper, acct, mainnet } from './_ui.js';
import { M as PM, brassM, mesh, lantern, candle, rug } from './_props.js';
import { radial } from '../js/core.js';

// Proof list at module level so the 2D view (js/flat.js) can show it without building the scene.
export const PROOF = mainnet('house') + proof(h3('The oath'), row({ k: 'Policy version ' + CORE.policyVersion, why: CORE.policyHash.slice(0, 16) + '…' }), row({ k: 'Contract code', why: CORE.codeHash }), row({ k: 'Freeze epoch ' + CORE.freezeEpoch, why: 'the owner can freeze' }),
      h3('Clauses'), ...CLAUSES.map(c => row({ k: `${c.id} · cap ${c.cap} · budget ${c.budget} NEAR`, why: `spent ${c.spent} · payee ${c.payees.join(', ')}`, tx: c.tx })),
      note(`Oath ${acct(CORE.oath)}, owner ${acct(CORE.owner)}. Snapshot ${CORE.snapshot}.`));
export default async function house() {
  const { scene, camera } = await room({ cam: [-1.6, 3.4, 7.8], look: [0, 1, 0] });
  const plaster = new THREE.MeshStandardMaterial({ color: 0xc8bba4, roughness: 1 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, .16), plaster); wall.position.set(0, 1.1, -.9); wall.castShadow = wall.receiveShadow = true; scene.add(wall);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.3, .06), new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: .7 })); frame.position.set(0, 1.25, -.79); scene.add(frame);
  const tex = paper(THREE, 256, 320, (x, w, h) => { x.fillStyle = '#e9e3d6'; x.fillRect(0, 0, w, h); x.fillStyle = '#6f675c'; x.fillRect(60, 30, 136, 8); for (let i = 0; i < 7; i++) x.fillRect(30, 76 + i * 28, 150 + (i * 29) % 46, 5); x.strokeStyle = '#8a3b36'; x.lineWidth = 4; x.beginPath(); x.arc(w - 56, h - 50, 22, 0, 7); x.stroke(); });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(.92, 1.16), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })); sheet.position.set(0, 1.25, -.755); scene.add(sheet);
  await put(scene, 'decoration/props/barrel', { x: 2.0, z: -.45 });
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .42, 12), new THREE.MeshStandardMaterial({ color: 0x6b4a33 })); stool.position.set(.9, .21, .9); stool.castShadow = true; scene.add(stool);
  // a lived-in room: hearth with a low fire, a warm window, the owner's freeze key under an ice-glass bell on the side table, books, a rug
  const hx0 = -1.15; mesh(scene, new THREE.BoxGeometry(.9, .75, .3), PM.stone, [hx0, .375, -.72]); mesh(scene, new THREE.BoxGeometry(1.0, .08, .36), PM.stone, [hx0, .78, -.72]);
  mesh(scene, new THREE.BoxGeometry(.56, .42, .05), new THREE.MeshBasicMaterial({ color: 0x3a2618 }), [hx0, .3, -.565]);
  // the fire itself, visible: two logs and three flame tongues (brass core, coral edge)
  [-.09, .09].forEach((dx, i) => mesh(scene, new THREE.CylinderGeometry(.035, .035, .34, 8), PM.wood, [hx0 + dx * .3, .13 + i * .03, -.5], { rz: Math.PI / 2, ry: dx * 2 }));
  const flames = [[-.1, .16, .2], [0, .21, .27], [.1, .15, .19]].map(([dx, h, y]) => mesh(scene, new THREE.ConeGeometry(.055, h, 6), new THREE.MeshBasicMaterial({ color: dx ? 0xff8a4a : 0xffd27a }), [hx0 + dx, y, -.5], { cast: false }));
  const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('#ff9a4a'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .9 })); fire.scale.set(.5, .45, 1); fire.position.set(hx0, .26, -.53); scene.add(fire);
  const fl = new THREE.PointLight(0xff9a4a, 1.6, 2.8, 1.6); fl.position.set(hx0, .4, -.3); scene.add(fl);
  candle(scene, hx0 - .3, .82, -.72); candle(scene, hx0 + .3, .82, -.72);
  const wx = 1.15; mesh(scene, new THREE.BoxGeometry(.66, .8, .06), PM.dark, [wx, 1.35, -.8]); mesh(scene, new THREE.PlaneGeometry(.56, .7), new THREE.MeshBasicMaterial({ color: 0xf1d9a8 }), [wx, 1.35, -.765], { cast: false });
  mesh(scene, new THREE.BoxGeometry(.04, .7, .02), PM.dark, [wx, 1.35, -.755]); mesh(scene, new THREE.BoxGeometry(.56, .04, .02), PM.dark, [wx, 1.35, -.755]);
  // side table + key under glass
  const tx = 1.55, tz = .35; mesh(scene, new THREE.CylinderGeometry(.3, .3, .05, 24), PM.wood, [tx, .62, tz]); mesh(scene, new THREE.CylinderGeometry(.04, .06, .6, 8), PM.dark, [tx, .3, tz]);
  const key = new THREE.Group(); key.position.set(tx, .67, tz); key.rotation.y = .6; scene.add(key);
  const kb = new THREE.Mesh(new THREE.TorusGeometry(.045, .014, 8, 20), brassM()); kb.rotation.x = Math.PI / 2; key.add(kb); const ks = new THREE.Mesh(new THREE.BoxGeometry(.16, .018, .018), brassM()); ks.position.x = .11; key.add(ks);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: C.ice, transparent: true, opacity: .28, roughness: .1, metalness: .1, depthWrite: false })); dome.position.set(tx, .645, tz); scene.add(dome);
  // books on a shelf
  mesh(scene, new THREE.BoxGeometry(.9, .04, .22), PM.wood, [1.15, .78, -.7]); ['#7a3e2c', '#3f6f6d', '#a8644a', '#6b4a33', '#52653b', '#d6b46a'].forEach((c, i) => mesh(scene, new THREE.BoxGeometry(.07, .2 + (i % 3) * .03, .16), new THREE.MeshStandardMaterial({ color: c, roughness: .9 }), [.8 + i * .09, .9 + (i % 3) * .015, -.7]));
  rug(scene, -.2, .8, 2.4, 1.5, 0x7a3e2c); lantern(scene, -2.0, .9, { h: 1.3, light: false });
  const rob = await makeRobot(scene); rob.at(.25, 1.05); rob.lookAt(sheet.position);
  const seal = new THREE.Mesh(new THREE.CircleGeometry(.22, 24), new THREE.MeshBasicMaterial({ color: 0x8a3b36, transparent: true, opacity: 0 }));
  seal.position.set(0, 1.25, -.72); seal.visible = false; scene.add(seal);
  const tip = CLAUSES[0]; let tt = 0, flare = 0;
  const showSeal = () => { seal.visible = true; seal.material.opacity = 0.95; };
  const hideSeal = () => { seal.visible = false; seal.material.opacity = 0; };
  const deliver = () => { flare = 2.6; hideSeal(); };
  return {
    rob, scene, camera, tags: [], showSeal, hideSeal, deliver,
    panel: { title: 'Your House', src: 'split', srcNote: 'house.nearcarta.near is on mainnet. A charter you create is the mainnet charter.', label: `Tip cap · policy v${CORE.policyVersion}`, hero: tok(String(tip.cap), 'NEAR'), action: null },
    proof: PROOF,
    update(dt) { tt += dt; rob.update(dt); fire.material.opacity = .75 + .2 * Math.sin(tt * 9) * Math.sin(tt * 3.7); flames.forEach((f, i) => f.scale.y = 1 + .18 * Math.sin(tt * (7 + i * 2.3) + i)); fl.intensity = 1.4 + .3 * Math.sin(tt * 7); if (flare > 0) { flare = Math.max(0, flare - dt); fl.intensity += flare * 1.4; } },
  };
}
