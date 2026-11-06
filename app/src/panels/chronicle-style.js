// Opaque Chronicle tray. Injected with the room so the city page and /shops/chronicle/ share it.
// Brass faces keep the recorded button check: border 0 and a gold gradient.

export const CHRONICLE_CSS = `
.chronicle-card{
  display:grid; grid-template-columns:112px minmax(0,1fr); gap:16px; align-items:start;
  padding:16px; border-radius:16px; background:#1a140f; border:1px solid rgba(214,180,106,.45);
  color:#fff8ee; min-width:0; max-width:100%; box-sizing:border-box;
}
.chronicle-tabs{display:flex; flex-direction:column; gap:8px; grid-column:1; grid-row:1;}
.chronicle-tab{
  display:flex; align-items:center; justify-content:flex-start; gap:8px;
  min-height:44px; padding:8px 10px; border:0; border-radius:12px;
  background:#17130f; color:#f3ead8; font:700 14px/1.1 system-ui,sans-serif; cursor:pointer;
}
.chronicle-tab .c-ico{flex:none}
.chronicle-tab.on,.chronicle-tab[aria-selected=true]{
  background-image:linear-gradient(180deg,#ffe2a8 0%,rgb(245, 208, 138) 42%,#e2b35b 100%);
  color:rgb(42, 22, 8);
}
.chronicle-main{grid-column:2; grid-row:1; display:grid; gap:16px; min-width:0;}
.chronicle-pane{display:grid; gap:14px; min-width:0;}
.chronicle-pane[hidden]{display:none !important}
.chronicle-field{display:flex; flex-direction:column; gap:8px; margin:0; color:#f3ead8; font:650 13px/1.2 system-ui,sans-serif}
.chronicle-field input,.chronicle-field select{
  width:100%; min-height:44px; box-sizing:border-box; padding:0 12px; border-radius:12px;
  border:1px solid #4a3a28; background:#17130f; color:#fff8ee; font:600 15px/1.2 system-ui,sans-serif;
}
.chronicle-card .feed{list-style:none; margin:0; padding:0; display:grid; gap:12px}
.chronicle-card .feed li{
  display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:8px 12px; align-items:center;
  margin:0; padding:12px; border-radius:12px; background:#17130f; border:1px solid #4a3a28; color:#fff8ee;
}
.chronicle-card .c-mark{display:flex; gap:6px; align-items:center}
.chronicle-card .c-shop{font:700 14px/1.2 system-ui,sans-serif; color:#fff8ee; white-space:nowrap}
body.chronicle-tray nav.all-shops{top:12px;left:auto;right:168px}
.chronicle-card .c-dec,.chronicle-card .c-amt{color:#f3ead8; font:600 13px/1.3 system-ui,sans-serif}
.chronicle-card .c-tx{color:#f5d08a; font:600 13px/1.2 system-ui,sans-serif; overflow-wrap:anywhere}
.chronicle-card button.primary,.chronicle-card button.c-v,
body.chronicle-tray #shopUI .chronicle-card button.primary,
body.chronicle-tray #shopUI .chronicle-card button.c-v{
  border:0; border-radius:14px; min-height:44px; padding:10px 16px; margin:0;
  background-image:linear-gradient(180deg,#ffe2a8 0%,rgb(245, 208, 138) 42%,#e2b35b 100%);
  background-color:transparent;
  color:rgb(42, 22, 8); font:700 14px/1.15 system-ui,sans-serif; cursor:pointer;
  box-shadow:0 1px 0 rgba(255,255,255,.55) inset, 0 4px 0 #9a6f2e, 0 8px 14px rgba(0,0,0,.28);
}
body.chronicle-tray #shopUI #tray{
  width:min(460px,calc(100vw - 28px)); max-width:460px;
  left:16px; bottom:18px; max-height:calc(100dvh - 112px);
  padding:18px 16px 16px; box-sizing:border-box; overflow-x:hidden; overflow-y:auto;
  background:#1a140f;
}
body.chronicle-tray #shopUI #t-form{margin:0;min-width:0;max-width:100%}
body.chronicle-tray #shopUI .chronicle-tab{background:#17130f;color:#f3ead8;border:0}
body.chronicle-tray #shopUI .chronicle-tab.on,
body.chronicle-tray #shopUI .chronicle-tab[aria-selected=true]{
  background-image:linear-gradient(180deg,#ffe2a8 0%,rgb(245, 208, 138) 42%,#e2b35b 100%);
  color:rgb(42, 22, 8);
}
.chronicle-actions{display:flex; flex-wrap:wrap; gap:14px; align-items:center}
.chronicle-card .c-pages{margin:0; color:#f3ead8; font:600 13px/1.3 system-ui,sans-serif}
.chronicle-seal{
  margin:0; padding:10px 12px; border-radius:12px; background:#3a1614; color:#ffe8e4;
  border:1px solid #c46a62; font:700 14px/1.35 system-ui,sans-serif;
}
.chronicle-seal[hidden]{display:none !important}
.chronicle-out{margin:0; color:#fff8ee; font:600 13px/1.4 system-ui,sans-serif; overflow-wrap:anywhere; max-height:88px; overflow:auto}
.chronicle-source{margin:0; color:#f3ead8; font:600 12px/1.35 system-ui,sans-serif}
#chronicle-agent-dock{
  position:fixed; right:20px; bottom:22px; z-index:70;
  display:flex; flex-direction:row; align-items:flex-end; gap:12px; pointer-events:none;
}
#chronicle-agent-dock > *, #chronicle-agent-dock .chronicle-agent-send{pointer-events:auto}
#chronicle-agent-dock[hidden]{display:none !important}
.chronicle-agent-char{
  position:relative; display:flex; flex-direction:column; align-items:center; gap:6px;
  width:96px; padding:0; border:0; background:transparent; cursor:pointer; color:#fff8ee;
}
.chronicle-agent-avatar{
  width:72px; height:72px; object-fit:contain; display:block;
  filter:drop-shadow(0 10px 18px rgba(0,0,0,.45));
}
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
  background-image:linear-gradient(180deg,#ffe2a8,rgb(245, 208, 138)); color:#2a1608; font:700 16px/1 system-ui,sans-serif;
}
body.chronicle-tray #shopUI .btns{gap:14px}
@media (max-width:720px){
  body.chronicle-tray #shopUI #tray{
    width:min(100vw - 16px,460px); max-width:none;
    left:8px; bottom:calc(8px + env(safe-area-inset-bottom,0px));
    max-height:min(62dvh,calc(100dvh - 96px)); padding:14px 12px;
  }
  .chronicle-card{grid-template-columns:minmax(0,1fr); padding:12px}
  .chronicle-tabs{grid-row:1; grid-column:1; flex-direction:row}
  .chronicle-main{grid-row:2; grid-column:1}
  .chronicle-tab{flex:1; justify-content:center}
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
