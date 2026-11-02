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
  } finally { globalThis.fetch = orig; }
});
