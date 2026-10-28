// Mist Bank (static, SAMPLE): a vault with a street window. The street sees that a deposit happened; only the ledger inside holds the amount.
import { THREE, room, put, makeRobot, tok, C, CSS } from '../js/core.js';
import { row, h3, note, proof, paper } from './_ui.js';

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
    panel: { title: 'Mist Bank', src: 'sample', label: 'Street sees a deposit, not the amount', hero: `<span class="blurnum" aria-label="hidden amount">••••</span>${tok(null, 'USDC').replace('<span class="sym">USDC</span>', '')}`, action: null },
    proof: proof(h3('What this room shows'), row({ k: 'Window: a deposit happened', why: 'the amount is not on the street side', src: 'sample' }), row({ k: 'Ledger: amount and payee', why: 'held inside the bank', src: 'sample' }),
      note('SAMPLE. No shielded transfer was run for this build, so nothing here is linked to a transaction.')),
    update(dt) { rob.update(dt); },
  };
}
