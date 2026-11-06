// Chronicle tray, matched to the city Ferry card: tabs on top, one gold action, two short lines.

export const CHRONICLE_CSS = `
.chronicle-card{
  display:flex; flex-direction:column; gap:8px; align-items:stretch; min-width:0; min-height:0; height:100%; max-width:100%;
  box-sizing:border-box; padding:16px; border-radius:22px; background:#24180f;
  border:1px solid rgba(214,180,106,.5); color:#fff8ee; overflow:hidden;
}
.chronicle-tabs{display:flex; flex:none; flex-direction:row; gap:8px;}
.chronicle-tab{
  flex:1; display:flex; align-items:center; justify-content:center; gap:8px;
  min-height:44px; padding:8px 10px; border-radius:999px; border:1px solid #e2b35b;
  background:transparent; color:#f5d08a; font:700 14px/1.1 system-ui,sans-serif; cursor:pointer;
}
body.chronicle-tray #room button.chronicle-tab,
body.chronicle-tray #shopUI #t-form button.chronicle-tab{
  appearance:none; width:auto; min-height:44px; border:1px solid #e2b35b; border-radius:999px;
  background:transparent; background-image:none; color:#f5d08a; box-shadow:none;
}
body.chronicle-tray #room button.chronicle-tab.on,
body.chronicle-tray #shopUI #t-form button.chronicle-tab.on,
body.chronicle-tray #room button.chronicle-tab[aria-selected=true],
body.chronicle-tray #shopUI #t-form button.chronicle-tab[aria-selected=true]{
  border:0;
  background-image:linear-gradient(180deg,#ffe2a8 0%,rgb(245, 208, 138) 42%,#e2b35b 100%);
  color:rgb(42, 22, 8);
}
.chronicle-pane{display:grid; gap:12px; min-width:0; min-height:0; flex:1 1 0; overflow:auto;}
.chronicle-pane[hidden]{display:none !important}
.c-filters{display:grid; grid-template-columns:1fr 1fr; gap:8px 12px}
.c-filters .wide{grid-column:1 / -1}
.c-flow{
  display:flex; flex:none; align-items:center; justify-content:center; gap:16px; min-height:52px; padding:8px;
  border-radius:16px; background:#140e09; border:1px solid rgba(214,180,106,.35);
}
.c-flow img,.c-flow .c-mark-lg{width:36px; height:36px; display:block}
.c-flow .c-mark-lg svg{width:36px; height:36px; display:block}
.c-flow .c-arrow{color:#f5d08a; font:700 18px/1 system-ui,sans-serif}
.chronicle-field{display:flex; flex-direction:column; gap:4px; margin:0; color:#f3ead8; font:650 13px/1.2 system-ui,sans-serif}
.chronicle-field input,.chronicle-field select,.chronicle-field textarea{
  width:100%; min-height:44px; box-sizing:border-box; padding:10px 12px; border-radius:12px;
  border:1px solid #4a3a28; background:#17130f; color:#fff8ee; font:600 15px/1.3 system-ui,sans-serif;
}
.chronicle-field textarea{min-height:88px; resize:vertical}
.chronicle-check{display:flex; align-items:center; gap:10px; min-height:44px; color:#f3ead8; font:600 13px/1.3 system-ui,sans-serif}
.chronicle-check input{width:20px; height:20px}
.chronicle-card .feed{list-style:none; margin:0; padding:0; display:grid; gap:6px; max-height:96px; min-height:0; flex:none; overflow:auto}
.c-empty-line{margin:0; color:#f3ead8; font:600 14px/1.4 system-ui,sans-serif; overflow-wrap:anywhere}
.c-health{margin:0; color:#f5d08a; font:650 13px/1.35 system-ui,sans-serif; overflow-wrap:anywhere}
.c-cover-list{list-style:none; margin:0; padding:0; display:grid; gap:2px}
.c-cover-list li{margin:0; color:#f3ead8; font:600 13px/1.35 system-ui,sans-serif; overflow-wrap:anywhere}
.chronicle-card .feed[hidden]{display:none !important}
.chronicle-card .feed li{
  display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:4px 8px; align-items:center;
  margin:0; padding:4px 8px; border-radius:12px; background:#17130f; border:1px solid #4a3a28; color:#fff8ee;
}
.chronicle-card .c-rowline{display:flex; flex-wrap:wrap; gap:6px; align-items:baseline; min-width:0}
.chronicle-card .feed li.c-empty{display:none}
.chronicle-card .c-mark{display:flex; gap:6px; align-items:center}
.chronicle-card .c-shop{font:700 14px/1.2 system-ui,sans-serif; color:#fff8ee; white-space:nowrap; flex:none}
.chronicle-card .c-dec{color:#f3ead8; font:600 13px/1.3 system-ui,sans-serif; white-space:normal}
.chronicle-card .c-amt{color:#f3ead8; font:600 13px/1.3 system-ui,sans-serif; white-space:nowrap}
.chronicle-card .feed li.no .c-dec,.chronicle-card .feed li.fail .c-dec{color:#ffb4a8}
.chronicle-card .c-tx{color:#f5d08a; font:600 13px/1.2 system-ui,sans-serif; white-space:nowrap; flex:none}
body.chronicle-tray #room button.c-v,
body.chronicle-tray #room button.chronicle-quiet,
body.chronicle-tray #shopUI #t-form button.c-v,
body.chronicle-tray #shopUI #t-form button.chronicle-quiet{
  appearance:none; width:auto; border:0; background:transparent; background-image:none; color:#f5d08a;
  min-height:44px; padding:8px 10px; box-shadow:none; font:700 13px/1.2 system-ui,sans-serif; cursor:pointer;
  white-space:nowrap; flex:none;
}
body.chronicle-tray #room button.chronicle-quiet:disabled,
body.chronicle-tray #shopUI #t-form button.chronicle-quiet:disabled{
  opacity:.45; cursor:default;
}
body.chronicle-tray #room button.chronicle-gold,
body.chronicle-tray #shopUI #t-form button.chronicle-gold{
  appearance:none; flex:none; width:100%; border:0; border-radius:14px; min-height:48px; padding:12px 16px; margin:0;
  background-image:linear-gradient(180deg,#ffe2a8 0%,rgb(245, 208, 138) 42%,#e2b35b 100%);
  background-color:rgb(245, 208, 138); color:rgb(42, 22, 8); font:700 16px/1.15 system-ui,sans-serif; cursor:pointer;
  box-shadow:0 1px 0 rgba(255,255,255,.55) inset, 0 4px 0 #9a6f2e;
}
.c-lines{display:flex; flex-direction:column; gap:6px; flex:1 1 150px; min-height:0; overflow:auto}
.c-foot{display:flex; flex-direction:column; align-items:stretch; gap:4px; min-height:44px}
.c-foot .c-status{min-width:0}
.c-foot .chronicle-quiet{align-self:flex-end}
.c-status{
  margin:0; color:#f3ead8; font:600 13px/1.45 system-ui,sans-serif; overflow-wrap:anywhere; white-space:normal;
}
button.chronicle-quiet:disabled, button#c-csv:disabled{opacity:.45; cursor:default}
.c-status a{color:#f5d08a}
.chronicle-seal{display:none !important}
body.chronicle-tray #shopUI #t-say,
body.chronicle-tray #shopUI #t-act,
body.chronicle-tray #shopUI .t-head,
body.chronicle-tray #shopUI #t-label,
body.chronicle-tray #shopUI #t-hero,
body.chronicle-tray #shopUI #t-rcpt,
body.chronicle-tray #shopUI .t-links,
body.chronicle-tray #shopUI #t-track{display:none !important}
body.chronicle-tray nav.all-shops{top:16px; left:370px; right:auto}
body.chronicle-tray #shopUI #tray{
  display:flex; flex-direction:column;
  width:min(440px, calc(100vw - 24px)); max-width:440px;
  left:12px; bottom:16px; height:min(680px, calc(100dvh - 132px)); max-height:calc(100dvh - 132px);
  padding:14px; box-sizing:border-box; overflow:hidden; background:#1a140f;
  transition:height .18s ease;
}
body.chronicle-tray #shopUI #t-form{display:flex; flex:1 1 auto; min-height:0; margin:0; min-width:0; max-width:100%; overflow:hidden}
body.chronicle-tray #shopUI #t-form > *{flex:1 1 auto; min-height:0; display:flex; flex-direction:column}
#chronicle-agent-dock{
  position:fixed; right:20px; bottom:22px; z-index:70;
  display:flex; flex-direction:row; align-items:flex-end; gap:12px; pointer-events:none;
}
#chronicle-agent-dock > *, #chronicle-agent-dock .chronicle-agent-send{pointer-events:auto}
#chronicle-agent-dock[hidden]{display:none !important}
.chronicle-agent-char{
  position:relative; display:flex; flex-direction:column; align-items:center; gap:6px;
  width:96px; min-height:44px; padding:0; border:0; background:transparent; cursor:pointer; color:#fff8ee;
}
.chronicle-agent-avatar{width:72px; height:72px; object-fit:contain; display:block; filter:drop-shadow(0 10px 18px rgba(0,0,0,.45))}
.chronicle-agent-badge{
  position:absolute; top:-2px; right:6px; z-index:1; width:26px; height:26px; border-radius:999px;
  background:#fff; color:#2a1608; font:800 15px/26px system-ui,sans-serif; text-align:center;
}
.chronicle-agent-name{margin:0; color:#f5d08a; font:700 11px/1.2 system-ui,sans-serif; letter-spacing:.05em; text-transform:uppercase}
.chronicle-agent-pop{
  width:min(300px, calc(100vw - 140px)); box-sizing:border-box; padding:10px; border-radius:14px;
  border:1px solid rgba(214,180,106,.4); background:#1f1a15; display:grid; gap:8px;
  box-shadow:0 12px 28px rgba(0,0,0,.4);
}
.chronicle-agent-pop[hidden]{display:none !important}
.chronicle-agent-log{margin:0; color:#f5d08a; font:600 13px/1.35 system-ui,sans-serif; overflow-wrap:anywhere}
.chronicle-agent-row{display:grid; grid-template-columns:minmax(0,1fr) 44px; gap:8px}
.chronicle-agent-pop input{
  width:100%; min-width:0; box-sizing:border-box; min-height:44px; padding:0 12px; border-radius:10px;
  border:1px solid #4a3a28; background:#17130f; color:#fff8ee; font:500 14px/1.2 system-ui,sans-serif;
}
.chronicle-agent-send{
  width:44px; min-width:44px; height:44px; border:0; border-radius:10px; cursor:pointer;
  background:#17130f; color:#f5d08a; font:700 16px/1 system-ui,sans-serif;
}
@media (max-width:720px){
  body.chronicle-tray #shopUI #tray{
    width:min(440px, calc(100vw - 16px)); max-width:none;
    left:8px; top:52px; bottom:140px; height:auto; max-height:none; padding:8px;
  }
  .chronicle-card{gap:6px; padding:10px}
  .chronicle-field{gap:2px}
  body.chronicle-tray #room button.chronicle-tab,
  body.chronicle-tray #shopUI #t-form button.chronicle-tab{min-height:40px; padding:6px 4px}
  body.chronicle-tray nav.all-shops{top:8px; left:8px; right:auto}
  .chronicle-card{padding:12px; gap:8px}
  .c-flow{min-height:44px; padding:4px}
  .c-filters{gap:8px 12px}
  .chronicle-card .feed{max-height:88px}
  .chronicle-tab{font-size:13px; padding:8px 6px}
  #chronicle-agent-dock{right:8px; bottom:calc(12px + env(safe-area-inset-bottom, 0px)); gap:8px}
  .chronicle-agent-pop{width:min(240px, calc(100vw - 120px))}
}
`;

export function ensureChronicleStyle(doc) {
  if (!doc?.getElementById || !doc.createElement) return;
  if (doc.getElementById('chronicle-tray-style')) return;
  const s = doc.createElement('style');
  s.id = 'chronicle-tray-style';
  s.textContent = CHRONICLE_CSS;
  (doc.head || doc.documentElement).appendChild(s);
}
