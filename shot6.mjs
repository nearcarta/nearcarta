import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
for (const [n, path] of [['ferry','/?mode=2d&nostory&shop=ferry'],['guard','/?mode=2d&nostory&shop=guard'],['bank','/?mode=2d&nostory&shop=bank'],['house','/?mode=2d&nostory&shop=house'],['arena','/?mode=2d&nostory&shop=arena'],['hall','/?mode=2d&nostory&shop=hall'],['payouts','/?mode=2d&nostory&shop=payouts']]) {
  await p.goto('http://127.0.0.1:5173'+path, { waitUntil:'load', timeout: 60000 }).catch(e=>console.log(n,'navfail'));
  await p.waitForTimeout(7000);
  await p.screenshot({ path: `/tmp/shots/2d-${n}.png` });
  const t = await p.locator('#shopUI').innerText().catch(()=> 'NO SHOPUI');
  console.log('---', n, '---'); console.log(t.slice(0,500).replace(/\n+/g,' | '));
}
await b.close();
