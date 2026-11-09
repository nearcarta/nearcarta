// Market Day in the world: the next shop's door glows, a beam stands over its roof, and the road from the
// guide to that door lights up like lamps being lit, one stone after another. All of it is real 3D in the
// town scene (additive, bloom-friendly), not a screen overlay. Driven by world.quest.target(id) / clear().
import * as THREE from 'three';
import { hx, walkPath, SHOPS, RM } from './core.js';
import { W, radial } from './world.js';
import { smooth } from './chars.js';

const GOLD = new THREE.Color('#ffc46a');
const add = (o) => { W.scene.add(o); return o; };

// soft lit band along the road: alpha across the width, a light pulse travelling toward the door
const bandMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { t: { value: 0 }, len: { value: 1 }, col: { value: GOLD.clone().multiplyScalar(1.2) }, on: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform float t,len,on; uniform vec3 col; varying vec2 vUv;
    void main(){ float a=pow(1.-abs(vUv.y*2.-1.),2.2); float d=vUv.x*len; float w=.55+.45*sin(d*2.2-t*5.);
      float tip=smoothstep(len,len-.6,d); float grow=smoothstep(on*len+.4,on*len-.4,d); gl_FragColor=vec4(col*w,a*.55*tip*grow); }`,
});
// stones: little hex studs every 0.3 along the path, each lights up in sequence
const stoneGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.02, 6);
const stoneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const beamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { t: { value: 0 }, col: { value: GOLD.clone() }, k: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform float t,k; uniform vec3 col; varying vec2 vUv;
    void main(){ float a=pow(1.-vUv.y,1.6)*smoothstep(0.,.08,vUv.y); float s=.75+.25*sin(vUv.x*25.+t*1.5+vUv.y*6.); gl_FragColor=vec4(col*1.3,a*.32*s*k); }`,
});

export function Quest({ guide, doorAt }) {
  const g = add(new THREE.Group()); g.name = 'quest'; g.visible = false;
  const band = new THREE.Mesh(new THREE.BufferGeometry(), bandMat); band.renderOrder = 4; band.frustumCulled = false; g.add(band);
  const N = 120; const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, N); stones.count = 0; stones.frustumCulled = false; stones.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); g.add(stones);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 7, 24, 1, true), beamMat); beam.geometry.translate(0, 3.5, 0); g.add(beam);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('#ffffff', 0.2), color: GOLD, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); glow.scale.set(1.5, 1.5, 1); g.add(glow);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshBasicMaterial({ map: radial('#ffffff', 0.1), color: GOLD, transparent: true, depthWrite: false, opacity: 0.5, blending: THREE.AdditiveBlending })); pool.rotation.x = -Math.PI / 2; pool.renderOrder = 3; g.add(pool);
  const light = new THREE.PointLight(0xffb85a, 0, 4.2, 1.6); g.add(light);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.6), toneMapped: false })); gem.scale.y = 1.5; g.add(gem);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('#ffffff', 0.15), color: GOLD, transparent: true, depthWrite: false, opacity: 0.8, blending: THREE.AdditiveBlending })); halo.scale.setScalar(1.1); g.add(halo);

  let id = null, pts = [], len = 0, lastTile = '', grow = 0, k = 0, t = 0, door = null, top = 0;
  const M = new THREE.Matrix4(), c = new THREE.Color();

  function build() {
    const s = SHOPS[id]; const from = guide().tile(); const key = from.join(',');
    if (key === lastTile && pts.length) return; lastTile = key;
    const tiles = walkPath(from, s.door) || [s.door];
    const raw = [guide().pos.clone().setY(0), ...tiles.slice(1).map(([q, r]) => hx(q, r)), door.p.clone()];
    pts = smooth(raw).map((p) => p.setY(0.03));
    // ribbon geometry, u = distance along the road
    const pos = [], uv = [], idx = []; let d = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dir = b.clone().sub(a).setY(0).normalize(); const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.26);
      if (i) d += pts[i].distanceTo(pts[i - 1]);
      const l = pts[i].clone().add(side), r = pts[i].clone().sub(side); pos.push(l.x, 0.035, l.z, r.x, 0.035, r.z); uv.push(d, 0, d, 1);
      if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    len = Math.max(d, 0.01);
    for (let i = 0; i < uv.length; i += 2) uv[i] /= len;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    band.geometry.dispose(); band.geometry = geo; bandMat.uniforms.len.value = len;
    // studs every 0.32
    let n = 0, acc = 0.25;
    for (let i = 1; i < pts.length && n < N; i++) {
      const a = pts[i - 1], b = pts[i], L = a.distanceTo(b);
      while (acc < L && n < N) { const p = a.clone().lerp(b, acc / L); M.makeTranslation(p.x, 0.04, p.z); stones.setMatrixAt(n, M); stones.userData['d' + n] = 0; n++; acc += 0.32; }
      acc -= L;
    }
    stones.count = n; stones.instanceMatrix.needsUpdate = true;
  }

  function target(next) {
    if (!next || !SHOPS[next]) { clear(); return; }
    if (next !== id) { grow = 0; lastTile = ''; }
    id = next; door = doorAt(id);
    const s = SHOPS[id]; const ctr = hx(s.q, s.r);
    const box = W.B[id] ? new THREE.Box3().setFromObject(W.B[id]) : null; top = box ? box.max.y : 1.6;
    beam.position.set(ctr.x, top * 0.55, ctr.z); gem.position.set(ctr.x, top + 0.55, ctr.z); halo.position.copy(gem.position);
    glow.position.copy(door.p).setY(0.42).addScaledVector(door.out, 0.15); pool.position.copy(door.p).setY(0.025).addScaledVector(door.out, 0.45);
    light.position.copy(door.p).setY(0.9).addScaledVector(door.out, 0.6);
    g.visible = true; build();
  }
  function clear() { id = null; g.visible = false; light.intensity = 0; pts = []; }

  function update(dt) {
    if (!id) return; t += dt; k = Math.min(1, k + dt * 1.5); grow = Math.min(1, grow + dt / Math.max(0.6, len / 7));
    if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) build();
    const pulse = RM ? 1 : 0.85 + 0.15 * Math.sin(t * 2.6);
    bandMat.uniforms.t.value = RM ? 0 : t; bandMat.uniforms.on.value = RM ? 1 : grow; beamMat.uniforms.t.value = t; beamMat.uniforms.k.value = k;
    light.intensity = 2.4 * k * pulse; glow.material.opacity = 0.9 * k * pulse; pool.material.opacity = 0.55 * k * pulse;
    gem.rotation.y += dt * 1.4; gem.position.y = top + 0.55 + (RM ? 0 : Math.sin(t * 2) * 0.08); halo.position.copy(gem.position); halo.material.opacity = 0.7 * k;
    // studs light in sequence from the guide to the door, then breathe
    const step = len / Math.max(1, stones.count);
    for (let i = 0; i < stones.count; i++) {
      const d = i * step / len; const lit = d <= grow ? 1 : 0;
      const w = RM ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(i * 0.7 - t * 5));
      c.copy(GOLD).multiplyScalar(lit ? 1.1 + 1.3 * w : 0.25); stones.setColorAt(i, c);
    }
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
  }
  return { target, clear, update, get id() { return id; }, get points() { return pts; } };
}
