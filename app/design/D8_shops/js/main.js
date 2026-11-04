// D8 shell: town ⇄ shop with a door iris. Shops are lazy modules.
import { THREE, P, CAPTURE, RM, $, readTokens, clock, run, killAll, tickRoutines, wait, tween, easeInOut, sfx, sound, events, i3, C } from './core.js';
import { buildTown, SHOPS, B, robot, doorPos, townCamera } from './town.js';
import { MapControls } from 'three/addons/controls/MapControls.js';

const LOADERS = { guard: () => import('../shops/guard.js'), ferry: () => import('../shops/ferry.js'), hall: () => import('../shops/hall.js'), bank: () => import('../shops/bank.js'), arena: () => import('../shops/arena.js'), toll: () => import('../shops/toll.js'), chronicle: () => import('../shops/chronicle.js'), house: () => import('../shops/house.js'), payouts: () => import('../shops/payouts.js') };
window.__events = events;

const webgl = (() => { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch (e) { return false; } })();

let renderer = null, town = null, cam = null, controls = null, rt = null, quad = null, qcam = null, qmat = null; let shop = null, mode = 'town', iris = 0, irisC = new THREE.Vector2(.5, .5);
const labels = {};
async function boot() {
  const tl = document.getElementById('tokens'); if (tl && !tl.sheet) await new Promise(r => { tl.onload = tl.onerror = r; }); readTokens();
  renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(CAPTURE ? 1 : Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  town = new THREE.Scene(); cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, .5, 220); townCamera(cam);
  controls = new MapControls(cam, renderer.domElement); controls.target.copy(cam.userData.look); controls.enableDamping = !CAPTURE; controls.minDistance = 18; controls.maxDistance = 60; controls.maxPolarAngle = 1.1; controls.minPolarAngle = .5; controls.update();
  // iris composite: interior rendered offscreen, revealed through a circle that grows from the door
  rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  qmat = new THREE.ShaderMaterial({ uniforms: { tex: { value: rt.texture }, c: { value: irisC }, r: { value: 0 }, asp: { value: 1 }, ac: { value: new THREE.Color(C.accent) } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: 'uniform sampler2D tex; uniform vec2 c; uniform float r, asp; uniform vec3 ac; varying vec2 vUv; void main(){ vec2 d=(vUv-c)*vec2(asp,1.); float L=length(d); float a=1.-smoothstep(r-.004,r+.004,L); vec4 t=texture2D(tex,vUv); float edge=smoothstep(r-.02,r,L)*a; gl_FragColor=vec4(mix(t.rgb, ac, edge*.6), a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
  quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), qmat); quad.frustumCulled = false; const qs = new THREE.Scene(); qs.add(quad); qcam = new THREE.Camera(); quad.userData.scene = qs;
  resize(); addEventListener('resize', resize); addEventListener('pointerdown', onPointer);
  { const s0 = P.get('shop'); if (s0 && LOADERS[s0]) { coldTray(s0); $('#load')?.remove(); } }
  await buildTown(town); robot.quiet = true;
  makeLabels(); ui();
  // cold open on ?shop=: drop the spinner now and let the shop panel show its own skeleton while the API wakes
  $('#load')?.remove(); document.body.classList.add('ready');
  const start = P.get('shop'); if (start && LOADERS[start]) await enter(start, { instant: true });
  window.__ready = true;
  if (!CAPTURE) { let last = performance.now(); const loop = now => { const dt = Math.min(.05, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
}
function resize() { if (!renderer) return; const w = innerWidth, h = innerHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); const pr = renderer.getPixelRatio(); rt.setSize(w * pr, h * pr); qmat.uniforms.asp.value = w / h; if (shop) frameShop(shop.camera); }

// --- frame (shared by rAF and capture stepping) ---
const ray = new THREE.Raycaster(); let fpsN = 0, fpsT = 0; window.__fps = [];
// Shops are lit for detail (1.18); the town keeps a lower, warmer exposure so the map stays readable.
const SHOP_EXP = 1.18, TOWN_EXP = 1.0;
function frame(dt) {
  if (!renderer || !town) return; // called before boot finished (capture tools, early resize): nothing to draw yet
  clock.T += dt; tickRoutines(); robot?.update(dt); if (shop) shop.update?.(dt, clock.T);
  if (controls.enabled) controls.update();
  if (mode === 'shop') { renderer.setRenderTarget(null); (renderer.toneMappingExposure = SHOP_EXP, renderer.render(shop.scene, shop.camera)); }
  else if (iris > 0 && shop) { renderer.setRenderTarget(rt); (renderer.toneMappingExposure = SHOP_EXP, renderer.render(shop.scene, shop.camera)); renderer.setRenderTarget(null); (renderer.toneMappingExposure = TOWN_EXP, renderer.render(town, cam)); qmat.uniforms.r.value = iris; renderer.autoClear = false; renderer.render(quad.userData.scene, qcam); renderer.autoClear = true; }
  else { renderer.setRenderTarget(null); (renderer.toneMappingExposure = TOWN_EXP, renderer.render(town, cam)); }
  placeTags(); fpsN++; const now = performance.now(); if (!fpsT) fpsT = now; if (now - fpsT >= 1000) { window.__fps.push(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; }
}
window.__advance = (sec, fps = 30) => { const n = Math.round(sec * fps); for (let i = 0; i < n; i++) frame(1 / fps); };

// --- town labels: icon + name, nothing else ---
const v = new THREE.Vector3();
function makeLabels() { const box = $('#tags');
  for (const [id, s] of Object.entries(SHOPS)) { const b = document.createElement('button'); b.className = 'lb'; b.dataset.id = id; b.innerHTML = `${i3(s.icon, 24)}<span>${s.name}</span>`; b.setAttribute("aria-label", s.name); b.onclick = () => enter(id);
    b.onmouseenter = () => { lift(id, true); sfx('hover'); }; b.onmouseleave = () => lift(id, false); b.onfocus = () => lift(id, true); b.onblur = () => lift(id, false); box.appendChild(b); labels[id] = b; } }
function lift(id, on) { const o = B[id]; if (!o) return; run((function* () { const y0 = o.position.y, y1 = on ? .18 : 0; yield tween(.18, k => o.position.y = y0 + (y1 - y0) * k); })()); o.traverse(m => { if (m.isMesh) { m.material.emissive?.set(on ? 0x3a2a10 : 0); } }); }
function placeTags() {
  const w = innerWidth, h = innerHeight;
  if (mode === 'town') { const rects = [];
    for (const [id, el] of Object.entries(labels)) { const s = SHOPS[id]; v.copy(B[id]?.position || new THREE.Vector3()); v.y = id === 'chronicle' ? 3.1 : id === 'hall' ? 2.9 : 1.9; v.project(cam); let x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * h;
      const bw = el.offsetWidth || 110, bh = 36; let r = { x: x - bw / 2, y: y - bh, w: bw, h: bh }; for (let k = 0; k < 6; k++) { const hit = rects.find(o => r.x < o.x + o.w + 8 && r.x + r.w + 8 > o.x && r.y < o.y + o.h + 8 && r.y + r.h + 8 > o.y); if (!hit) break; r.y = hit.y - bh - 8; } rects.push(r);
      el.style.transform = `translate(${r.x | 0}px,${r.y | 0}px)`; } }
  if (shop?.tags) for (const t of shop.tags) { if (!t.el) continue; if (t.obj) { t.obj.updateMatrixWorld(); v.setFromMatrixPosition(t.obj.matrixWorld).add(t.pos); } else v.copy(t.pos); v.project(shop.camera); const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * h; t.el.style.transform = `translate(${x | 0}px,${y | 0}px) translate(-50%,-100%)`; }
}
function onPointer(e) { if (mode !== 'town' || e.target.id !== 'gl') return; const m = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); ray.setFromCamera(m, cam); const hit = ray.intersectObjects(Object.values(B), true)[0]; if (hit) { let o = hit.object; while (o && !o.userData.id) o = o.parent; if (o) { const id = o.userData.id; addEventListener('pointerup', () => enter(id), { once: true }); } } }

// --- tray (one primary action) + proof drawer ---
// Shops are real apps on the visitor's own charter; ?scripted keeps the old cinematic for the walkthrough film.
const APP = !P.has('scripted'); let apps = null;
const loadApps = () => apps || (apps = import('./shopui.js').then(m => { m.boot(); return m; }));
const tray = () => $('#tray');
function ui() {
  sound.button($('#snd'));
  // the walkthrough video has a sound track, so its icon must read 'sound on' (a capture page is never unlocked by a gesture)
  if (CAPTURE && P.has('snd')) { const b = $('#snd'); b.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-label', 'Sound on. Click to mute'); }
  $('#back').onclick = () => leave(); $('#t-proof').onclick = () => drawer(true); $('#d-close').onclick = () => drawer(false);
  addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#drawer').classList.contains('open')) drawer(false); else if (shop) leave(); } });
  if (APP) { $('#wallet').hidden = false; $('#t-say').hidden = false; document.body.classList.add('apps'); loadApps(); return; }
  $('#t-act').onclick = () => { if (!shop?.act || $('#t-act').disabled) return; sfx('click'); $('#t-act').disabled = true; $('#t-act').classList.add('busy'); run(shop.act()); };
}
function drawer(on) { const d = $('#drawer'); d.classList.toggle('open', on); d.setAttribute('aria-hidden', on ? 'false' : 'true'); $('#t-proof').setAttribute('aria-expanded', on); if (on) { sfx('click'); $('#d-close').focus(); } }
export function setResult(kind, text) { if (APP) return; const b = $('#t-act'); b.classList.remove('busy'); b.className = 'act res ' + kind; b.disabled = true; b.innerHTML = `<span class="glyph" aria-hidden="true">${kind === 'no' ? '✕' : kind === 'ok' ? '✓' : '○'}</span>${text}`; b.setAttribute('aria-live', 'polite'); }
export function setHero(html) { const h = $('#t-hero'); h.innerHTML = html; h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump'); }
const SRC = { testnet: 'mainnet', live: 'live read', split: 'mainnet', quote: 'mainnet quote' };
function fillTray(sh) { const p = sh.panel; $('#t-title').innerHTML = `${i3(SHOPS[sh.id].icon, 28)}<span>${p.title}</span>`; const s = $('#t-src'); s.textContent = SRC[p.src]; s.className = 'src ' + p.src; s.title = p.srcNote || '';
  $('#t-label').textContent = p.label; $('#t-hero').innerHTML = p.hero; const b = $('#t-act'); b.className = 'act primary'; b.disabled = false; b.hidden = !p.action; b.textContent = p.action || '';
  const m = $('#t-more'); m.hidden = !p.more; if (p.more) { m.href = p.more.href; m.textContent = p.more.text; }
  $('#d-title').textContent = p.title + ' · proof'; $('#d-body').innerHTML = sh.proof + '<p class="note legal">Nearcarta is independent, not affiliated with NEAR Foundation.</p>'; }

// --- enter / leave ---
// shift the room right so the tray (bottom-left) never covers the subject
function frameShop(c) { c.aspect = innerWidth / innerHeight; const ox = innerWidth > 900 ? -196 : 0; c.setViewOffset(innerWidth, innerHeight, ox, 0, innerWidth, innerHeight); c.updateProjectionMatrix(); }
let busy = false;
function coldTray(id) { $('#t-title').innerHTML = `${i3(SHOPS[id].icon, 28)}<span>${SHOPS[id].name || id}</span>`; $('#t-label').textContent = 'Opening the shop…'; $('#t-hero').innerHTML = '<div class="skel" data-testid="skeleton" aria-hidden="true"><i></i><i></i><i></i></div>';
    const b0 = $('#t-act'); b0.hidden = false; b0.disabled = true; b0.className = 'act primary'; b0.textContent = 'Sign in'; document.body.classList.add('in-shop'); tray().hidden = false; $('#brand').hidden = true; }
export async function enter(id, { instant = false } = {}) {
  if (busy || shop) return; busy = true; sfx('click');
  // direct link (?shop=): show the panel straight away while the room's 3D and the API load
  if (instant) coldTray(id);
  const mod = await LOADERS[id](); const tk = {}; const live = () => shop && shop.tk === tk; const sh = await mod.default({ setResult: (...a) => live() && setResult(...a), setHero: (...a) => live() && setHero(...a), live }); sh.id = id; sh.tk = tk; shop = sh; frameShop(sh.camera);
  sh.tags?.forEach(t => { if (t.html) { t.el = document.createElement('div'); t.el.className = 'stag ' + (t.cls || ''); t.el.innerHTML = t.html; $('#stags').appendChild(t.el); } });
  fillTray(sh); if (APP) loadApps().then(m => live() && m.mount(id, sh, run)); controls.enabled = false; Object.values(labels).forEach(l => l.classList.add('gone'));
  const { b, dir } = doorPos(id); const from = cam.position.clone(), look0 = controls.target.clone();
  const look1 = b.clone().add(new THREE.Vector3(0, .7, 0)), to = b.clone().addScaledVector(dir, 3.2).add(new THREE.Vector3(0, 1.4, 0));
  const home = sh.camera.position.clone(), look = sh.camera.userData.look; const far = home.clone().sub(look).multiplyScalar(1.22).add(look);
  const go = function* () {
    if (!instant && !RM) {
      yield tween(.9, k => { cam.position.lerpVectors(from, to, k); const l = look0.clone().lerp(look1, k); cam.lookAt(l); }, easeInOut);
      v.copy(look1).project(cam); irisC.set(v.x * .5 + .5, v.y * .5 + .5); sfx('swap');
      sh.camera.position.copy(far); sh.camera.lookAt(look);
      yield tween(.75, k => { iris = k * 1.25; sh.camera.position.lerpVectors(far, home, k); sh.camera.lookAt(look); });
    }
    sh.camera.position.copy(home); sh.camera.lookAt(look); iris = 0; mode = 'shop'; document.body.classList.add('in-shop'); tray().hidden = false; $('#back').hidden = false; $('#brand').hidden = true; $('#stags').hidden = false;
    busy = false; if (sh.intro) yield* sh.intro();
  };
  run(go()); if (instant || RM) { await new Promise(r => setTimeout(r, 0)); }
}
export function leave() {
  if (!shop || busy) return; busy = true; sfx('click'); drawer(false);
  const sh = shop; if (APP) apps?.then(m => m.unmount()); tray().hidden = true; $('#stags').hidden = true; $('#stags').innerHTML = ''; $('#back').hidden = true; $('#brand').hidden = false; document.body.classList.remove('in-shop');
  const { b, dir } = doorPos(sh.id); const look1 = b.clone().add(new THREE.Vector3(0, .7, 0)), at = b.clone().addScaledVector(dir, 3.2).add(new THREE.Vector3(0, 1.4, 0));
  run((function* () {
    if (!RM) { cam.position.copy(at); cam.lookAt(look1); mode = 'iris'; v.copy(look1).project(cam); irisC.set(v.x * .5 + .5, v.y * .5 + .5);
      yield tween(.55, k => { iris = (1 - k) * 1.25; }); iris = 0; const end = new THREE.Vector3(4, 30, 33); const l0 = look1.clone(), l1 = new THREE.Vector3(-.5, 0, 1);
      yield tween(.8, k => { cam.position.lerpVectors(at, end, k); cam.lookAt(l0.clone().lerp(l1, k)); }, easeInOut); }
    else townCamera(cam);
    mode = 'town'; sh.dispose?.(); shop = null; controls.target.set(-.5, 0, 1); controls.enabled = true; controls.update(); Object.values(labels).forEach(l => l.classList.remove('gone')); busy = false;
  })());
}
window.__go = id => enter(id); window.__leave = () => leave(); window.__act = () => $('#t-act').click(); window.__proof = on => drawer(on);
window.__state = () => ({ mode, busy, shop: shop?.id || null });

if (P.has('2d') || !webgl) { import('./flat.js').then(m => m.flat()); } else boot();
