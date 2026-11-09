// The panel design contract, asserted rather than eyeballed.
//
// The brief asks for four things to be true of EVERY shop and EVERY tab:
//   1. no scroll inside the panel on desktop
//   2. no horizontal overflow
//   3. no overlapping panel children
//   4. every button / field at least 40px tall
//
// These are the exact complaints the owner raised (buttons pasted on, spacing broken, odd
// scrolling, panels too long), so they are checked in code instead of by looking at a picture.
import { test, expect } from '@playwright/test';

// Opening a city shop loads a 3D scene, so a full nine-shop sweep is slow by nature. This is a
// load-time allowance, not a design allowance: the assertions themselves are unchanged.
test.setTimeout(180_000);

const SHOPS = ['ferry', 'guard', 'hall', 'payouts', 'arena', 'bank', 'chronicle', 'toll', 'house'];

/** Open a city shop and wait for its panel to settle. */
async function openShop(page, id) {
  await page.goto(`/design/D9_world/?shop=${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#t-proof').waitFor({ state: 'visible', timeout: 90_000 });
  await page.waitForTimeout(3000);
  await page.locator('#t-proof').click();
  await page.waitForTimeout(1200);
  await page.locator('#shopUI #tray').waitFor({ state: 'visible', timeout: 30_000 });
}

/** Every tab in the panel, by its own data-testid, so a renamed visual label cannot hide one. */
async function tabIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('#shopUI #tray [role=tab]')]
    .map(el => el.dataset.testid).filter(Boolean));
}

/** The four measurements, taken on the panel as it stands. */
async function measure(page) {
  return page.evaluate(() => {
    const tray = document.querySelector('#shopUI #tray');
    if (!tray) return { error: 'no tray' };
    const scroll = tray.querySelector(':scope > .t-scroll');
    const r = tray.getBoundingClientRect();

    // Children that are actually laid out and visible, for the overlap check.
    const kids = [...tray.querySelectorAll(':scope > .t-scroll > *, :scope > .t-row, :scope > .t-links, :scope > .rcpt')]
      .map(el => ({ el, b: el.getBoundingClientRect() }))
      .filter(({ el, b }) => b.width > 1 && b.height > 1 && getComputedStyle(el).display !== 'none');

    const overlaps = [];
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].b, c = kids[j].b;
        const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        // 1px tolerance: adjacent boxes can share an edge without being "on top of" each other.
        if (ox > 1 && oy > 1) overlaps.push({ a: kids[i].el.id || kids[i].el.className, b: kids[j].el.id || kids[j].el.className, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }

    // Clipping: a child that sticks out past the panel's own right edge.
    const clipped = kids.filter(({ b }) => b.right > r.right + 1).map(({ el }) => el.id || el.className);

    const small = [...tray.querySelectorAll('button, input, select, textarea')]
      .filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })
      .map(el => ({ id: el.id || el.dataset.testid || el.className || el.tagName, h: Math.round(el.getBoundingClientRect().height) }))
      .filter(x => x.h < 40);

    return {
      width: Math.round(r.width),
      trayScroll: tray.scrollHeight > tray.clientHeight + 1,
      innerScroll: scroll ? scroll.scrollHeight > scroll.clientHeight + 1 : false,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overlaps,
      clipped,
      small,
    };
  });
}

test.describe('shop panel design contract', () => {
  for (const id of SHOPS) {
    test(`${id}: every tab fits, with no scroll, overflow or small targets`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openShop(page, id);

      const tabs = await tabIds(page);
      // A shop with no tabs is checked once, on its default pane.
      for (const tab of tabs.length ? tabs : [null]) {
        if (tab) {
          const btn = page.getByTestId(tab);
          if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(700); }
        }
        const m = await measure(page);
        expect(m.error, `${id} ${tab || 'default'} has no panel`).toBeUndefined();

        // 1. The panel is a card, not a scroll box, on desktop.
        expect(m.trayScroll, `${id} ${tab || 'default'}: the panel scrolls`).toBe(false);
        expect(m.innerScroll, `${id} ${tab || 'default'}: the inner column scrolls`).toBe(false);

        // 2. Nothing overflows sideways.
        expect(m.sideways, `${id} ${tab || 'default'}: the page scrolls sideways`).toBe(false);
        expect(m.clipped, `${id} ${tab || 'default'}: children past the panel edge`).toEqual([]);

        // 3. Children do not sit on top of each other.
        expect(m.overlaps, `${id} ${tab || 'default'}: overlapping children`).toEqual([]);

        // 4. Touch targets are at least 40px.
        expect(m.small, `${id} ${tab || 'default'}: controls under 40px`).toEqual([]);
      }
    });
  }

  test('the panel is 320-380px wide on desktop, as the brief specifies', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const id of SHOPS) {
      await openShop(page, id);
      const w = await page.evaluate(() => Math.round(document.querySelector('#shopUI #tray').getBoundingClientRect().width));
      expect(w, `${id} panel width`).toBeGreaterThanOrEqual(320);
      expect(w, `${id} panel width`).toBeLessThanOrEqual(380);
    }
  });

  test('390x844: one column, no nested scroll, no sideways overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const id of SHOPS) {
      await openShop(page, id);
      const m = await measure(page);
      expect(m.sideways, `${id} mobile sideways`).toBe(false);
      expect(m.clipped, `${id} mobile clipped`).toEqual([]);
      expect(m.small, `${id} mobile small targets`).toEqual([]);
      // The panel itself may scroll on a phone, but only as ONE area: the inner column must not
      // scroll as well.
      expect(m.innerScroll, `${id} mobile nested scroll`).toBe(false);
    }
  });
});
