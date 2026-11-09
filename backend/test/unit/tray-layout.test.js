// Layout invariants the owner can see. Measured defects on 2026-11-07 from a real browser:
//   Ferry CTA at y=941 in an 844px viewport (clipped off screen)
//   Arena CTA at y=948 in an 800px viewport, and at y=1174 on a phone
//   Chronicle had two nested scroll regions (310px of content in a 251px box) and controls
//     overlapping its gold button
//   tray inputs measured 38px tall and a "Download" link 70x18px, both under the tap floor
// The root cause of the first two was the tray itself being the scroll container with the
// action button inside it, so the button could scroll out of sight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('the tray scrolls in an inner region so the action row stays visible', () => {
  const html = read('app/design/D9_world/index.html');
  const tray = html.slice(html.indexOf('id="tray"'), html.indexOf('</section>', html.indexOf('id="tray"')));
  assert.match(tray, /<div class="t-scroll">/, 'the scrollable content is wrapped');
  // The action row must sit outside that wrapper: pinned, never scrolled away.
  const scrollEnd = tray.indexOf('</div>', tray.indexOf('<div class="t-scroll">'));
  const actionsAt = tray.indexOf('<div class="t-row">');
  assert.ok(actionsAt > scrollEnd && actionsAt > 0, 'the gold action row follows the scroll region');
  const css = read('app/design/D9_world/world.css');
  assert.match(css, /#shopUI #tray > \.t-scroll\s*\{[^}]*overflow-y:\s*auto/, 'only the inner region scrolls');
  assert.match(css, /#shopUI #tray\s*\{[^}]*overflow:\s*hidden/, 'the tray itself must not scroll');
});

test('a phone tray uses the viewport instead of a short cap', () => {
  const css = read('app/design/D9_world/world.css');
  // 62vh and 112px gaps are what pushed the CTA off a 844px screen.
  assert.doesNotMatch(css, /max-height:\s*62vh/);
  assert.doesNotMatch(css, /max-height:\s*calc\(100dvh - 112px\)/);
  assert.doesNotMatch(css, /max-height:\s*calc\(100dvh - 240px\)/);
  assert.doesNotMatch(css, /max-height:\s*min\(46dvh/);
  assert.doesNotMatch(css, /max-height:\s*min\(58dvh/);
});

test('Chronicle has one scroll region, not a scroll inside a scroll', () => {
  const style = read('app/src/panels/chronicle-style.js');
  // The card used to be height:100% + overflow:hidden inside the tray, and .c-scroll had its
  // own overflow:auto. Two nested scrollbars is the "stuck" feeling the owner described.
  assert.match(style, /\.c-scroll\{flex:none; min-height:0; overflow:visible\}/);
  assert.doesNotMatch(style, /\.c-scroll\{flex:1 1 auto; min-height:0; overflow:auto\}/);
  assert.match(style, /\.chronicle-card\{[\s\S]{0,220}overflow:visible/, 'the card must not clip its own content');
});

test('every tray field meets the 44px tap floor', () => {
  const panels = read('app/src/panels/panels.css');
  const rule = panels.slice(panels.indexOf('#shopUI #t-form input:not([type=radio])'), panels.indexOf('}', panels.indexOf('#shopUI #t-form input:not([type=radio])')));
  assert.match(rule, /min-height:\s*44px/, 'a field under 44px is hard to hit on a phone');
  const bank = read('app/src/panels/bank.css');
  const link = bank.slice(bank.indexOf('.bank-sample-link{'), bank.indexOf('}', bank.indexOf('.bank-sample-link{')));
  assert.match(link, /min-height:\s*44px/, 'the sample download link measured 70x18px');
});

test('the tray scrollbar is visible, so the menu does not look cut off', () => {
  const css = read('app/design/D9_world/world.css');
  const rule = css.slice(css.indexOf('#shopUI #tray > .t-scroll'), css.indexOf('}', css.indexOf('#shopUI #tray > .t-scroll')) + 1);
  assert.match(rule, /scrollbar-width:\s*thin/, 'a hidden scrollbar reads as clipped content');
  assert.match(rule, /scrollbar-color:/);
  assert.match(css, /::-webkit-scrollbar-thumb/, 'and it must be styled, not left invisible');
});

test('All shops never lands on a shop tab', () => {
  const css = read('app/design/D9_world/world.css');
  // Measured: it covered Arena's first tab at 1280x800.
  assert.match(css, /body\.in-shop nav\.all-shops\s*\{[^}]*top:/, 'in a shop the menu moves up');
  assert.match(css, /body\.in-shop #shopUI #tray\s*\{[^}]*padding-top:/, 'and the tray clears it');
});

test('the Bank tray is the approved size on a phone, not the smallest one in the city', () => {
  const bank = read('app/src/panels/bank.css');
  // Measured: 270px wide and 62dvh tall, so its gold button landed at y=821 in an 844px
  // viewport and the whole card read as cramped.
  assert.doesNotMatch(bank, /max-width:min\(270px/, 'the narrow cap is what shrank it');
  assert.doesNotMatch(bank, /height:min\(62dvh/, 'a 62dvh cap leaves no room for the action row');
  const phone = bank.slice(bank.indexOf('@media (max-width:720px)'));
  const rule = phone.slice(phone.indexOf('body.bank-tray #shopUI #tray{'), phone.indexOf('}', phone.indexOf('body.bank-tray #shopUI #tray{')));
  assert.match(rule, /max-height:calc\(100dvh - 76px\)/, 'it uses the viewport');
});

test('the Bank sample link meets the tap floor in the rule that actually wins', () => {
  const bank = read('app/src/panels/bank.css');
  // A higher-specificity rule set min-height:0 and padding:0, so the plain rule never applied
  // and the link stayed 70x18px.
  const at = bank.indexOf('body.bank-tray #shopUI #t-form button.bank-sample-link');
  // Strip comments: the note explaining the old bug names `min-height:0` and would match itself.
  const specific = bank.slice(at, bank.indexOf('}', bank.indexOf('min-height', at)))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(specific, /min-height:44px/, 'the winning rule must set the tap floor');
  assert.doesNotMatch(specific, /min-height:0/, 'and must not reset it to zero');
});

test('Arena stacks fewer rows so its gold action never sits below the fold', () => {
  const panels = read('app/src/panels/panels.css');
  // Measured: six single-column fields made the card 799px inside a 658px region and the CTA
  // landed at y=792 in an 800px viewport.
  const pane = panels.slice(panels.indexOf('body.arena-tray .ferry-pane[data-pane="guardians"]{'));
  const rule = pane.slice(0, pane.indexOf('}'));
  // Two columns, on a track that can shrink. `1fr 1fr` is also two columns but its minimum is
  // the content's intrinsic width: measured on Arena, the NEAR amount field demanded 318px
  // inside a 183px column, painted past the panel edge and was clipped by the scroll region.
  // `minmax(0, 1fr)` is the same two columns with a zero floor.
  assert.match(rule, /grid-template-columns:(repeat\(2,\s*minmax\(0,\s*1fr\)\)|1fr 1fr)/, 'the money fields sit in two columns');
  assert.doesNotMatch(rule, /grid-template-columns:1fr 1fr/, 'the columns may shrink below their content');
  assert.match(panels, /\.arena-actions[,\s][\s\S]{0,120}?grid-column:1 \/ -1\}|> \.arena-actions,\n/, 'the action spans the full row');
});

test('the tab strip fits however many tabs a shop has', () => {
  const panels = read('app/src/panels/panels.css');
  // Payouts has four tabs in a strip that was hardcoded to three columns.
  assert.match(panels, /\.ferry-tabs\{display:grid;grid-auto-flow:column;grid-auto-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(panels, /\.ferry-tabs\{display:grid;grid-template-columns:repeat\(3/);
});
