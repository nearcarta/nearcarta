// Compose ref-vs-our-shot side-by-sides for the five shops the owner asked to see.
//
//   node e2e/ref-side-by-side.mjs
//
// Writes PNGs to /opt/cursor/artifacts/side-by-side/ and copies of the raw shots for the PR.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const REF = '/home/ubuntu/.cursor/projects/agent-repos-nearcarta/assets';
const SHOTS = process.env.SHOTS || '/tmp/ref-check';
const OUT = '/opt/cursor/artifacts/side-by-side';
mkdirSync(OUT, { recursive: true });

// Which reference each shop is judged against, and which of our views shows the same screen.
const PAIRS = [
  { shop: 'ferry', ref: 'ref-swap-shop.png', shot: 'ferry.swap', label: 'Swap Shop (Ferry)' },
  { shop: 'guard', ref: 'ref-four-shops.png', shot: 'guard.check', label: 'Check Shop (Guard)' },
  { shop: 'hall', ref: 'ref-four-shops.png', shot: 'hall.post', label: 'Jobs Shop (Town Hall)' },
  { shop: 'payouts', ref: 'ref-four-shops.png', shot: 'payouts.invoice', label: 'Invoice Shop (Payouts)' },
  { shop: 'arena', ref: 'ref-four-shops.png', shot: 'arena', label: 'Guardians Shop (Arena)' },
];

const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });

for (const { ref, shot, label, shop } of PAIRS) {
  for (const W of [1440, 390]) {
    const shotPath = `${SHOTS}/${shot}-${W}.png`;
    let shotSrc;
    try { shotSrc = b64(shotPath); } catch { console.log('missing', shotPath); continue; }
    const refSrc = b64(`${REF}/${ref}`);

    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0b0a09;font:13px/1.4 system-ui,sans-serif;color:#e8dcc4">
      <div style="padding:14px 18px;font-size:15px;font-weight:600">${label} — reference (top) vs our panel at ${W}×${W === 390 ? 844 : 900} (bottom)</div>
      <div style="display:flex;flex-direction:column;gap:12px;padding:0 18px 18px">
        <div><div style="opacity:.65;margin-bottom:4px">reference</div>
          <img src="${refSrc}" style="width:100%;max-height:520px;object-fit:contain;object-position:left top;border:1px solid #3a2f22;border-radius:8px"></div>
        <div><div style="opacity:.65;margin-bottom:4px">ours</div>
          <img src="${shotSrc}" style="width:100%;max-height:520px;object-fit:contain;object-position:left top;border:1px solid #3a2f22;border-radius:8px"></div>
      </div></body></html>`);
    await page.waitForTimeout(250);
    const out = `${OUT}/${shop}-${W}.png`;
    await page.screenshot({ path: out, fullPage: true });
    console.log('wrote', out);
  }
}
await browser.close();
