import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NEARAI_CLOUD_API_KEY ||= 'test-key';
const { complete } = await import('../../src/ai.js');
test('ai.complete keeps content only; reasoning_content is never kept', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'c1', model: 'm', usage: {}, choices: [{ message: { content: 'ok', reasoning_content: 'SECRET-THOUGHT' } }] }));
  try {
    const c = await complete([{ role: 'user', content: 'hi' }]);
    assert.equal(c.content, 'ok');
    assert.ok(!JSON.stringify(c).includes('SECRET-THOUGHT'));
    assert.match(c.respSha, /^[0-9a-f]{64}$/);
    assert.equal(c.reqBody.includes('x-no-aliasing'), false);
  } finally { globalThis.fetch = orig; }
});

test('a blank reply keeps reasoning_content for a later signature check', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'c2', model: 'm', usage: {},
    choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'Netflix is the waste.' } }],
  }));
  try {
    const c = await complete([{ role: 'user', content: 'hi' }]);
    assert.equal(String(c.content || '').trim(), '');
    assert.equal(c.reasoning_content, 'Netflix is the waste.');
    assert.equal(c.finish_reason, 'length');
  } finally { globalThis.fetch = orig; }
});
