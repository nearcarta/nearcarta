// Guardhouse: the oath is a pane across the gate. A forged invoice (real lab attack S2) knocks and bounces off.
import { THREE, room, put, makeRobot, sfx, wait, tween, easeInOut, tok, C } from '../js/core.js';
import { ATTACKS, LAB } from '../../D6_dashboards/src/data.js';
import { row, h3, note, proof, esc, acct } from './_ui.js';

export default async function guard(ctx) {
  const { scene, camera } = await room({ cam: [2.2, 3.4, 8.2], look: [0, .9, 0] });
  const gate = await put(scene, 'buildings/neutral/wall_straight_gate', { z: -.4, fitW: 2.3 });
  await put(scene, 'decoration/props/weaponrack', { x: -1.6, z: .6, ry: .6 }); await put(scene, 'decoration/props/barrel', { x: 1.7, z: -.2 });
  const gb = new THREE.Box3().setFromObject(gate); const gw = (gb.max.x - gb.min.x) * .34, gh = (gb.max.y - gb.min.y) * .78;
  // the oath pane: a quiet line lattice that only shows colour where something hits it
  const U = { hit: { value: 0 }, hp: { value: new THREE.Vector2(.5, .5) }, t: { value: 0 }, cb: { value: new THREE.Color(C.text) }, cn: { value: new THREE.Color(C.no) } };
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float hit; uniform vec2 hp; uniform vec3 cb, cn; varying vec2 vUv;
      void main(){ vec2 g=abs(fract(vUv*vec2(6.,8.))-.5); float l=1.-smoothstep(.0,.04,min(g.x,g.y)); float edge=1.-smoothstep(.0,.03,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));
        float d=distance(vUv,hp); float ring=exp(-pow((d-(1.-hit)*.9)*14.,2.))*hit; float glow=exp(-d*5.)*hit;
        vec3 col=mix(cb,cn,clamp(ring*2.+glow,0.,1.));
        gl_FragColor=vec4(col,(l*.10+edge*.35+.03)+ring*.9+glow*.5);
#include <colorspace_fragment>
}` }));
  pane.position.set(0, gb.min.y + gh / 2 + .02, -.4); scene.add(pane);
  // the forged invoice
  const inv = new THREE.Mesh(new THREE.PlaneGeometry(.42, .3), new THREE.MeshStandardMaterial({ color: 0xe9e3d6, side: THREE.DoubleSide, roughness: 1 })); inv.castShadow = true;
  const seal = new THREE.Mesh(new THREE.CircleGeometry(.05, 16), new THREE.MeshBasicMaterial({ color: C.no })); seal.position.set(.12, -.07, .002); inv.add(seal);
  const A = new THREE.Vector3(-2.6, 2.3, -6), H = pane.position.clone().add(new THREE.Vector3(.1, .15, 0)), M = new THREE.Vector3(-1.2, 2.6, -3.2);
  const curve = new THREE.QuadraticBezierCurve3(A, M, H); inv.position.copy(A); scene.add(inv);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), new THREE.LineDashedMaterial({ color: C.no, dashSize: .12, gapSize: .1, transparent: true, opacity: 0 })); line.computeLineDistances(); scene.add(line);
  const rob = await makeRobot(scene); rob.at(1.9, 2.1); rob.lookAt(new THREE.Vector3(0, 0, .3));
  const S2 = ATTACKS.find(a => a.id === 'S2');
  const tags = [{ obj: inv, pos: new THREE.Vector3(0, .26, 0), html: `<span aria-hidden="true">→</span>attacker`, cls: '' }];
  let t = 0;
  return {
    scene, camera, tags,
    panel: { title: 'Guardhouse', src: 'testnet', label: 'Forged invoice asks', hero: tok('5', 'NEAR'), action: 'Let it knock' },
    proof: proof(
      h3('This knock · lab attack S2'), row({ k: S2.name, why: S2.reason + ' · ' + S2.secs + ' s', st: 'no', stText: 'refused', tx: S2.tx }),
      `<pre class="kv">${esc(S2.tool.split('\n')[1])}</pre>`, note(`The agent read the hidden line and proposed it. The oath ${acct(LAB.oath)} refused before any money moved.`),
      h3('Other knocks on the same gate'), ...ATTACKS.filter(a => a.id !== 'S2').map(a => row({ k: a.name, why: a.reason, st: 'no', stText: 'refused', tx: a.tx })),
      note('Every row is a real testnet transaction. The flight of the letter is a re-enactment.')),
    *intro() { yield rob.walk([new THREE.Vector3(.7, 0, 1.5)]); rob.lookAt(pane.position); },
    *act() {
      yield tween(.5, k => line.material.opacity = k * .9); yield wait(.25);
      yield tween(.9, k => { curve.getPoint(k, inv.position); inv.rotation.set(0, -.5 + k * .5, Math.sin(k * 9) * .15); }, k => k * k * (3 - 2 * k));
      sfx('refuse'); rob.play('No', { once: true }); ctx.setResult('no', 'Refused · not on the list'); tags[0].el?.classList.add('no'); line.material.opacity = 0;
      const p0 = inv.position.clone(), p1 = new THREE.Vector3(-1.1, .02, -2.4);
      U.hit.value = 1; yield tween(1.1, k => { U.hit.value = 1 - k; const q = p0.clone().lerp(p1, k); q.y = p0.y + (p1.y - p0.y) * k + Math.sin(k * Math.PI) * .6 * (1 - k); inv.position.copy(q); inv.rotation.x = -k * Math.PI / 2; });
      yield wait(1.2); rob.play('Idle');
    },
    update(dt) { t += dt; rob.update(dt); },
  };
}
