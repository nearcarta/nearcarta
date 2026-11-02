import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import * as agent from '../../src/agent.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const hx = u => Buffer.from(u).toString('hex');
const kp = nacl.sign.keyPair();
const MODEL = 'z-ai/glm-5.3-flash';
const okPre = async () => ({ ok: true, nonce: 'n', checkedAt: 't', gateway: { ok: true }, models: [{ ok: true, signing_algo: 'ed25519', signing_address: hx(kp.publicKey) }] });
const clauses = { pay: { asset: 'Native', receivers: ['cafe.x.testnet'], per_action_cap: '50000000000000000000000' } };

function fakeModel(content) {
  const reqBody = 'req', respText = 'resp';
  return {
    completeF: async () => ({ id: 'chat-1', model: MODEL, reqModel: MODEL, content, usage: { prompt_tokens: 400, completion_tokens: 60 }, reqSha: sha(reqBody), respSha: sha(respText) }),
    signatureF: async () => {
      const text = `${MODEL}:${sha(reqBody)}:${sha(respText)}`;
      return { available: true, signature_kind: 'provider_tee', signing_algo: 'ed25519', signing_address: hx(kp.publicKey), text,
        signature: hx(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey)) };
    },
  };
}
const withKey = async fn => {
  const k = process.env.NEARAI_CLOUD_API_KEY; process.env.NEARAI_CLOUD_API_KEY = 'test-only';
  try { return await fn(); } finally { if (k === undefined) delete process.env.NEARAI_CLOUD_API_KEY; else process.env.NEARAI_CLOUD_API_KEY = k; }
};
beforeEach(() => agent._resetBudget());

test('no retention: the API logs counts and cost only, never prompt or reply text', async () => withKey(async () => {
  const lines = [];
  const prompt = 'SECRET-PROMPT-MARKER pay the cafe 0.01 NEAR';
  await agent.propose(prompt, { clauses, receivers: ['cafe.x.testnet'], pf: okPre, log: l => lines.push(String(l)),
    ...fakeModel('{"receiver":"cafe.x.testnet","amount_near":"0.01","note":"REPLY-MARKER","suspicious":false,"why":"ok"}') });
  assert.ok(lines.length >= 1);
  for (const l of lines) { assert.ok(!l.includes('SECRET-PROMPT-MARKER')); assert.ok(!l.includes('REPLY-MARKER')); }
}));
