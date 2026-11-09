import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const fails = [];
p.on('response', r => { if (r.status() >= 400) fails.push(r.status()+' '+r.url().slice(0,110)); });
p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,140)));
for (const [n, path] of [['guard','/?shop=guard'],['bank','/?shop=bank'],['ferry','/?shop=ferry'],['arena','/?shop=arena'],['payouts','/?shop=payouts']]) {
  await p.goto('https://nearcarta.vercel.app'+path, { waitUntil:'load', timeout: 60000 }).catch(e=>console.log(n,'nav fail',e.message.slice(0,80)));
  await p.waitForTimeout(11000);
  await p.screenshot({ path: `/tmp/shots/prod-${n}.png` });
  const t = await p.locator('#shopUI').innerText().catch(()=> 'NO SHOPUI');
  console.log('---', n, '---'); console.log(t.slice(0,300).replace(/\n+/g,' | '));
}
console.log('FAILED REQUESTS:'); fails.slice(0,12).forEach(f=>console.log(' ',f));
await b.close();
