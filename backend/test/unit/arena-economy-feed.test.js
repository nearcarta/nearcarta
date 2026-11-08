// The arena's `fund` argument type.
//
// Why this test exists: `idArg` used to turn digits into a Number. The tray's own input path
// built the call from a string, so the gold button worked, while the AI dock went through
// idArg and sent {"token_id":1}. Measured on mainnet 2026-11-08: the transaction landed and the
// arena answered "invalid type: integer `1`, expected a string", so the visitor paid gas for
// a call that could never work. Checked against the deployed contract: "0" answers, 0 errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setSha256Hex } from '../../../app/src/board-call-as.js';
import { planFeed } from '../../../app/src/panels/arena/economy.js';

// The board envelope hashes the args, so the planner needs a hash. The browser passes
// SubtleCrypto's; a test passes node's, which must agree byte for byte.
setSha256Hex(t => createHash('sha256').update(String(t)).digest('hex'));

const fields = { arena: 'arena.nearcarta.near', board: 'board.nearcarta.near', owner: 'who.near', nonce: '1', epoch: '1', expiry: '1794000000000000000' };

test('the arena fund call always sends the token id as a string', () => {
  for (const id of ['0', 0, '12', 12, '7']) {
    const plan = planFeed({ ...fields, id, amount: '0.001' });
    const call = plan?.call;
    assert.ok(call, `a plan is built for id ${JSON.stringify(id)}`);
    const args = JSON.parse(call.args);
    assert.equal(typeof args.token_id, 'string', `token_id is a string for ${JSON.stringify(id)}: ${call.args}`);
    assert.equal(args.token_id, String(id));
    assert.match(call.args, /"token_id":"\d+"/, 'and the JSON has it quoted');
  }
});

test('the fund call names fund, not feed, and carries the amount as the deposit', () => {
  const plan = planFeed({ ...fields, id: '1', amount: '0.002' });
  assert.equal(plan.call.method, 'fund');
  assert.equal(String(plan.call.deposit), '2000000000000000000000');
});
