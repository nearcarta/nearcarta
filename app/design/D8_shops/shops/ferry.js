// Ferry: a cross-chain swap is cargo on a boat. The quote is a real keyless read; the crossing is a SAMPLE (no swap was executed).
import { THREE, room, put, makeRobot, sfx, wait, tween, easeInOut, tok, hx, C, desat } from '../js/core.js';
import { QUOTE, SIGNED, UNSIGNED, POOLS, CORE_TXS } from '../../D6_dashboards/src/data.js';
import { boat } from '../js/town.js';
import { row, h3, note, proof, esc } from './_ui.js';

export default async function ferry(ctx) {
  const T = []; for (let q = -3; q <= 3; q++) for (let r = -1; r <= 1; r++) { const x = 2 * q + r; if (Math.abs(x) > 4) continue; T.push([q, r, Math.abs(x) <= 1 ? 'hex_water' : 'hex_grass']); }
  const { scene, camera } = await room({ tiles: T, cam: [0, 5.4, 10.6], look: [0, .2, 0] });
  scene.traverse(m => { if (m.isMesh && /water/i.test(m.material.name || '')) { m.material = desat(m.material.clone(), .3); m.material.color.set(0x8fa3ab); } });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .9 });
  const jetty = (x, dir) => { const d = new THREE.Mesh(new THREE.BoxGeometry(1.0, .06, .5), wood); d.position.set(x, .12, .2); d.castShadow = d.receiveShadow = true; scene.add(d); };
  jetty(-1.75, 1); jetty(1.75, -1);
  await put(scene, 'decoration/props/barrel', { x: -3.1, z: -.5 }); await put(scene, 'decoration/props/sack', { x: 3.2, z: -.4, ry: 1 });
  const b = boat(new THREE.Vector3(-.85, -.02, .2)); b.scale.setScalar(1.25); scene.add(b);
  const crate = await put(scene, 'decoration/props/crate_A_small', { x: -2.0, y: .15, z: .25, fitW: .42 });
  const rob = await makeRobot(scene); rob.at(-3.6, 1.6);
  const icon = (sym, chain) => `<span class="tok">${tok(null, sym, { chain }).replace('<span class="sym">' + sym + '</span>', '')}</span>`;
  const tags = [{ obj: crate, pos: new THREE.Vector3(0, .9, 0), html: icon('USDC', 'Base'), cls: 'bare' }];
  const swapsTo = () => { tags[0].el.innerHTML = icon('NEAR', 'NEAR'); };
  const P1 = CORE_TXS.find(t => t.id === 'P1');
  let t = 0;
  return {
    scene, camera, tags,
    panel: { title: 'Ferry', src: 'live', srcNote: 'Quote read from 1Click without a key. No swap was executed.', label: 'Signed quote', hero: `${tok('3', 'USDC', { chain: 'Base' })}<span class="arrow" aria-hidden="true">→</span>${tok('0.640', 'NEAR')}`, action: 'Load the cargo' },
    proof: proof(
      h3('The quote · live read'), row({ k: `${QUOTE.from.amt} ${QUOTE.from.sym} on ${QUOTE.from.chain} → ${QUOTE.to.amt} ${QUOTE.to.sym}`, why: `ETA ${QUOTE.eta} · fee ${QUOTE.fee}`, src: 'live' }),
      h3(`What the signature covers · ${SIGNED.length} fields`), `<p class="kv">${SIGNED.map(esc).join(' · ')}</p>`,
      h3(`Not covered · ${UNSIGNED.length} fields`), `<p class="kv">${UNSIGNED.map(esc).join(' · ')}</p>`,
      h3('The crossing'), row({ k: 'Boat crosses, NEAR arrives', why: 'no swap was executed', src: 'sample' }),
      h3('Same oath, a real payment'), row({ k: P1.what, why: 'allowed by clause tip', st: 'ok', stText: 'allowed', tx: P1.tx }),
      h3('Pool depth · live read'), ...POOLS.map(p => row({ k: p.tok, why: p.size.toLocaleString('en-US') + ' ' + p.unit, src: 'live' }))),
    *intro() { yield rob.walk([new THREE.Vector3(-2.8, 0, .9)]); rob.lookAt(crate.position); },
    *act() {
      yield rob.walk([new THREE.Vector3(-2.45, 0, .55)]); rob.lookAt(crate.position); rob.play('Yes', { once: true }); yield wait(.4);
      sfx('send'); const c0 = crate.position.clone(), c1 = new THREE.Vector3(-.85, .36, .2);
      yield tween(.55, k => { crate.position.lerpVectors(c0, c1, k); crate.position.y += Math.sin(k * Math.PI) * .5; });
      crate.removeFromParent(); b.add(crate); crate.position.set(0, .3 / 1.25, 0); crate.scale.multiplyScalar(1 / 1.25);
      sfx('water'); rob.play('Idle');
      yield tween(2.2, k => { b.position.x = -.85 + 1.7 * k; b.rotation.z = Math.sin(k * 12) * .03; }, easeInOut);
      swapsTo(); sfx('allowed'); ctx.setResult('pend', 'Crossed · SAMPLE run'); rob.play('ThumbsUp', { once: true }); yield wait(1.4); rob.play('Idle');
    },
    update(dt) { t += dt; rob.update(dt); b.position.y = -.02 + Math.sin(t * 1.6) * .015; },
  };
}
