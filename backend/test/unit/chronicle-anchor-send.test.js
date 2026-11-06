// The Chronicle anchor sender: the CTA and the AI both go through anchorStatement.
// It signs with the visitor's session key, sends `anchor`, and reads the event back.
// The tx shapes are checked offline; the contract behaviour is charter_board_sandbox/tests/anchor.rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anchorPlan, canonicalManifest, parseAnchorEvents, anchorProof } from '../../../app/src/chronicle-audit.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const src = read('app/design/D8_shops/js/apps.js');
const view = read('app/src/panels/chronicle-view.js');
const cmds = read('app/src/chronicle-commands.js');

test('the sender signs anchor with a BigInt gas value', () => {
  // A plain number here throws "Cannot mix BigInt and other types" before anything is sent.
  assert.match(src, /functionCall\('anchor',\s*\{[^}]*\},\s*BigInt\(ANCHOR_TGAS\)\s*\*\s*TG\)/);
  assert.doesNotMatch(src, /functionCall\('anchor',[^)]*[^)]ANCHOR_TGAS\s*\*\s*TG\)\s*\]/);
  assert.match(src, /export const ANCHOR_TGAS\s*=\s*30/);
});

test('the sender refuses before signing when there is no session, row or key', () => {
  for (const reason of ['no_session', 'no_digest', 'no_salt', 'no_key', 'no_session_key', 'key_cannot_anchor', 'no_row']) {
    assert.match(src, new RegExp(`you\\('${reason}'`), `${reason} must be a named refusal`);
  }
  // It checks the row exists before it signs, so a missing row is a sentence, not a panic.
  assert.match(src, /get_charter'[^\n]*owner: S\.me/);
});

test('the tray sends the plan through the hook and proves the event it gets back', () => {
  // The CTA and the AI both land in anchorNow, which calls hooks.onAnchor (apps.js anchorStatement).
  assert.match(view, /const send = hooks\.onAnchor/);
  assert.match(view, /const events = parseAnchorEvents\(sent\.logs \|\| \[\]\)/);
  assert.match(view, /anchorProof\(\{ commitment: plan\.commitment, owner: state\.account, events \}\)/);
  // A failed send must not claim the anchor happened.
  assert.match(view, /The board did not log the anchor:/);
  // The AI's anchor command reaches the same function.
  assert.match(cmds, /if \(\/\\banchor\\b\/\.test\(line\)\) return \{ ok: true, action: 'anchor', hint: '' \};/);
});

test('the sender and the tray agree on the commitment for one bundle', () => {
  const manifest = canonicalManifest({ account: 'alice.near', rows: [{ h: 'a'.repeat(44) }], statement: 'S' });
  const plan = anchorPlan({ manifest, salt: '0123456789abcdef' });
  assert.equal(plan.ok, true);
  // The event the sender will see, built with the plan's own commitment, proves the plan.
  const line = 'EVENT_JSON:' + JSON.stringify({
    standard: 'nearcarta-board', version: '2', event: 'anchor', owner: 'alice.near',
    kind: 'statement', commitment: plan.commitment, nonce: '1', time: '1700000000000000000',
  });
  const events = parseAnchorEvents([line]);
  assert.equal(anchorProof({ commitment: plan.commitment, owner: 'alice.near', events }).ok, true);
});
