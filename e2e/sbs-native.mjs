import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
const REF = '/home/ubuntu/.cursor/projects/agent-repos-nearcarta/assets';
const SHOTS = '/tmp/panels-native';
const OUT = '/opt/cursor/artifacts/side-by-side';
mkdirSync(OUT, { recursive: true });
const PAIRS = [
  { shop: 'ferry', ref: 'ref-swap-shop.png', label: 'Swap Shop (Ferry)' },
  { shop: 'guard', ref: 'ref-four-shops.png', label: 'Check Shop (Guard)' },
  { shop: 'hall', ref: 'ref-four-shops.png', label: 'Jobs Shop (Town Hall)' },
  { shop: 'payouts', ref: 'ref-four-shops.png', label: 'Invoice Shop (Payouts)' },
  { shop: 'arena', ref: 'ref-four-shops.png', label: 'Guardians Shop (Arena)' },
];
const b64 = p => 'data:image/png;base64,' + readFileSync(p).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1300 } });
for (const { shop, ref, label } of PAIRS) {
  for (const W of [1440, 390]) {
    const shot = `${SHOTS}/${shop}-${W}.png`;
    if (!existsSync(shot)) { console.log('missing', shot); continue; }
    // The reference crop is the same width as the panel, so the two line up 1:1.
    await page.setContent(`<!doctype html><body style="margin:0;background:#0b0a09;font:13px/1.4 system-ui,sans-serif;color:#e8dcc4">
      <div style="padding:12px 16px;font-size:14px;font-weight:600">${label} — reference (top) vs panel (bottom), native size at ${W}px</div>
      <div style="display:flex;flex-direction:column;gap:10px;padding:0 16px 16px">
        <div><div style="opacity:.6;margin-bottom:3px">reference</div>
          <img src="${b64(`${REF}/${ref}`)}" style="max-width:${W}px;display:block;border:1px solid #3a2f22;border-radius:8px"></div>
        <div><div style="opacity:.6;margin-bottom:3px">ours</div>
          <img src="${b64(shot)}" style="max-width:${W}px;display:block;border:1px solid #3a2f22;border-radius:8px"></div>
      </div></body>`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${shop}-${W}.png`, fullPage: true });
    console.log('wrote', `${OUT}/${shop}-${W}.png`);
  }
}
await browser.close();
