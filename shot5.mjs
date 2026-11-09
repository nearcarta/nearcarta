import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
p.on('console', m => { if (m.type()==='error') console.log('ERR', m.text().slice(0,120)); });
await p.goto('https://nearcarta.vercel.app/?shop=guard', { waitUntil:'load', timeout: 60000 });
await p.waitForTimeout(14000);
const info = await p.evaluate(() => {
  const t = document.querySelector('#shopUI #tray');
  const r = t?.getBoundingClientRect();
  const ld = document.querySelector('#room-loading, .room-loading, [data-testid=room-loading]');
  return { trayRect: r && {x:r.x,y:r.y,w:r.width,h:r.height}, trayHidden: t?.hidden, bodyText: document.body.innerText.slice(0,120), webgl: !!document.createElement('canvas').getContext('webgl2') };
});
console.log(JSON.stringify(info));
const tray = await p.locator('#shopUI #tray').first();
await tray.screenshot({ path: '/tmp/shots/tray-guard.png' }).catch(e=>console.log('trayshot', e.message.slice(0,80)));
await b.close();
