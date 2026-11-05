// Nearcarta 2D / low-power fallback: no WebGL. Loaded by index.html when ?mode=2d, WebGL is missing or software-only,
// or the 3D town fails to start. Every pin opens that shop's room in place: its still picture, the same tray and the
// proof drawer as in 3D (#shopUI). Nothing leaves this page. Pins are % of the 1920x1080 still (object-fit:cover crop).
const $=s=>document.querySelector(s); const body=document.body;
const D8=new URL('../../D8_shops/',import.meta.url).href;
import { NAME as NAMES } from '../../D8_shops/js/names.js';
import { roomError } from '/room-error.js';
import { mountIntro } from './intro-dom.js';
import { beginEnter, finishEnter } from './room-lock.js';
const END={ guard:['no','Refused · not on the list'], ferry:['ok','Downgrade refused · crossed shielded'], hall:['ok','Allowed · 0.001 NEAR'] };
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let started=false;
export async function fallback(why){ if(started) return; started=true; body.classList.add('fb','ready'); $('#fb2d').hidden=false; $('#loading').classList.add('done'); $('#c').style.display='none';
  if(why) console.warn('[Nearcarta] showing the 2D town:',why);
  const introCtl=mountIntro(document, location.search);
  window.__skipTownIntro = () => introCtl?.skip();
  addEventListener('keydown',e=>{ if(e.key==='Escape') introCtl?.skip(); });
  const img=$('#fbimg'); const town=img.getAttribute('src');
  try{ const pins=await (await fetch('shots/fallback_pins.json')).json(); const box=$('#fbpins'); const els=[];
    for(const p of pins){ const d=document.createElement('button'); d.type='button'; d.className='fbpin'; d.dataset.id=p.id; d.title=p.card?`${p.name}: ${p.card}`:`Enter ${p.name}`; d.innerHTML=`<b></b><span></span>`; d.querySelector('b').textContent=p.name; d.querySelector('span').textContent=p.role; d.onclick=()=>open(p.id); box.appendChild(d); els.push([d,p]); }
    /* Pins stay clear of the HUD (brand, account row, blurb on top; rules CTA and curfew below) and of each other,
       so every shop is tappable at 390 too. Each pin hangs above its anchor (translate -50%,-100%). */
    const vis=e=>{ if(!e) return null; const r=e.getBoundingClientRect(); return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'?r:null; };
    const lay=()=>{ const W=innerWidth,H=innerHeight,s=Math.max(W/1920,H/1080),ox=(W-1920*s)/2,oy=(H-1080*s)/2;
      let top=48, bot=H-8; for(const e of document.querySelectorAll('#brand,#brand .what,#acct,#acct *')){ const r=vis(e); if(r&&r.top<H/3) top=Math.max(top,r.bottom+8); }
      for(const e of document.querySelectorAll('.hud,#rulesBtn')){ const r=vis(e); if(r&&r.top>H/2&&!e.closest('#fb2d')) bot=Math.min(bot,r.top-8); }
      const placed=[]; for(const [d,p] of els.slice().sort((a,b)=>a[1].y-b[1].y)){ const w=d.offsetWidth, h=d.offsetHeight;
        let x=Math.max(w/2+6,Math.min(W-w/2-6,ox+p.x/100*1920*s)); let y=Math.max(top+h,Math.min(bot,oy+p.y/100*1080*s));
        const clash=(x,y)=>placed.find(q=>Math.abs(q.x-x)<(q.w+w)/2+8&&Math.abs(q.y-(y-h/2))<(q.h+h)/2+6);
        for(let k=0;k<12;k++){ const hit=clash(x,y); if(!hit) break; // first try a small sideways nudge, then step down
          const dx=(q=>(q.w+w)/2+8-Math.abs(q.x-x))(hit)*(x>=hit.x?1:-1), nx=x+dx;
          if(Math.abs(dx)<w*0.6&&nx>w/2+6&&nx<W-w/2-6&&!clash(nx,y)){ x=nx; break; } y=hit.y+(hit.h+h)/2+6+h/2; }
        if(y>bot) y=bot; d.style.left=x+'px'; d.style.top=y+'px'; placed.push({x,y:y-h/2,w,h}); } };
    lay(); addEventListener('resize',lay); const acct=$('#acct'); if(acct&&'ResizeObserver' in window) new ResizeObserver(lay).observe(acct); setTimeout(lay,1500);
  }catch(e){ console.error('[Nearcarta] 2D pins failed',e); }
  const APP=!/[?&]scripted\b/.test(location.search); let ui8m=null;
  const ui=$('#shopUI'), dr=$('#drawer'); const drawer=on=>{ dr.classList.toggle('open',on); dr.setAttribute('aria-hidden',on?'false':'true'); };
  $('#t-proof').onclick=()=>drawer(true); $('#d-close').onclick=()=>drawer(false);
  const close=()=>{ generation++; fbCur=null; door=finishEnter({id:null}); drawer(false); ui.hidden=true; ui8m?.unmount(); body.classList.remove('apps'); img.onerror=null; img.src=town; body.classList.remove('in-shop'); $('#fbpins').hidden=false; };
  $('#back').onclick=close; addEventListener('keydown',e=>{ if(e.key==='Escape'&&!ui.hidden){ introCtl?.skip(); dr.classList.contains('open')?drawer(false):close(); } });
  let fbCur=null, door={busy:false,id:null}, generation=0; async function open(id, bust){ const next=beginEnter(door,id); if(next.ignored) return; door=next; const ticket=++generation; let m=null, err=null, core=null;
    try{ [core,m]=await Promise.all([import(D8+'js/core.js'),import(D8+'shops/'+id+'.js'+(bust?`?r=${bust}`:''))]); }catch(e){ err=e; console.error(`[Nearcarta 2D] shop "${id}" failed to load:`,e); }
    if(ticket!==generation) return;
    fbCur=id;
    img.onerror=null; img.src=D8+'shots/fallback_'+id+'.jpg'; /* D8 room still (shots/rooms/ was never shipped, so no 404 first) */ /* D9-dressed still (sky, sea), D8 still if missing */ $('#fbpins').hidden=true; body.classList.add('in-shop'); ui.hidden=false; { const CT={house:"Set your agent's rules →",guard:'Write a rule like this for your agent →',arena:'Put your own charter in the arena →'}, c=$('#t-cta'); c.hidden=!CT[id]; if(CT[id]){ c.textContent=CT[id]; c.href=(window.NEARCARTA_CHARTER||'/shops/vault/')+(id==='house'?'#create':''); } } $('#t-title').textContent=NAMES[id];
    const b=$('#t-act'), d=$('#d-body'), src=$('#t-src');
    if(err){ src.textContent='error'; src.className='src error'; $('#t-label').textContent='This room could not load'; $('#t-hero').innerHTML=''; b.hidden=false; b.disabled=false; b.className='act primary'; b.textContent='Try again'; b.dataset.retry=id; b.onclick=()=>open(id, Date.now());
      d.textContent=roomError(err); door=finishEnter(door); return; }
    const tok=core.tok;     const F={ guard:['mainnet','split','Invoice with a hidden instruction',tok('0.001','NEAR')], hall:['mainnet','split','Reward paid',tok('0.001','NEAR')],
      arena:['mainnet','split','5 attacks on the lab oath','<b class="num">0</b><span class="unit">breaches</span>'], toll:['mainnet','split','0.001 NEAR pass on mainnet','<b class="num">11</b><span class="unit">of 16 nodes</span>'],
      chronicle:['record','mainnet','Refusals on the record','<b class="num">2</b><span class="unit">recorded refusals</span>'], house:['mainnet','split','Tip cap',tok('0.002','NEAR')] }[id];
    const info=m.FLAT||(F&&{src:F[0],cls:F[1],label:F[2],hero:F[3]})||{src:'mainnet',cls:'mainnet',label:'',hero:''};
    src.textContent=info.src==='mainnet'?'mainnet':info.src; src.className='src '+info.cls; $('#t-label').textContent=info.label; $('#t-hero').innerHTML=info.hero;
    { const mo=$('#t-more'); mo.hidden=!m.MORE; if(m.MORE){ mo.href=m.MORE.href; mo.textContent=m.MORE.text; } }
    const end=END[id]; b.onclick=null; b.hidden=!end; if(end){ b.className='act res '+end[0]; b.disabled=true; b.textContent=end[1]; }
    d.innerHTML=(m.PROOF||'<p class="note">This room has no proof list in the 2D view.</p>')+'<p class="note legal">Nearcarta is independent, not affiliated with NEAR Foundation.</p>'; $('#d-title').textContent=NAMES[id]+' · proof';
    if(APP){ // same real wallet flows as the 3D rooms (D8 shopui), not the scripted result
      body.dataset.host='d9'; body.classList.add('apps'); $('#t-say').hidden=false; $('#t-hero').innerHTML=''; b.className='act primary'; b.hidden=false; b.disabled=true; b.textContent='Opening…';
      const c=$('#t-cta'); c.hidden=id!=='house'; c.className='link cta8'; if(id==='house'){ c.textContent='Open the charter office →'; c.href='/shops/vault/'; }
      import(D8+'js/shopui.js').then(u=>{ ui8m=u; if(ui.hidden||fbCur!==id){ door=finishEnter({id}); return; } u.mount(id,{id},()=>{}); /* mount boots the wallet and paints its own state: no waiting on "Opening…" */ b.onclick=()=>window.__apps?.primary(); door=finishEnter({id}); })
        .catch(e=>{ console.warn('[Nearcarta 2D] shop app failed to load',e); b.disabled=false; b.textContent='Try again'; b.onclick=()=>open(id); door=finishEnter({id}); }); } else door=finishEnter({id}); }
  const A={chron:'chronicle',townhall:'hall',mistbank:'bank',guardhouse:'guard',vault:'house'}; const q=new URLSearchParams(location.search).get('shop'); const start=q&&(A[q]||q); if(start&&NAMES[start]) open(start);
  window.__ready=true; }
