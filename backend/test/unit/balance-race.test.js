// A slow balance read must not land on a card whose token has already changed.
//
// The panel calls refreshBalances whenever a pill changes. Each read is stamped with a sequence
// number and the pill value it was for; when the answer arrives it is written only if that stamp
// is still current. This test drives the same rule with a controlled clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The guard the panel uses, lifted into a testable shape: `begin()` starts a read and returns a
 * commit function that applies the result only if nothing newer has started and the pill still
 * holds the value the read was for.
 */
function makeBalanceWriter({ readPill }) {
  let seq = 0;
  const state = { fromBal: '', toBal: '' };
  return {
    state,
    begin(pillId, value) {
      const mine = ++seq;
      return (line) => {
        if (mine !== seq) return false;          // a later read superseded this one
        if (readPill(pillId) !== value) return false; // the visitor changed the token meanwhile
        state.fromBal = line;
        return true;
      };
    },
  };
}

test('a stale read does not overwrite the card after the token changed', () => {
  let pill = 'wNEAR|near';
  const w = makeBalanceWriter({ readPill: () => pill });

  const commitSlow = w.begin('f-from', 'wNEAR|near');
  // The visitor switches to USDC before the wNEAR read comes back.
  pill = 'USDC|near';
  const applied = commitSlow('Balance: 1.24 wNEAR');

  assert.equal(applied, false, 'the stale answer was rejected');
  assert.equal(w.state.fromBal, '', 'nothing was written for a token no longer chosen');
});

test('a newer read wins over an older one even when the pill ends up the same', () => {
  let pill = 'wNEAR|near';
  const w = makeBalanceWriter({ readPill: () => pill });

  const first = w.begin('f-from', 'wNEAR|near');
  const second = w.begin('f-from', 'wNEAR|near');

  assert.equal(first('Balance: 9 wNEAR'), false, 'the older read lost the race');
  assert.equal(second('Balance: 1.24 wNEAR'), true);
  assert.equal(w.state.fromBal, 'Balance: 1.24 wNEAR');
});

test('the current read still lands when nothing changed', () => {
  const w = makeBalanceWriter({ readPill: () => 'wNEAR|near' });
  const commit = w.begin('f-from', 'wNEAR|near');
  assert.equal(commit('Balance: 0 wNEAR'), true);
  assert.equal(w.state.fromBal, 'Balance: 0 wNEAR');
});
