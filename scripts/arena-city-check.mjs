// City check for Vault Arena: the approved Ferry tray, at 1280x800 and 390x844, inside
// the town (not the standalone page). Saves a PNG per width and reports layout facts the
// audit asked for: one gold CTA, tap-target size, overlap, overflow, console errors.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.CITY_BASE || 'http://127.0.0.1:5173';
const URL_CITY = `${BASE}/?mode=2d&nostory&shop=arena`;
const widths = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch();
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
  await page.goto(URL_CITY, { waitUntil: 'domcontentloaded' });
  // Open the shop card if the town requires a click, then settle.
  await page.waitForTimeout(2500);
  const tray = page.locator('[data-testid="arena-live"]');
  if (await tray.count() === 0) {
    await page.goto(`${BASE}/shops/arena/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1200);

  const facts = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="arena-live"]');
    const gold = [...document.querySelectorAll('#shopUI [data-testid="arena-live"] button.primary, #shopUI [data-testid="arena-live"] .ferry-cta')];
    const cta = gold[0] || null;
    const r = cta?.getBoundingClientRect();
    const tabs = [...document.querySelectorAll('#shopUI [data-testid="arena-live"] .ferry-tab')].map(b => b.textContent.trim());
    const fields = [...document.querySelectorAll('#shopUI [data-testid="arena-live"] .ferry-field')].length;
    const status = [...document.querySelectorAll('#shopUI [data-testid="arena-live"] .arena-status')].map(p => p.textContent.trim());
    const cardBox = card?.getBoundingClientRect();
    const overflow = card ? [...card.querySelectorAll('input,button,select,textarea')].filter(el => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > (cardBox.right + 1) || b.left < (cardBox.left - 1));
    }).length : -1;
    const hiddenFields = card ? [...card.querySelectorAll('input,select,textarea')].filter(el => {
      const b = el.getBoundingClientRect();
      return b.width === 0 || b.height === 0;
    }).length : -1;
    return {
      hasCard: !!card,
      tabs,
      goldCount: gold.length,
      ctaLabel: cta?.textContent.trim() || '',
      ctaH: r ? Math.round(r.height) : 0,
      ctaW: r ? Math.round(r.width) : 0,
      ctaInView: r ? (r.top >= 0 && r.bottom <= innerHeight + 1) : false,
      fields,
      status,
      overflow,
      hiddenFields,
      bodyScrollX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  const shot = `${OUT}/arena-city-${w.name}-${w.width}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  console.log(JSON.stringify({ width: w.name, ...facts, errors: errors.slice(0, 6), shot }, null, 1));
  await page.close();
}

// Attack tab: the held state shows the two human buttons.
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL_CITY, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const attackTab = page.locator('#shopUI [data-testid="arena-live"] .ferry-tab', { hasText: 'Attack' });
if (await attackTab.count()) await attackTab.first().click();
await page.waitForTimeout(600);
const attackFacts = await page.evaluate(() => {
  const cta = document.querySelector('#shopUI [data-testid="arena-live"] [data-act="attack"]');
  const r = cta?.getBoundingClientRect();
  const box = document.querySelector('#shopUI [data-testid="arena-live"] #a-txt');
  const b = box?.getBoundingClientRect();
  return {
    attackCta: cta?.textContent.trim() || '',
    attackCtaH: r ? Math.round(r.height) : 0,
    attackCtaInView: r ? (r.top >= 0 && r.bottom <= innerHeight + 1) : false,
    messageBox: !!box,
    messageH: b ? Math.round(b.height) : 0,
    select: !!document.querySelector('#shopUI [data-testid="arena-live"] select[name="attackId"]'),
    liveFee: document.querySelector('#shopUI [data-testid="arena-live"] input[name="liveFee"]')?.value || '',
  };
});
await page.screenshot({ path: `${OUT}/arena-city-attack-1280.png` });
console.log(JSON.stringify({ attack: attackFacts }, null, 1));
await browser.close();
