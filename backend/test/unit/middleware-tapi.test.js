// /tapi/* on Vercel is the testnet API: the proxy must land on the testnet service's /api/*, like /api/* does on mainnet.
// Docs: https://vercel.com/docs/routing-middleware
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the proxy maps /tapi/x to the testnet service /api/x and /api/x to the mainnet service', async () => {
  process.env.NC_PROXY_SECRET = 'x'.repeat(40);
  const { default: middleware } = await import('../../../middleware.js');
  const t = await middleware(new Request('https://nearcarta.vercel.app/tapi/health?a=1'));
  assert.equal(t.headers.get('x-middleware-rewrite'), 'https://nearcarta-api-testnet.onrender.com/api/health?a=1');
  const m = await middleware(new Request('https://nearcarta.vercel.app/api/health'));
  assert.equal(m.headers.get('x-middleware-rewrite'), 'https://nearcarta-api.onrender.com/api/health');
  delete process.env.NC_PROXY_SECRET;
});
