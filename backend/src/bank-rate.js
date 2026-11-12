// NEAR price for a cap proposal only. The statement amounts stay in their own currency.
// Source: CoinGecko simple price, a public price feed.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export async function nearRate(currency, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const code = String(currency || '').trim().toLowerCase();
  if (!code || code === 'as written') {
    return { ok: false, currency: '', nearPerUnit: null, source: 'No currency column was detected, so the cap was not converted.' };
  }
  if (code === 'near') {
    return { ok: true, currency: 'NEAR', nearPerUnit: 1, nearPrice: 1, source: 'The statement is already in NEAR.' };
  }
  if (!/^[a-z]{3,5}$/.test(code)) {
    return { ok: false, currency: code.toUpperCase(), nearPerUnit: null, source: `The cap was not converted. ${code.toUpperCase()} is not a price code this desk knows.` };
  }
  const hit = cache.get(code);
  const at = now();
  if (hit && at - hit.at < CACHE_MS) return { ...hit.value, cache: 'hit' };
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=${encodeURIComponent(code)}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    return { ok: false, currency: code.toUpperCase(), nearPerUnit: null, source: `The cap was not converted. CoinGecko did not answer (${e.message || 'network'}).` };
  }
  if (!res?.ok) {
    return { ok: false, currency: code.toUpperCase(), nearPerUnit: null, source: `The cap was not converted. CoinGecko returned HTTP ${res?.status || 0}.` };
  }
  const body = await res.json();
  const price = Number(body?.near?.[code]);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, currency: code.toUpperCase(), nearPerUnit: null, source: `The cap was not converted. CoinGecko has no near/${code} price.` };
  }
  const iso = new Date(at).toISOString();
  const value = {
    ok: true,
    currency: code.toUpperCase(),
    nearPrice: price,
    nearPerUnit: 1 / price,
    source: `CoinGecko near/${code} at ${iso}: 1 NEAR = ${price} ${code.toUpperCase()}.`,
  };
  cache.set(code, { at, value });
  return value;
}

export const _clearRateCache = () => cache.clear();
