import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,160)));
for (const [n, path] of [['guard','/?shop=guard'],['bank','/?shop=bank'],['ferry','/?shop=ferry'],['hall','/?shop=hall'],['house','/?shop=house'],['arena','/?shop=arena'],['payouts','/?shop=payouts'],['toll','/?shop=toll']]) {
  await p.goto('http://127.0.0.1:5173'+path, { waitUntil:'load', timeout: 60000 }).catch(e=>console.log(n,'nav fail'));
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `/tmp/shots/${n}3.png` });
  const t = await p.locator('#shopUI').innerText().catch(()=> 'NO SHOPUI');
  console.log('---', n, '---'); console.log(t.slice(0,420).replace(/\n+/g,' | '));
}
await b.close();
