import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('F61d: Finish crossing finishes the stored order by id, never a new cross or budget', () => {
  const a = read('app/design/D8_shops/js/apps.js');
  const f = a.slice(a.indexOf('export async function finishOrder('), a.indexOf('export async function finishOrder(') + 1400);
  assert.match(f, /get_order/);
  assert.match(f, /finishCross\(TS\.TOLL_ACCT, o, \{ reused: true \}\)/);
  assert.doesNotMatch(f, /propose_call_as|set_effects|ensureTollEffect|signCrossProposal/);
  const room = read('app/src/panels/toll-room.js');
  assert.match(room, /hooks\.onFinish\(o\.id\)/);
  assert.match(read('app/design/D8_shops/js/shopui.js'), /onFinish: \(id\) => tollFinish\(id\)/);
});

test('F61d: an unreadable order list stops the press; an open order blocks a new cross', () => {
  const a = read('app/design/D8_shops/js/apps.js');
  assert.match(a, /if \(o === undefined\) throw new Error\('Your crossings on the toll did not read/);
  assert.match(a, /is paid and still open\. Press Finish crossing/);
  assert.match(a, /if \(!ok\) throw new Error\('Your Base budget is not on the board yet/);
});

test('F61d: one wallet request at a time, and a stale wallet answer is refused', () => {
  const a = read('app/design/D8_shops/js/apps.js');
  assert.match(a, /if \(walletOpen\) \{/);
  assert.match(a, /raw\.then\(\(\) => \{ walletOpen = null; \}, \(\) => \{ walletOpen = null; \}\)/);
  assert.match(a, /await sameRequest\(h, receiverId, method\)/);
  assert.match(a, /answered an earlier request/);
});
