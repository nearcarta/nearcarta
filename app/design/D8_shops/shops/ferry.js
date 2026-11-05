// Ferry: USDC on Base crosses to ZEC, shielded into Zcash's Ironwood pool via an Orchard-only UA.
// The quote is a real dry 1Click read through the Nearcarta API (snapshot in data/live.js); the crossing re-enacts it, nothing is sent.
// Before the boat leaves, a downgraded echo of the same quote is refused, with the same echo-guard rule as tech backend/src/ferry.js.
import { THREE, room, put, makeRobot, sfx, wait, tween, easeInOut, tok, C } from '../js/core.js';
import { SIGNED, UNSIGNED } from '../../D6_dashboards/src/data.js';
import { boat } from '../js/town.js';
import { row, h3, note, proof, paper, esc, mainnet } from './_ui.js';
import { QUOTE } from '../data/live.js';
import { M as PM, brassM, mesh, lantern } from './_props.js';

const Q = QUOTE, short = a => a.slice(0, 8) + '…' + a.slice(-5);
export const LABEL = 'A shielded quote. Nothing is sent.';
export const HERO = `${tok(String(+Q.from.amt), Q.from.sym, { chain: Q.from.chain })}<span class="arrow" aria-hidden="true">→</span>${tok(Q.to.amt, Q.to.sym)}`;
export const RESULT = 'Crossed shielded';
const diffTxt = r => r.diffs ? r.diffs.map(d => `${d.field}: sent ${d.sent}, echo ${d.got}`).join('; ') : `receivers ${r.receivers.join(' + ')}`;
const utc3 = s => { const d = new Date(s.replace(' UTC', 'Z').replace(' ', 'T')); if (isNaN(d)) return s; d.setUTCHours(d.getUTCHours() + 3); return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC+3'; };
export const PROOF = mainnet('ferry') + proof(
  note('Pay from another chain on <a href="/ferry-widget">Pay</a>. The charter checks the recipient, the cap and the daily budget before a deposit address is created. At most 0.20 USD. You send the tokens yourself.'),
  h3('What this quote is'),
  row({ k: `${Q.from.amt} ${Q.from.sym} on ${Q.from.chain} would become about ${Q.to.exact} ZEC`, why: 'A practice quote. Nothing was sent and nothing was spent.', st: Q.sig ? 'ok' : 'no', stText: Q.sig ? 'signed' : 'not signed', src: 'live' }),
  row({ k: 'The Zcash address hides the amount', why: 'The recipient and the amount stay hidden. A weaker address is refused.', st: Q.ua.orchardOnly ? 'ok' : 'no', stText: Q.ua.orchardOnly ? 'hidden' : 'not hidden', src: 'live' }),
  `<details class="more"><summary>Technical details</summary>`,
  h3(`The quote · live read, ${Q.api}`),
  row({ k: `${Q.from.amt} ${Q.from.sym} on ${Q.from.chain} → ${Q.to.exact} ${Q.to.sym}`, why: `privacy ${Q.privacy} · about ${Q.eta} · fee ${Q.fee}`, st: Q.sig ? 'ok' : 'no', stText: Q.sig ? 'signed' : 'bad signature', src: 'live' }),
  h3('Address check'),
  row({ k: `${short(Q.ua.addr)}`, why: 'Shielded Zcash address. A mixed or public address is refused.', st: Q.ua.orchardOnly ? 'ok' : 'no', stText: Q.ua.orchardOnly ? 'shielded' : 'refused', src: 'live' }),
  h3('Refused · anything that weakens the shielding'),
  ...Q.refused.map(r => row({ k: r.case, why: `${r.why} · ${diffTxt(r)}`, st: 'no', stText: 'refused', src: r.diffs ? 'replay' : 'live' })),
  note(`The signature does not cover confidentiality, so the guard compares every echoed field with the request (${SIGNED.length} signed, ${UNSIGNED.length} not). Echo edits are re-runs of that rule on this live quote.`),
  h3('What a real crossing leaves on chain'),
  row({ k: 'Visible · Base deposit', why: `sender, ${+Q.from.amt} ${Q.from.sym} and time, to a 1Click deposit address`, st: 'no', stText: 'public', src: 'mainnet' }),
  row({ k: 'Visible · Zcash payout tx', why: 'that a tx entered the pool; the amount too if the bridge pays from transparent funds (not checkable on a dry quote)', st: 'pend', stText: 'depends', src: 'mainnet' }),
  row({ k: 'Hidden · the swap', why: 'order size, timing and counterparties settle on the private Confidential Intents shard', st: 'ok', stText: 'hidden', src: 'mainnet' }),
  row({ k: 'Hidden · recipient, note and later spends', why: "shielded into Zcash's Ironwood pool via an Orchard-only UA; no transparent receiver to fall back to", st: 'ok', stText: 'hidden', src: 'mainnet' }),
  note('1Click has no mainnet. So the swap here is a real signed 1Click quote plus a NEAR payment that your charter checks against your Ferry rule; no cross-chain swap runs.'),
  note(`Nothing was sent, so there is no transaction yet. Read ${esc(utc3(Q.at))}.`),
  `</details>`);
export const FLAT = { src: 'mainnet quote', cls: 'quote', label: LABEL, hero: HERO };

export default async function ferry(ctx) {
  const T = []; for (let q = -3; q <= 3; q++) for (let r = -1; r <= 1; r++) { const x = 2 * q + r; if (Math.abs(x) > 4) continue; T.push([q, r, Math.abs(x) <= 1 ? 'hex_water' : 'hex_grass']); }
  const { scene, camera } = await room({ tiles: T, cam: [0, 5.4, 10.6], look: [0, .2, 0] });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .9 });
  const jetty = (x, dir) => { const d = new THREE.Mesh(new THREE.BoxGeometry(1.0, .06, .5), wood); d.position.set(x, .12, .2); d.castShadow = d.receiveShadow = true; scene.add(d); };
  jetty(-1.75, 1); jetty(1.75, -1);
  await put(scene, 'decoration/props/barrel', { x: -3.1, z: -.5 }); await put(scene, 'decoration/props/sack', { x: 3.2, z: -.4, ry: 1 });
  // mooring posts, jetty lanterns, a manifest board with the brass quote seal, cargo waiting on the far shore, lilies in the strait
  [[-1.28, .48], [-1.28, -.08], [1.28, .48], [1.28, -.08]].forEach(([x, z]) => { mesh(scene, new THREE.CylinderGeometry(.05, .06, .42, 8), PM.dark, [x, .16, z]); mesh(scene, new THREE.TorusGeometry(.065, .014, 6, 16), new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 1 }), [x, .3, z], { rx: Math.PI / 2 }); });
  lantern(scene, -3.1, .4, { h: 1.0 }); lantern(scene, 2.2, -.15, { h: 1.0, light: false });
  mesh(scene, new THREE.BoxGeometry(.06, .9, .06), PM.dark, [-2.85, .45, -.9]); mesh(scene, new THREE.BoxGeometry(.06, .9, .06), PM.dark, [-2.35, .45, -.9]);
  mesh(scene, new THREE.BoxGeometry(.62, .42, .04), PM.wood, [-2.6, .78, -.9]); mesh(scene, new THREE.PlaneGeometry(.44, .3), new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 1 }), [-2.6, .78, -.875]);
  const seal = mesh(scene, new THREE.CylinderGeometry(.06, .06, .02, 20), brassM(), [-2.45, .7, -.86], { rx: Math.PI / 2 });
  const sealNo = new THREE.MeshStandardMaterial({ color: 0xff6b6b, emissive: 0xff6b6b, emissiveIntensity: .5, roughness: .6 }), sealOk = new THREE.MeshStandardMaterial({ color: 0x00ec97, emissive: 0x00ec97, emissiveIntensity: .45, roughness: .6 });
  // the downgraded echo: a second quote slip with a coral band, which the board refuses and the strait swallows
  const slip = mesh(scene, new THREE.PlaneGeometry(.3, .2), new THREE.MeshStandardMaterial({ map: paper(THREE, 150, 100, (x, w, h) => { x.fillStyle = '#efe6d2'; x.fillRect(0, 0, w, h); x.fillStyle = '#ff6b6b'; x.fillRect(0, 0, w, 16); x.fillStyle = '#7b6a55'; for (let i = 0; i < 4; i++) x.fillRect(12, 32 + i * 16, 90 - i * 14, 4); }), roughness: 1, side: THREE.DoubleSide, transparent: true }), [2.4, .9, -.6], { cast: false }); slip.visible = false;
  // the far shore: the cargo goes into the pool as a soft mist
  const mistT = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(243,234,216,.9)'); g.addColorStop(1, 'rgba(243,234,216,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c; })());
  const pool = [0, 1, 2].map(i => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistT, transparent: true, opacity: 0, depthWrite: false })); m.scale.set(.7, .5, 1); m.position.set(.85 + i * .12, .35 + i * .08, .2 + (i - 1) * .12); scene.add(m); return m; });
  await put(scene, 'decoration/props/crate_A_big', { x: 2.9, z: .75, ry: -.5, fitW: .42 }); await put(scene, 'decoration/props/barrel', { x: 2.6, z: -.9 });
  for (const [n, x, z] of [['waterlily_A', -.4, -.9], ['waterlily_B', .5, 1.1], ['waterplant_A', .9, -1.1], ['waterlily_A', -.7, 1.2]]) await put(scene, 'decoration/nature/' + n, { x, z, fitW: .35 }).catch(() => null);
  const b = boat(new THREE.Vector3(-.85, -.02, .2)); b.scale.setScalar(1.25); scene.add(b);
  const crate = await put(scene, 'decoration/props/crate_A_small', { x: -2.0, y: .15, z: .25, fitW: .42 });
  const rob = await makeRobot(scene); rob.at(-3.6, 1.6);
  const icon = (sym, chain) => `<span class="tok">${tok(null, sym, { chain }).replace('<span class="sym">' + sym + '</span>', '')}</span>`;
  const tags = [{ obj: crate, pos: new THREE.Vector3(0, .9, 0), html: icon('USDC', 'Base'), cls: 'bare' }, { obj: seal, pos: new THREE.Vector3(-.15, .55, 0), html: 'Downgrade refused', cls: 'no hide' }];
  const swapsTo = () => { tags[0].el.innerHTML = icon('ZEC', 'Zcash'); };
  let t = 0;
  return {
    rob, scene, camera, tags,
    panel: { title: 'Ferry', src: 'quote', srcNote: 'A real mainnet price quote. Nothing is sent and nothing is spent.', label: LABEL, hero: HERO, action: 'Load the cargo' },
    proof: PROOF,
    *intro() { yield rob.walk([new THREE.Vector3(-2.8, 0, .9)]); rob.lookAt(crate.position); },
    *act() {
      yield rob.walk([new THREE.Vector3(-2.45, 0, .55)]); rob.lookAt(crate.position); rob.play('Yes', { once: true }); yield wait(.4);
      sfx('send'); const c0 = crate.position.clone(), c1 = new THREE.Vector3(-.85, .36, .2);
      yield tween(.55, k => { crate.position.lerpVectors(c0, c1, k); crate.position.y += Math.sin(k * Math.PI) * .5; });
      crate.removeFromParent(); b.add(crate); crate.position.set(0, .3 / 1.25, 0); crate.scale.multiplyScalar(1 / 1.25); rob.play('Idle');
      // a downgraded echo of the quote drifts in from the far shore; the board refuses it
      slip.visible = true; const s0 = slip.position.clone(), s1 = new THREE.Vector3(-2.6, .8, -.84); rob.lookAt(seal.position);
      yield tween(1.1, k => { slip.position.lerpVectors(s0, s1, k); slip.position.y += Math.sin(k * Math.PI) * .6; slip.rotation.z = Math.sin(k * 8) * .2; }, easeInOut);
      seal.material = sealNo; tags[1].el?.classList.remove('hide'); sfx('refuse'); rob.play('No', { once: true }); yield wait(.5);
      const d0 = slip.position.clone(), d1 = new THREE.Vector3(-1.3, -.25, -.7);
      yield tween(.9, k => { slip.position.lerpVectors(d0, d1, k); slip.position.y = d0.y + (d1.y - d0.y) * k * k; slip.rotation.x = -k * 1.4; slip.material.opacity = 1 - k * .9; });
      slip.visible = false; yield wait(.3);
      // the signed, shielded quote matches the request: the seal goes mint and the boat crosses
      seal.material = sealOk; sfx('allowed'); sfx('water'); rob.play('Idle');
      yield tween(2.2, k => { b.position.x = -.85 + 1.7 * k; b.rotation.z = Math.sin(k * 12) * .03; }, easeInOut);
      swapsTo(); yield tween(.9, k => pool.forEach((m, i) => { m.material.opacity = .55 * Math.min(1, Math.max(0, k * 1.4 - i * .2)); }));
      ctx.setResult('ok', RESULT); rob.play('ThumbsUp', { once: true }); yield wait(1.4); rob.play('Idle');
    },
    update(dt) { t += dt; rob.update(dt); b.position.y = -.02 + Math.sin(t * 1.6) * .015; pool.forEach((m, i) => { m.position.y += Math.sin(t * .9 + i) * .0008; }); },
  };
}
