// Mist Bank: a vault with a street window. The street sees that a payout happened; only the ledger inside holds the amount.
// Data comes through the D6 data interface (BANK); without it the room shows the recorded testnet payout d0b52067….
import { THREE, room, put, makeRobot, tok, C, CSS } from '../js/core.js';
import { row, h3, note, proof, paper, esc } from './_ui.js';
import * as D from '../../D6_dashboards/src/data.js';

const B = D.BANK || null;
const LEG = { shield: 'Shield ZEC into a confidential balance', transfer: 'Private transfer between confidential balances', unshield: 'Unshield to a public Intents balance' };
function live(b) {
  const s = b.street;
  return proof(
    h3('The street window · public explorer, live read'),
    row({ k: `Zcash testnet payout at height ${s.height}`, why: s.hidden ? `no transparent inputs or outputs; only the ${s.fee} zat fee leaves the ${s.pool} pool` : `amount visible: ${s.reasons.join(', ')}`, st: s.hidden ? 'ok' : 'no', stText: s.hidden ? 'amount hidden' : 'amount visible', src: 'live' }),
    note(`<a class="tx" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.txid.slice(0, 12))}… ↗</a> · ${esc(String(s.confirmations))} confirmations`),
    h3('The oath · NEAR testnet'),
    row({ k: `Payout approved by clause ${b.oath.clause}`, why: 'the memo on chain holds only a commitment to the amount', st: b.oath.ok ? 'ok' : 'no', stText: b.oath.ok ? 'allowed' : 'not verified', tx: b.oath.tx }),
    h3('The ledger · opened with the payee viewing key'),
    row({ k: `${b.ledger.taz} TAZ to the payee`, why: 'the memo names the oath tx; sha256(amount, salt) equals the commitment on chain', st: b.ledger.binds ? 'ok' : 'no', stText: b.ledger.binds ? 'binds' : 'mismatch', src: 'testnet' }),
    h3('The desk · NEAR Intents Confidential, dry quotes'),
    ...(b.desk.length ? b.desk.map(l => row({ k: LEG[l.leg] || l.leg, why: `privacy ${l.privacy} · signature ${l.sig ? 'verified' : 'FAILED'} · echo ${l.echo ? 'ok' : 'differs'}`, st: l.ok ? 'ok' : 'no', stText: l.ok ? 'quoted' : 'rejected', src: 'live' }))
      : [row({ k: 'Confidential quotes', why: 'not available on this server', st: 'no', stText: 'off', src: 'live' })]),
    note('Dry quotes only: no deposit address exists and nothing was spent. A mainnet confidential deposit needs the owner\'s go-ahead.'));
}

// For the 2D fallback (js/flat.js): the same live tray and proof list, or null to use the recorded testnet payout.
export const FLAT = B ? { src: 'testnet', cls: 'testnet', label: 'Street sees a payout, not the amount · Zcash testnet', hero: '<span class="blurnum">••••</span> TAZ' } : null;
export const PROOF = B ? live(B) : null;

export default async function bank() {
  const { scene, camera } = await room({ cam: [2.6, 3.8, 8.2], look: [0, .9, 0] });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: .95 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2, .2), stone); wall.position.set(0, 1, -.9); wall.castShadow = wall.receiveShadow = true; scene.add(wall);
  // the street window: frosted, so only a shape shows through
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .8), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, transparent: true, opacity: .55, roughness: 1 })); glass.position.set(-.7, 1.15, -.74); scene.add(glass);
  const shape = new THREE.Mesh(new THREE.CircleGeometry(.2, 24), new THREE.MeshStandardMaterial({ color: C.accent, roughness: .6 })); shape.position.set(-.7, 1.1, -.785); scene.add(shape); // a deposit, seen only as a shape
  // the ledger on a desk behind (camera side is "inside")
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.2, .7, .6), new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: .85 })); desk.position.set(.9, .35, .3); desk.castShadow = true; scene.add(desk);
  const book = new THREE.Mesh(new THREE.PlaneGeometry(.7, .46), new THREE.MeshStandardMaterial({ map: paper(THREE, 256, 168, (x, w, h) => { x.fillStyle = '#e9e3d6'; x.fillRect(0, 0, w, h); x.fillStyle = '#6f675c'; for (let i = 0; i < 6; i++) { x.fillRect(16, 20 + i * 22, 120 + (i * 37) % 80, 4); x.fillRect(w - 64, 20 + i * 22, 44, 4); } }), roughness: 1 }));
  book.rotation.x = -Math.PI / 2; book.position.set(.9, .71, .3); scene.add(book);
  await put(scene, 'decoration/props/crate_B_small', { x: -1.5, z: .5, fitW: .5 });
  const rob = await makeRobot(scene); rob.at(.2, 1.2); rob.lookAt(book.position);
  return {
    scene, camera, tags: [],
    panel: B ? { title: 'Mist Bank', src: 'testnet', label: 'Street sees a payout, not the amount · Zcash testnet', hero: `<span class="blurnum" aria-label="hidden amount">••••</span> TAZ`, action: null }
      : { title: 'Mist Bank', src: 'testnet', label: 'Street sees a payout, not the amount · Zcash testnet (recorded)', hero: `<span class="blurnum" aria-label="hidden amount">••••</span> TAZ`, action: null },
    proof: B ? live(B) : proof(h3('What this room shows'), row({ k: 'Street: Zcash testnet tx d0b52067…', why: 'public tx, hidden amount: only the fee leaves the Ironwood pool', src: 'testnet' }), row({ k: 'Ledger: the viewing key opens it', why: 'amount and salt hash to the commitment the oath approved', src: 'testnet' }),
      note('Recorded testnet payout d0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897 (live data did not load). Check it: https://testnet.cipherscan.app/tx/d0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897')),
    update(dt) { rob.update(dt); },
  };
}
