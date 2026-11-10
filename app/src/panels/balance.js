// One token balance, read from chain. Pure apart from the RPC call, so it can be tested with a
// mocked transport.
//
// The swap cards show "Balance: x TOKEN" above each side. Two kinds of token:
//   - NEAR itself: the account's spendable amount from `view_account.amount`.
//   - a NEP-141 token: `ft_balance_of` on the TOKEN'S OWN CONTRACT, not the 1Click asset id.
//     The catalogue gives "nep141:wrap.near"; the contract is the part after the prefix.
//
// Returns { ok, value, raw, symbol, decimals, reason }. It never invents a number: a failed read
// comes back ok:false with a reason, and the panel then shows nothing.

/** The contract id for a catalogue token: strips the 1Click `nep141:` prefix when present. */
export function contractOf(token = {}) {
  const raw = String(token.contract || token.assetId || '');
  return raw.startsWith('nep141:') ? raw.slice(7) : raw;
}

/** A balance as a display number, from the raw integer string and the token's decimals. */
export function formatUnits(raw, decimals) {
  if (raw == null) return null;
  const s = String(raw);
  if (!/^-?\d+$/.test(s)) return null;
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 30) return null;
  return Number(BigInt(s)) / 10 ** d;
}

/**
 * @param {string} accountId  the signed-in account
 * @param {object} token      { symbol, decimals, contract? } or { symbol, decimals, assetId? }
 * @param {object} deps       { rpc } — an rpcClient from shared/vault/tx.js, or a stub in tests
 */
export async function readBalance(accountId, token = {}, { rpc } = {}) {
  const symbol = String(token.symbol || '');
  const decimals = token.decimals == null ? 24 : Number(token.decimals);
  if (!accountId) return { ok: false, value: null, reason: 'no account' };
  if (!rpc) return { ok: false, value: null, reason: 'no rpc' };

  const contract = contractOf(token);
  try {
    if (!contract) {
      // Native NEAR.
      const acc = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
      const raw = acc?.amount;
      const value = formatUnits(raw, decimals);
      if (value == null) return { ok: false, value: null, reason: 'no amount returned' };
      return { ok: true, value, raw: String(raw), symbol: symbol || 'NEAR', decimals };
    }
    const res = await rpc('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contract,
      method_name: 'ft_balance_of',
      args_base64: b64(JSON.stringify({ account_id: accountId })),
    });
    const raw = decodeResult(res);
    const value = formatUnits(raw, decimals);
    if (value == null) return { ok: false, value: null, reason: 'no balance returned' };
    return { ok: true, value, raw: String(raw), symbol, decimals, contract };
  } catch (e) {
    return { ok: false, value: null, reason: String(e?.message || e).slice(0, 120) };
  }
}

/** The view result arrives as base64 bytes of a JSON string; decode it to the integer string. */
function decodeResult(res) {
  const bytes = res?.result;
  if (bytes == null || bytes === '') return null;
  try {
    let buf;
    if (typeof bytes === 'string') {
      // Some transports hand back the base64 text rather than the decoded bytes.
      if (typeof Buffer !== 'undefined') buf = Buffer.from(bytes, 'base64');
      else buf = Uint8Array.from(atob(bytes), c => c.charCodeAt(0));
    } else {
      buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    }
    const txt = new TextDecoder().decode(buf).trim();
    if (!txt) return null;
    // ft_balance_of returns a JSON string ("177937"); some contracts return a bare number.
    if (/^\d+$/.test(txt)) return txt;
    const parsed = JSON.parse(txt);
    return typeof parsed === 'string' || typeof parsed === 'number' ? String(parsed) : null;
  } catch { return null; }
}

function b64(s) {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  return btoa(unescape(encodeURIComponent(s)));
}

/** "Balance: 1.2408 wNEAR", or '' when nothing was read. */
export function balanceLine(result) {
  if (!result?.ok || result.value == null) return '';
  const v = result.value;
  const shown = v === 0 ? '0' : v < 0.0001 ? '<0.0001' : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return `Balance: ${shown} ${result.symbol || ''}`.trim();
}
