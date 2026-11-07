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
