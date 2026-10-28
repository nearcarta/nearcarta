import * as THREE from 'three';
import { clock, P } from './core.js';
import { W, init, update, render, setTod } from './world.js';
const cv=document.getElementById('c');
await init(cv);
const cam=W.camera; const v=(P.get('cam')||'26,22,26,0,0,0').split(',').map(Number);
cam.position.set(v[0],v[1],v[2]); cam.lookAt(v[3],v[4],v[5]);
setTod(+(P.get('tod')??1)); W.frz=+(P.get('frz')||0);
const hide=(P.get('hide')||'').split(',').filter(Boolean); W.scene.traverse(o=>{ if(hide.includes(o.type)||hide.includes(o.material?.type)||hide.includes(o.name)) o.visible=false; if(o.isSprite&&hide.includes(o.material.color.getHexString())) o.visible=false; });
window.W=W; if(hide.includes('sea')) W.sea.visible=false; if(hide.includes('ward')) W.ward.visible=false; if(P.has('nobloom')) W.bloom.strength=0; if(P.has('nofin')) W.fin.uniforms.tilt.value=0;
for(const l of W.lamps) { l.goal=1; }
function step(dt){ clock.T+=dt; update(dt); }
window.__advance=s=>{ const n=Math.round(s*30); for(let i=0;i<n;i++) step(1/30); render(); };
for(let i=0;i<10;i++) step(1/30); render();
document.getElementById('loading').classList.add('done');
window.__ready=true;
