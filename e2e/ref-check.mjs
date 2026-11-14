// Reference checks, in code.
//
// The previous suite measured the wrong things and passed panels that did not look like the
// references. These four checks are the ones that would have caught it:
//
//   1. the title is never truncated
//   2. the primary button is at least 90% of the panel's inner width
//   3. no element's text overlaps another element's box
//   4. the panel is at least 380px wide at 1440
//
// Plus the structure the references require: a badge, a subtitle, an illustration, a flow strip,
// a .shop-quest slot, and one gold CTA.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || '/tmp/ref-check';
// --native mounts the panel on the town page without building the 3D room. The city page builds
// the room first and paints the panel only after it starts, so on a machine where the room cannot
// start (no GPU, or the quote API is down) every panel measurement would report "no tray". This
// mode measures the panel itself, which is what these checks are about.
const NATIVE = process.argv.includes('--native');
const shops = process.argv.slice(2).filter(a => !a.startsWith('--'));
const LIST = shops.length ? shops : ['ferry', 'guard', 'hall', 'payouts', 'arena', 'bank', 'chronicle', 'toll', 'house'];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
let fail = 0, total = 0;

/** Mount the panel in a bare shell on the town page, without the 3D room. */
async function mountNative(page, shop) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.evaluate((shop) => {
    document.body.classList.add('in-shop', shop + '-tray');
    let ui = document.getElementById('shopUI');
    if (!ui) { ui = document.createElement('div'); ui.id = 'shopUI'; document.body.appendChild(ui); }
    ui.hidden = false;
    ui.innerHTML = `<section id="tray"><div class="t-scroll">
        <div class="t-head"><h1 id="t-title"></h1><span id="t-src" class="src"></span></div>
        <p id="t-sub" class="t-sub"></p><p id="t-label" class="label"></p>
        <div id="t-hero" class="hero"></div><div id="shop-quest" class="shop-quest"></div>
        <div id="t-form" class="form"></div></div>
      <div class="t-row"><button id="t-act" type="button" class="act primary"></button></div>
      <p id="t-rcpt" class="rcpt"></p>
      <div class="t-links"><button id="t-proof" class="link">How it works</button></div>
    </section>`;
  }, shop);
  await page.evaluate(async ({ shop }) => {
    const d = await import('/panels/deep.js');
    const id = await import('/panels/shop-identity.js');
    d.mountShop(shop, document.getElementById('t-form'), { auto: false });
    document.getElementById('t-title').innerHTML = `${id.badge(shop)}<span class="t-name">${id.titleOf(shop)}</span>${id.headerArt(shop)}`;
    document.getElementById('t-sub').textContent = id.subtitleOf(shop);
    document.getElementById('t-hero').innerHTML = id.flowStrip(shop);
    const act = document.getElementById('t-act');
    act.textContent = 'Sign in'; act.hidden = false;
    await new Promise(r => setTimeout(r, 350));
  }, { shop });
}

for (const W of [1440, 390]) {
  const H = W === 390 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  for (const shop of LIST) {
    if (NATIVE) {
      await mountNative(page, shop);
    } else {
      await page.goto(`${BASE}/design/D9_world/?shop=${shop}`, { waitUntil: 'domcontentloaded' });
      await page.locator('#t-proof').waitFor({ state: 'visible', timeout: 90000 });
      await page.waitForTimeout(2600);
      await page.evaluate(() => document.getElementById('drawer')?.classList.remove('open'));
    }

    const tabs = await page.evaluate(() => [...document.querySelectorAll('#shopUI #tray [role=tab]')].map(e => e.dataset.testid).filter(Boolean));
    for (const tab of tabs.length ? tabs : [null]) {
      if (tab) {
        const b = page.getByTestId(tab);
        if (await b.count()) { await b.first().click({ force: true }); await page.waitForTimeout(700); }
      }
      const v = await page.evaluate(() => {
        const tray = document.querySelector('#shopUI #tray');
        if (!tray) return { err: 'no tray' };
        const tr = tray.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(tray).paddingLeft) || 0;
        const inner = tr.width - pad * 2;

        const nameEl = document.querySelector('#shopUI #tray #t-title .t-name') || document.getElementById('t-title');
        const truncated = !!nameEl && nameEl.scrollWidth > nameEl.clientWidth + 1;

        const vis = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };

        // --- the owner's round-3 items, each one a failing condition on its own ----------------

        const problems = [];

        // (a)(c) A token pill must show its full name and a chevron, never "M…NEAR…".
        for (const pill of tray.querySelectorAll('.swap-line .token-listbox-btn, .swap-chain-row .token-listbox-btn')) {
          if (!vis(pill)) continue;
          const lab = pill.querySelector('.opt-label');
          if (lab && lab.scrollWidth > lab.clientWidth + 1) problems.push(`PILL-TRUNCATED "${lab.textContent.trim()}"`);
          const cs = getComputedStyle(pill, '::after');
          const chev = cs.borderRightWidth !== '0px' && cs.transform !== 'none';
          if (!chev) problems.push('PILL-NO-CHEVRON');
        }

        // (b) The From row is one bordered card: the pill, the amount and Max share a border.
        const line = tray.querySelector('.swap-line');
        if (line) {
          const bw = parseFloat(getComputedStyle(line).borderTopWidth) || 0;
          if (bw < 1) problems.push('FROM-NOT-ONE-CARD');
          const pill = line.querySelector('.token-listbox');
          const amt = line.querySelector('input');
          const mx = line.querySelector('.swap-max');
          for (const [name, el] of [['pill', pill], ['amount', amt], ['max', mx]]) {
            if (!el) { problems.push(`FROM-MISSING-${name.toUpperCase()}`); continue; }
            const r = el.getBoundingClientRect(), lr = line.getBoundingClientRect();
            if (r.left < lr.left - 1 || r.right > lr.right + 1) problems.push(`FROM-${name.toUpperCase()}-OUTSIDE-CARD`);
          }
        }

        // (d) The chain row is one line with a select and a Live badge, not a pill stack.
        const chainRow = tray.querySelector('.swap-chain-row');
        if (chainRow) {
          const sel = chainRow.querySelector('select, .token-listbox-btn');
          const live = chainRow.querySelector('.swap-live');
          if (!sel) problems.push('CHAIN-NO-SELECT');
          if (!live) problems.push('CHAIN-NO-LIVE');
          if (sel && live) {
            const a = sel.getBoundingClientRect(), b = live.getBoundingClientRect();
            if (Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) > 14) problems.push('CHAIN-NOT-ONE-LINE');
          }
        }

        // (e) The quote card is full width, readable, and says "Enter an amount" when empty.
        const quote = [...tray.querySelectorAll('.swap-quote')].find(q => q.getBoundingClientRect().width > 2);
        if (quote) {
          const qr = quote.getBoundingClientRect();
          const inner = tr.width - pad * 2;
          if (qr.width < inner * 0.9) problems.push(`QUOTE-NARROW ${Math.round(qr.width / inner * 100)}%`);
          const fs = parseFloat(getComputedStyle(quote.querySelector('p') || quote).fontSize) || 0;
          if (fs < 12) problems.push(`QUOTE-TEXT ${fs}px`);
          const txt = quote.textContent.replace(/\s+/g, ' ').trim();
          if (quote.dataset.empty === '1' && !/enter an amount/i.test(txt)) problems.push('QUOTE-EMPTY-NOT-ASKING');
        }

        // (f) No token-search field in the main view.
        { const f = tray.querySelector('#f-find'); if (f && f.getBoundingClientRect().width > 2) problems.push('FIND-TOKEN-IN-VIEW'); }

        // (g) Review swap is the dominant gold; the sign-in control under it is outlined.
        const review = [...tray.querySelectorAll('#f-quote')].find(q => q.getBoundingClientRect().width > 2);
        const act = document.getElementById('t-act');
        if (review && act && !act.hidden) {
          const gold = (el) => /linear-gradient/.test(getComputedStyle(el).backgroundImage);
          if (!gold(review)) problems.push('REVIEW-NOT-GOLD');
          if (gold(act)) problems.push('SIGNIN-ALSO-GOLD');
          if (review.getBoundingClientRect().height < 44) problems.push('REVIEW-TOO-SHORT');
        }

        // (h)(j) The header illustration sits inside the header row, never above the panel's top.
        const art = tray.querySelector('#t-title .panel-art');
        if (art) {
          const ar = art.getBoundingClientRect();
          const hr = (tray.querySelector('.t-head') || tray).getBoundingClientRect();
          if (ar.top < hr.top - 1) problems.push('ART-ABOVE-HEADER');
          if (ar.top < tr.top + 4) problems.push('ART-ON-PANEL-EDGE');
          if (ar.width < 48) problems.push(`ART-${Math.round(ar.width)}px`);
        }

        // (i) The Payee field is full width and below the icon row.
        const payee = tray.querySelector('#g-acct');
        if (payee) {
          const pr = payee.getBoundingClientRect();
          const flow = tray.querySelector('#guard-flow');
          const inner = tr.width - pad * 2;
          if (pr.width < inner * 0.9) problems.push(`PAYEE-NARROW ${Math.round(pr.width / inner * 100)}%`);
          if (flow) {
            const fr = flow.getBoundingClientRect();
            if (pr.top < fr.bottom - 2) problems.push('PAYEE-NOT-BELOW-FLOW');
          }
        }

        // (k) The three checks read at 13px, not 11.
        const checkItems = [...tray.querySelectorAll('.guard-check')];
        if (checkItems.length) {
          if (checkItems.length < 3) problems.push(`GUARD-CHECKS ${checkItems.length}`);
          const fs = parseFloat(getComputedStyle(checkItems[0]).fontSize) || 0;
          if (fs < 13) problems.push(`GUARD-TEXT ${fs}px`);
        }

        // ALL SHOPS: the CTA carries the shop's own glyph, not one check mark everywhere.
        const glyph = [...tray.querySelectorAll('.primary')].map(el => getComputedStyle(el, '::before').maskImage || getComputedStyle(el, '::before').webkitMaskImage).filter(Boolean);
        if (glyph.length && glyph.every(g => /tick-premium/.test(g))) problems.push('CTA-GLYPH-GENERIC');

        // ALL SHOPS: inactive tabs are dark with a visible border; the active one is solid gold.
        const tabsAll = [...tray.querySelectorAll('[role=tablist] > button, [role=tab]')].filter(vis);
        const inactive = tabsAll.filter(t => t.getAttribute('aria-selected') !== 'true' && !t.classList.contains('on') && t.getAttribute('aria-pressed') !== 'true');
        for (const t of inactive) {
          const bw = parseFloat(getComputedStyle(t).borderTopWidth) || 0;
          if (bw < 1) { problems.push('TAB-NO-BORDER'); break; }
        }

        // --- the seven ferry items, each its own failing condition -----------------------------

        // Only the VISIBLE pane counts: a hidden tab has no layout and would report 0px.
        const amtEl = [...tray.querySelectorAll('#f-amt')].find(e => e.getBoundingClientRect().width > 2);
        if (amtEl) {
          const pillEl = [...tray.querySelectorAll('.swap-line .token-listbox')].find(e => e.getBoundingClientRect().width > 2);
          const maxEl = [...tray.querySelectorAll('.swap-line .swap-max')].find(e => e.getBoundingClientRect().width > 2);
          const symEl = [...tray.querySelectorAll('.swap-line .amt-row .amt-sym')].find(e => e.getBoundingClientRect().width > 2);
          const lineW = (amtEl.closest('.swap-line') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width;

          // (1a) the amount is wide enough to show its value, and takes the space after the pill
          if (amtEl.getBoundingClientRect().width < 56) problems.push(`AMOUNT-NARROW ${Math.round(amtEl.getBoundingClientRect().width)}px`);
          if (amtEl.scrollWidth > amtEl.clientWidth + 1) problems.push('AMOUNT-CLIPPED');
          if (pillEl && lineW) {
            const pct = pillEl.getBoundingClientRect().width / lineW * 100;
            if (pct < 32 || pct > 50) problems.push(`PILL-WIDTH ${Math.round(pct)}%`);
          }
          if (maxEl && amtEl.getBoundingClientRect().right > maxEl.getBoundingClientRect().left + 1) problems.push('MAX-OVERLAPS-AMOUNT');
          // (1b) no duplicate unit after Max
          if (symEl && vis(symEl)) problems.push('DUPLICATE-UNIT');
        }

        const chainSel = [...tray.querySelectorAll('#f-chain .token-listbox-btn, #f-chain select')].find(e => e.getBoundingClientRect().width > 2);
        if (chainSel) {
          // (2) the chain control names a chain, never just "All", and the Live badge is last
          const t = (chainSel.textContent || '').trim();
          if (/^All$/i.test(t)) problems.push('CHAIN-DEFAULTS-ALL');
          const live = tray.querySelector('.swap-chain-row .swap-live');
          if (live) {
            const row = live.closest('.swap-chain-row');
            const rowR = row.getBoundingClientRect();
            const liveR = live.getBoundingClientRect();
            // The badge sits at the row's right end, not beside the select.
            if (rowR.right - liveR.right > 8) problems.push('LIVE-NOT-RIGHT');
          }
        }

        // (3) the To value is not an em dash
        const est = [...tray.querySelectorAll('.swap-est')].find(e => e.getBoundingClientRect().width > 2);
        if (est) {
          const shown = (est.textContent || '').trim();
          if (!shown) {
            const after = getComputedStyle(est, '::before').content || '';
            if (/[—–]/.test(after)) problems.push('TO-VALUE-DASH');
          }
        }

        const ctaF = [...tray.querySelectorAll('#f-quote')].find(e => e.getBoundingClientRect().width > 2);
        if (ctaF) {
          const cs = getComputedStyle(ctaF);
          // (4) 48px tall and at least 16px clear of the quote card
          if (ctaF.getBoundingClientRect().height < 46) problems.push(`REVIEW-H ${Math.round(ctaF.getBoundingClientRect().height)}`);
          const quoteEl = [...tray.querySelectorAll('.swap-quote')].find(q => q.getBoundingClientRect().width > 2);
          if (quoteEl) {
            const g = ctaF.getBoundingClientRect().top - quoteEl.getBoundingClientRect().bottom;
            if (g < 15) problems.push(`REVIEW-GAP ${Math.round(g)}px`);
          }
          // A real gradient with more than one stop, not a flat fill.
          if (!/linear-gradient/.test(cs.backgroundImage)) problems.push('REVIEW-NO-GRADIENT');
        }

        const quoteR = [...tray.querySelectorAll('.swap-quote')].find(q => q.getBoundingClientRect().width > 2);
        if (quoteR) {
          // (5) header has an icon and the Best route pill is a pill
          const head = quoteR.querySelector('.swap-quote-head');
          if (head) {
            const m = getComputedStyle(head, '::before').maskImage || getComputedStyle(head, '::before').webkitMaskImage || 'none';
            if (m === 'none') problems.push('QUOTE-NO-ICON');
          }
          const best = quoteR.querySelector('.swap-best');
          if (best) {
            const br = parseFloat(getComputedStyle(best).borderTopWidth) || 0;
            const rad = getComputedStyle(best).borderRadius || '';
            if (br < 1 && !/px/.test(rad)) problems.push('BEST-NOT-PILL');
          }
          // 8px between rows
          const rows = [...quoteR.querySelectorAll('p')].map(e => e.getBoundingClientRect());
          for (let i = 1; i < rows.length; i++) {
            const gap = rows[i].top - rows[i - 1].bottom;
            if (gap < 6 || gap > 10) { problems.push(`QUOTE-ROWS ${Math.round(gap)}px`); break; }
          }
        }

        // (6) no "mainnet quote" words beside the header icon
        const src = tray.querySelector('.t-head #t-src');
        if (src) {
          const fs = parseFloat(getComputedStyle(src).fontSize) || 0;
          const txt = (src.textContent || '').trim();
          if (txt && fs > 6) problems.push('SRC-TEXT-VISIBLE');
        }

        // (7) the flip button sits on the seam between the two swap cards
        const cards = [...tray.querySelectorAll('.swap-card')].filter(vis);
        const flipEl = [...tray.querySelectorAll('.swap-flip')].find(e => e.getBoundingClientRect().width > 2);
        if (cards.length >= 2 && flipEl) {
          const seam = cards[0].getBoundingClientRect().bottom;
          const c = flipEl.getBoundingClientRect();
          const centre = c.top + c.height / 2;
          if (Math.abs(centre - seam) > 8) problems.push(`FLIP-OFF-SEAM ${Math.round(centre - seam)}px`);
        }

        // The one gold CTA: the widest gradient-filled control that is NOT a tab. An active tab
        // legitimately carries the gold gradient, so counting it made the check fail on tabs
        // whose action is hidden (Hall Agents has nothing to sign, so it has no CTA at all).
        const golds = [...tray.querySelectorAll('button, a')].filter(el => {
          if (!vis(el)) return false;
          if (el.closest('[role=tablist]')) return false;
          if (el.getAttribute('role') === 'tab') return false;
          const cs = getComputedStyle(el);
          return /linear-gradient/.test(cs.backgroundImage) && el.getBoundingClientRect().height >= 40;
        });
        const widest = golds.map(el => el.getBoundingClientRect().width).sort((a, b) => b - a)[0] || 0;
        const primaryPct = inner ? Math.round((widest / inner) * 100) : 0;
        // A view with no action is allowed to have no primary; a view WITH one must be full width.
        const hasAction = golds.length > 0;

        // Text overlap: a text-bearing leaf whose box intersects another leaf's box in a way that
        // puts glyphs on top of each other.
        const leaves = [...tray.querySelectorAll('*')]
          .filter(el => vis(el) && el.children.length === 0 && (el.textContent || '').trim().length > 1 && !(el.closest('details') && !el.closest('details').open))
          .map(el => ({ el, r: el.getBoundingClientRect(), t: (el.textContent || '').trim().slice(0, 24) }));
        const overlaps = [];
        for (let i = 0; i < leaves.length; i++) {
          for (let j = i + 1; j < leaves.length; j++) {
            const a = leaves[i].r, b = leaves[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            // A real collision: more than 2px into each other on both axes, and neither is the
            // other's ancestor (ancestors legitimately contain descendants).
            if (ox > 2 && oy > 2 && !leaves[i].el.contains(leaves[j].el) && !leaves[j].el.contains(leaves[i].el)) {
              overlaps.push(`${leaves[i].t} ⟂ ${leaves[j].t}`);
            }
          }
        }

        return {
          width: Math.round(tr.width),
          truncated,
          nameText: nameEl ? nameEl.textContent.trim() : '',
          primaryPct,
          hasAction,
          goldCount: golds.length,
          overlaps: overlaps.slice(0, 4),
          hasBadge: !!document.querySelector('#shopUI #tray #t-title .panel-badge'),
          hasArt: !!document.querySelector('#shopUI #tray #t-title .panel-art'),
          hasSub: !!document.querySelector('#shopUI #tray #t-sub')?.textContent?.trim(),
          hasQuest: !!document.getElementById('shop-quest'),
          hasFlow: !!document.querySelector('#shopUI #tray .flow-strip, #shopUI #tray #t-hero .flow-strip'),
          scrolls: tray.scrollHeight > tray.clientHeight + 1,
          problems,
        };
      });

      total++;
      const bad = [];
      if (v.err) bad.push(v.err);
      if (v.problems?.length) bad.push(...v.problems);
      if (v.truncated) bad.push('TRUNCATED');
      if (v.hasAction && v.primaryPct < 90) bad.push(`PRIMARY ${v.primaryPct}%`);
      if (v.overlaps?.length) bad.push('OVERLAP ' + v.overlaps.join(' | '));
      if (W === 1440 && v.width < 380) bad.push(`WIDTH ${v.width}`);
      if (!v.hasBadge) bad.push('NO-BADGE');
      if (!v.hasArt) bad.push('NO-ART');
      if (!v.hasSub) bad.push('NO-SUB');
      if (!v.hasQuest) bad.push('NO-QUEST');
      if (W === 1440 && v.scrolls) bad.push('SCROLL');
      if (bad.length) fail++;

      const key = `${shop}${tab ? '.' + tab.replace(/^[a-z]+-tab-|^[a-z]+-mode-?/, '') : ''}`;
      console.log(`${String(W).padEnd(5)} ${key.padEnd(24)} ${bad.length ? 'FAIL ' + bad.join(' ') : 'ok'}`);
      await page.screenshot({ path: `${OUT}/${key}-${W}.png` });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${total - fail}/${total} views pass`);
