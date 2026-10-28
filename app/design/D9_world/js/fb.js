// Nearcarta 2D / low-power fallback: no three.js. Loaded directly by index.html when ?mode=2d or WebGL is missing.
// Every pin is a link straight into that shop's flat room (D8 ?2d&shop=<id>).
// Pins are stored in % of the 1920x1080 still; the still is shown object-fit:cover, so pins are re-mapped through the same crop.
const $=s=>document.querySelector(s); const body=document.body;
export async function fallback(){ body.classList.add('fb'); $('#fb2d').hidden=false; $('#loading').classList.add('done');
  try{ const pins=await (await fetch('shots/fallback_pins.json')).json(); const box=$('#fbpins'); const els=[];
    for(const p of pins){ const d=document.createElement('a'); d.className='fbpin'; d.dataset.id=p.id; d.href=`../D8_shops/index.html?2d&shop=${encodeURIComponent(p.id)}`; d.title=`Open ${p.name}`; d.innerHTML=`<b></b><span></span>`; d.querySelector('b').textContent=p.name; d.querySelector('span').textContent=p.role; box.appendChild(d); els.push([d,p]); }
    const lay=()=>{ const W=innerWidth,H=innerHeight,s=Math.max(W/1920,H/1080),ox=(W-1920*s)/2,oy=(H-1080*s)/2;
      for(const [d,p] of els){ const x=ox+p.x/100*1920*s, y=oy+p.y/100*1080*s; d.style.left=Math.max(70,Math.min(W-70,x))+'px'; d.style.top=Math.max(48,Math.min(H-40,y))+'px'; } };
    lay(); addEventListener('resize',lay);
  }catch(e){} window.__ready=true; }
