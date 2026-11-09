import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const shots = [
  ['city', '/'],
  ['shop-guard', '/?shop=guard'],
  ['shop-bank', '/?shop=bank'],
  ['shop-ferry', '/?shop=ferry'],
  ['shop-hall', '/?shop=hall'],
  ['setup', '/setup'],
];
for (const [name, path] of shots) {
  await p.goto('http://127.0.0.1:5173' + path, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => console.log(name, 'nav', e.message));
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: false }).catch(e => console.log(name, e.message));
  console.log('shot', name);
}
await b.close();
