// Guardhouse: the oath is a pane across the gate. A forged invoice (real lab attack S2) knocks and bounces off.
import { THREE, room, put, makeRobot, sfx, wait, tween, easeInOut, tok, C } from '../js/core.js';
import { ATTACKS, LAB } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, esc, acct, paper, vaultLink } from './_ui.js';
import { M as PM, brassM, mesh, lantern, banner } from './_props.js';

// Proof list at module level so the 2D view (js/flat.js) can show it without building the scene.
const S2 = ATTACKS.find(a => a.id === 'S2');
export const PROOF = proof(vaultLink(),
      h3('This knock · lab attack S2'), row({ k: S2.name, why: S2.reason + ' · ' + S2.secs + ' s', st: 'no', stText: 'refused', tx: S2.tx }),
      `<pre class="kv">${esc(S2.tool.split('\n')[1])}</pre>`, note(`The agent read the hidden line and proposed it. The oath ${acct(LAB.oath)} refused before any money moved.`),
      h3('Other knocks on the same gate'), ...ATTACKS.filter(a => a.id !== 'S2').map(a => row({ k: a.name, why: a.reason, st: 'no', stText: 'refused', tx: a.tx })),
      note('Every row is a real testnet transaction. The flight of the letter is a re-enactment.'));
export default async function guard(ctx) {
  const { scene, camera } = await room({ cam: [2.2, 3.4, 8.2], look: [0, .9, 0] });
  const gate = await put(scene, 'buildings/neutral/wall_straight_gate', { z: -.4, fitW: 2.3 });
  await put(scene, 'decoration/props/weaponrack', { x: -1.6, z: .6, ry: .6 }); await put(scene, 'decoration/props/barrel', { x: 1.8, z: -.5 });
  const gb = new THREE.Box3().setFromObject(gate); const gw = (gb.max.x - gb.min.x) * .34, gh = (gb.max.y - gb.min.y) * .78;
  // the oath pane: a brass lattice with a faint warm fill, readable at rest; coral rings where something hits it
  const U = { hit: { value: 0 }, hp: { value: new THREE.Vector2(.5, .5) }, t: { value: 0 }, cb: { value: new THREE.Color(C.accent) }, cn: { value: new THREE.Color(C.no) } };
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float hit, t; uniform vec2 hp; uniform vec3 cb, cn; varying vec2 vUv;
      void main(){ vec2 g=abs(fract(vUv*vec2(6.,8.))-.5); float l=1.-smoothstep(.0,.06,min(g.x,g.y)); float edge=1.-smoothstep(.0,.035,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));
        float d=distance(vUv,hp); float ring=exp(-pow((d-(1.-hit)*.9)*14.,2.))*hit; float glow=exp(-d*5.)*hit;
        vec3 col=mix(cb,cn,clamp(ring*2.+glow,0.,1.));
        float shim=.5+.5*sin(vUv.y*40.-t*1.5); gl_FragColor=vec4(col,(l*(.38+.1*shim)+edge*.95+.09)+ring*.9+glow*.5);
#include <colorspace_fragment>
}` }));
  const pz = gb.max.z + .04; pane.position.set(0, gb.min.y + gh / 2 + .02, pz); scene.add(pane);
  // brass frame + the oath seal over the arch, so the pane reads as a sworn barrier, not a glitch
  const fx = gw / 2 + .03, fy0 = gb.min.y + .02, fy1 = fy0 + gh;
  [-fx, fx].forEach(x => mesh(scene, new THREE.BoxGeometry(.05, gh, .05), brassM(), [x, fy0 + gh / 2, pz])); mesh(scene, new THREE.BoxGeometry(gw + .11, .05, .05), brassM(), [0, fy1, pz]); mesh(scene, new THREE.BoxGeometry(gw + .11, .05, .05), brassM(), [0, fy0, pz]);
  const oathSeal = mesh(scene, new THREE.CylinderGeometry(.13, .13, .04, 24), brassM(), [0, fy1 + .02, pz + .03], { rx: Math.PI / 2 }); mesh(scene, new THREE.TorusGeometry(.09, .012, 6, 24), new THREE.MeshBasicMaterial({ color: 0x5e3427 }), [0, fy1 + .02, pz + .055]);
  // the guest list on a lectern: who may pass (two lines checked, the rest blank)
  const list = paper(THREE, 128, 160, (x, w, h) => { x.fillStyle = '#efe6d2'; x.fillRect(0, 0, w, h); for (let i = 0; i < 6; i++) { x.fillStyle = '#7b6a55'; x.fillRect(30, 22 + i * 22, 70 - (i * 13) % 30, 4); if (i < 2) { x.fillStyle = '#1f9d6a'; x.fillRect(12, 18 + i * 22, 9, 9); } } });
  mesh(scene, new THREE.BoxGeometry(.08, .9, .08), PM.wood, [1.55, .45, .95]); const desk = mesh(scene, new THREE.BoxGeometry(.42, .04, .32), PM.wood, [1.55, .92, .95], { rx: .5 });
  mesh(scene, new THREE.PlaneGeometry(.3, .38), new THREE.MeshStandardMaterial({ map: list, roughness: 1 }), [1.55, .945, .965], { rx: .5 - Math.PI / 2 });
  lantern(scene, -1.25, -.15, { h: 1.35 }); lantern(scene, 1.25, -.6, { h: 1.35, light: false });
  banner(scene, -gw / 2 - .3, fy1 - .05, pz, 0xa8644a, { w: .3, h: .55 }); banner(scene, gw / 2 + .3, fy1 - .05, pz, 0xa8644a, { w: .3, h: .55 });
  await put(scene, 'decoration/props/bucket_arrows', { x: -1.95, z: -.3, fitW: .32 }); await put(scene, 'decoration/props/target', { x: -1.65, z: .55, ry: .7, fitW: .7 });
  // the forged invoice
  const inv = new THREE.Mesh(new THREE.PlaneGeometry(.42, .3), new THREE.MeshStandardMaterial({ color: 0xe9e3d6, side: THREE.DoubleSide, roughness: 1 })); inv.castShadow = true;
  const seal = new THREE.Mesh(new THREE.CircleGeometry(.05, 16), new THREE.MeshBasicMaterial({ color: C.no })); seal.position.set(.12, -.07, .002); inv.add(seal);
  const A = new THREE.Vector3(-2.6, 2.3, -6), H = pane.position.clone().add(new THREE.Vector3(.1, .15, 0)), M = new THREE.Vector3(-1.2, 2.6, -3.2);
  const curve = new THREE.QuadraticBezierCurve3(A, M, H); inv.position.copy(A); scene.add(inv);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), new THREE.LineDashedMaterial({ color: C.no, dashSize: .12, gapSize: .1, transparent: true, opacity: 0 })); line.computeLineDistances(); scene.add(line);
  const rob = await makeRobot(scene); rob.at(1.9, 2.1); rob.lookAt(new THREE.Vector3(0, 0, .3));
  const S2 = ATTACKS.find(a => a.id === 'S2');
  const tags = [{ obj: inv, pos: new THREE.Vector3(0, .26, 0), html: `<span aria-hidden="true">→</span>forged invoice`, cls: '' }];
  let t = 0;
  return {
    scene, camera, tags,
    panel: { title: 'Guardhouse', src: 'testnet', label: 'Forged invoice asks', hero: tok('5', 'NEAR'), action: 'Let it knock' },
    proof: PROOF,
    *intro() { yield rob.walk([new THREE.Vector3(1.15, 0, 1.75)]); rob.lookAt(pane.position); },
    *act() {
      yield tween(.5, k => line.material.opacity = k * .9); yield wait(.25);
      yield tween(.9, k => { curve.getPoint(k, inv.position); inv.rotation.set(0, -.5 + k * .5, Math.sin(k * 9) * .15); }, k => k * k * (3 - 2 * k));
      sfx('refuse'); rob.play('No', { once: true }); ctx.setResult('no', 'Refused · not on the list'); tags[0].el?.classList.add('no'); line.material.opacity = 0;
      const p0 = inv.position.clone(), p1 = new THREE.Vector3(-1.1, .02, -2.4);
      U.hit.value = 1; yield tween(1.1, k => { U.hit.value = 1 - k; const q = p0.clone().lerp(p1, k); q.y = p0.y + (p1.y - p0.y) * k + Math.sin(k * Math.PI) * .6 * (1 - k); inv.position.copy(q); inv.rotation.x = -k * Math.PI / 2; });
      yield wait(1.2); rob.play('Idle');
    },
    update(dt) { t += dt; U.t.value = t; rob.update(dt); },
  };
}
