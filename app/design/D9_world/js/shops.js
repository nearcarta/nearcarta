// Shop interiors inside the town page. The rooms are D8's modules (design/D8_shops/shops/*.js, read-only), imported at
// runtime by URL so a host that swaps D8's data/live.js for live reads still gets them. The town's renderer draws them;
// the tray and proof drawer below are the D8 tray (one primary action + proof), restyled in world.css (#shopUI).
// The room is backed by the town's own sky and sea at the current hour, never an empty void.
import * as THREE from 'three';
import { skyCols } from './world.js';
const D8=new URL('../../D8_shops/',import.meta.url).href;
const $=s=>document.querySelector(s);
let core=null; const core8=()=>core||(core=import(D8+'js/core.js'));
// Real app flows: every room runs D8's shop app (js/shopui.js) on the visitor's own wallet and charter.
// ?scripted keeps the old one-click scripted demo for captures only.
export const APP=!/[?&]scripted\b/.test(location.search);
document.body.dataset.host='d9'; // D8's shop app leaves the town HUD wallet (#wallet) alone
let ui=null; const ui8=()=>ui||(ui=import(D8+'js/shopui.js').then(m=>{ m.boot(); return m; }).catch(e=>{ ui=null; throw e; }));
export const L={ sh:null, C8:null };
const SRC={ mainnet:'mainnet', live:'live read', split:'mainnet', quote:'mainnet quote' };
export const NETMAIN={ bank:'mainnet', payouts:'mainnet', chronicle:'mainnet' };
export const srcLabel=(id,src)=>NETMAIN[id]||SRC[src]||'mainnet';
import { NAME as NAMES, paintTrack } from '../../D8_shops/js/names.js';
// The reference header: a round gold-ringed icon badge beside the shop name. The badge is
// presentation only — the same title text, with the shop's own 3D icon in front of it.
import { badge as shopBadge, headerArt } from '/panels/shop-identity.js';
import { roomError } from '/room-error.js';
export function setResult(kind,text){ const b=$('#t-act'); b.classList.remove('busy'); b.className='act res '+kind; b.disabled=true; b.innerHTML=`<span class="glyph" aria-hidden="true">${kind==='no'?'✕':kind==='ok'?'✓':'○'}</span>`; b.append(text); b.setAttribute('aria-live','polite'); }
export function setHero(html){ const h=$('#t-hero'); h.innerHTML=html; h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump'); }
export function drawer(on){ const d=$('#drawer'); d.classList.toggle('open',on); d.setAttribute('aria-hidden',on?'false':'true'); $('#t-proof').setAttribute('aria-expanded',String(on)); if(on) $('#d-close').focus(); }
export const drawerOpen=()=>$('#drawer').classList.contains('open');
// warm it now (core + three addons + the D2 tile set) so the first door does not wait on the network
export function preload(){ return core8().then(()=>APP&&ui8()).catch(()=>null); }
// build one room; resolves {sh} or {err}
export async function load(id, bust){
  try{ const C8=L.C8=await core8(); const mod=await import(D8+'shops/'+id+'.js'+(bust?`?r=${bust}`:'')); const tk={}; const live=()=>L.sh&&L.sh.tk===tk;
    const sh=await mod.default({ setResult:(...a)=>live()&&!APP&&setResult(...a), setHero:(...a)=>live()&&setHero(...a), live }); sh.id=id; sh.tk=tk; dress(sh.scene); return {sh}; }
  catch(err){ console.error(`[Nearcarta] shop "${id}" failed to load:`,err); return {err}; } }
// back the room with the town's evening: sky gradient, the sea under the island, and a fog that melts the sea into the horizon
function dress(scene){ const k=skyCols(); const c=document.createElement('canvas'); c.width=4; c.height=256; const x=c.getContext('2d'); const g=x.createLinearGradient(0,0,0,256);
  g.addColorStop(0,'#'+k.top.getHexString()); g.addColorStop(.55,'#'+k.mid.getHexString()); g.addColorStop(1,'#'+k.hor.getHexString()); x.fillStyle=g; x.fillRect(0,0,4,256);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; scene.background=t; scene.fog=new THREE.Fog(k.hor,16,48);
  const bb=new THREE.Box3().setFromObject(scene); const y=isFinite(bb.min.y)?bb.min.y+.1:-.3;
  const sea=new THREE.Mesh(new THREE.CircleGeometry(80,48),new THREE.MeshLambertMaterial({color:k.sea.clone().lerp(k.deep,.35)})); sea.rotation.x=-Math.PI/2; sea.position.y=y; sea.receiveShadow=true; scene.add(sea); scene.userData.dressed=true; }
// shift the room right so the tray (bottom-left) never covers the subject on wide screens
// desktop: room shifted right of the tray. Portrait: pulled back (fit) and lifted above the bottom tray.
export function frame(c){ const a=innerWidth/innerHeight; c.aspect=a; const ox=innerWidth>900?-260:0, oy=a<1?Math.round(innerHeight*.13):0; c.setViewOffset(innerWidth,innerHeight,ox,oy,innerWidth,innerHeight); c.updateProjectionMatrix();
  return a<1?Math.min(1.8,1+(1-a)*1.3):a<1.3?1.12:1; }
// every room that is about rules offers the way to write your own: Your House is the Charter office
const CTA={ house:"Set your agent's rules →", guard:'Write a rule like this for your agent →', arena:'Put your own charter in the arena →' };
const CTA_APP={ house:'Open the charter office →' };
export function cta(id){ const a=$('#t-cta'); const t=(APP?CTA_APP:CTA)[id]; a.hidden=!t; a.className=APP?'link cta8':'act primary cta'; if(t){ a.textContent=t; a.href='/shops/vault/'; a.dataset.testid='vault-link'; } }
const visitorNote=note=>note||'';
export function skeleton(id){ $('#t-title').innerHTML=`${shopBadge(id)}<span>${NAMES[id]||id}</span>${headerArt(id)}`; paintTrack(id); $('#t-label').textContent='Loading this room…'; $('#t-hero').innerHTML='<span class="skel" data-testid="room-skel"></span>'; const say=$('#t-say'); if(say) say.textContent=''; }
export function show(sh){ L.sh=sh; cta(sh.id); const p=sh.panel; const titleText=p.title||NAMES[sh.id]; $('#t-title').innerHTML=`${shopBadge(sh.id)}<span>${titleText}</span>${headerArt(sh.id)}`; const s=$('#t-src'); s.textContent=srcLabel(sh.id,p.src); s.className='src '+p.src; s.title=visitorNote(p.srcNote);
  $('#t-label').textContent=p.label; paintTrack(sh.id); $('#t-hero').innerHTML=p.hero; const b=$('#t-act'); b.className='act primary'; b.disabled=false; b.hidden=!p.action; b.textContent=p.action||'';
  { const m=$('#t-more'); m.hidden=!p.more; if(p.more){ m.href=p.more.href; m.textContent=p.more.text; } }
  $('#d-title').textContent=(p.title||NAMES[sh.id]); $('#d-body').innerHTML=sh.proof+'<p class="note legal">Nearcarta is independent, not affiliated with NEAR Foundation.</p>';
  sh.tags?.forEach(t=>{ if(t.html){ t.el=document.createElement('div'); t.el.className='stag '+(t.cls||''); t.el.innerHTML=t.html; $('#stags').appendChild(t.el); } }); frame(sh.camera);
  document.body.classList.toggle('apps',APP); $('#t-say').hidden=!APP; if(!APP) return;
  b.hidden=false; b.disabled=true; if (sh.id === 'payouts') { skeleton(sh.id); b.textContent = 'Pay under the cap'; }
  else if (!b.textContent.trim()) b.textContent='Opening…';
  const go=()=>ui8().then(m=>{ if(L.sh?.id===sh.id) m.mount(sh.id,L.sh,g=>L.C8.run(g)); }).catch(e=>{ if(L.sh?.id!==sh.id) return; console.warn('[Nearcarta] shop app failed to load',e); b.disabled=false; b.textContent='Try again'; b.dataset.retry=sh.id; });
  go(); setTimeout(()=>{ if(L.sh?.id===sh.id&&b.disabled&&/^(Opening…|Sign in)$/.test(b.textContent.trim())){ b.textContent='Still opening this shop'; go(); } },2000); }
export const rulesOpen=()=>!!ui&&$('#rules').classList.contains('open');
export function closeRules(){ ui?.then(m=>m.closeRules()); }
export function showError(id,err){ $('#t-title').textContent=NAMES[id]||id; paintTrack(id); const s=$('#t-src'); s.textContent='error'; s.className='src error'; $('#t-label').textContent='This room could not load'; $('#t-hero').innerHTML='';
  const b=$('#t-act'); b.hidden=false; b.disabled=false; b.className='act primary'; b.textContent='Try again'; b.dataset.retry=id; $('#d-title').textContent='Error'; $('#d-body').textContent=roomError(err); }
export function act(){ if(APP) return false; const sh=L.sh; const b=$('#t-act'); if(!sh?.act||b.disabled) return false; b.disabled=true; b.classList.add('busy'); L.C8.run(sh.act()); return true; }
const v=new THREE.Vector3();
export function tick(dt){ const sh=L.sh, C8=L.C8; if(!C8) return; C8.clock.T+=dt; C8.tickRoutines(); if(sh) sh.update?.(dt,C8.clock.T); }
export function placeTags(){ const sh=L.sh; if(!sh?.tags) return; const w=innerWidth,h=innerHeight; for(const t of sh.tags){ if(!t.el) continue; if(t.obj){ t.obj.updateMatrixWorld(); v.setFromMatrixPosition(t.obj.matrixWorld).add(t.pos); } else v.copy(t.pos); v.project(sh.camera); const x=(v.x*.5+.5)*w, y=(-v.y*.5+.5)*h; t.el.style.transform=`translate(${x|0}px,${y|0}px) translate(-50%,-100%)`; t.el.style.visibility=v.z<1?'':'hidden'; } }
export function clear(){ const sh=L.sh; L.sh=null; $('#stags').innerHTML=''; drawer(false); if(ui) ui.then(m=>m.unmount()).catch(()=>{}); $('#t-form').hidden=true; $('#t-form').innerHTML=''; $('#t-rcpt').innerHTML=''; const say=$('#t-say'); if(say){ say.hidden=true; say.textContent=''; } if(!sh) return; L.C8?.killAll(); try{ sh.dispose?.(); }catch(e){} sh.scene.background?.dispose?.(); }
