// City Ferry settlement: a dry quote, then a deposit address, then a status beat.
// The boat says delivered only when 1Click says SUCCESS.
// propose_call is wrap.near only, and only when the row cap can hold the deposit.
// A function-call key cannot attach NEAR and must not fall through to a wallet.
// Sources: backend/src/ferry-checkout.js MAX_CHECKOUT_USD; shared/board/session.js FERRY_CALL_TARGETS;
// contracts/charter_board call_text; NEP-141 ft_transfer; wrap.near near_deposit / storage_deposit.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// https://github.com/near/NEPs/blob/master/neps/nep-0141.md

export const MAX_CHECKOUT_USD = 0.2;
export const WRAP = 'wrap.near';
// Primary session settle. A dry 1Click quote of 0.05 wNEAR@near → USDC@near is about $0.185,
// under MAX_CHECKOUT_USD, and the origin chain is NEAR so depositPlan returns propose_call.
// 1Click can still reject a different corridor under that USD cap when the amount is below the
// bridge minimum ("Amount is too low for bridge, try at least N" raw units).
// https://docs.near-intents.org/integration/distribution-channels/1click-api
// wrap.near near_deposit / storage_deposit / ft_transfer:
// https://docs.near.org/tutorials/tokens/creating-a-ft
// The board signs call_text (contracts/charter_board/src/lib.rs) and the session key calls
// propose_call. A function-call key cannot attach NEAR:
// https://docs.near.org/protocol/accounts-contracts/access-keys
export const SESSION_SWAP = {
  from: 'wNEAR@near',
  to: 'USDC@near',
  amt: '0.05',
  fromId: 'wNEAR|near',
  toId: 'USDC|near',
};

/** Plain reason for a 1Click quote or checkout miss. Never says the boat delivered. */
export function explainQuoteMiss(error) {
  const raw = String(error || '').replace(/\s+/g, ' ').trim();
  const low = raw.match(/too low for bridge[^\d]*(\d+)/i);
  if (low) {
    return `Below this corridor's bridge minimum. 1Click asked for at least ${low[1]} raw units. No deposit address. Nothing was sent. The boat has not delivered.`;
  }
  if (/over_checkout_cap|over 0\.20/i.test(raw)) {
    return 'Over the 0.20 USD checkout cap. No deposit address. Nothing was sent. The boat has not delivered.';
  }
  if (raw === 'no_usd' || /no usd|has no USD/i.test(raw)) {
    return 'No deposit address. This quote has no USD amount. Nothing was sent. The boat has not delivered.';
  }
  if (!raw) return 'Live quote did not return. No deposit address. Nothing was sent. The boat has not delivered.';
  return `${raw.slice(0, 180)} No deposit address. Nothing was sent. The boat has not delivered.`;
}
// wrap.near storage_balance_bounds.min — 0.00125 NEAR.
export const WRAP_STORAGE_YOCTO = '1250000000000000000000';
// Board forwards 30 Tgas plus an 8 Tgas callback. 42 Tgas leaves a little for propose_call
// itself and buys at about 0.042 NEAR, under the 0.05 session allowance.
export const PROPOSE_CALL_TGAS = 42;

export function quoteUsd(q) {
  const raw = q?.from?.usd ?? q?.usd ?? q?.amountInUsd ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** No deposit address unless the signed quote is known and at most 0.20 USD. */
export function mayCheckout(q) {
  const usd = quoteUsd(q);
  if (usd == null) return { ok: false, reason: 'no_usd', usd: null };
  if (usd <= 0 || usd > MAX_CHECKOUT_USD + 1e-9) return { ok: false, reason: 'over_checkout_cap', usd };
  return { ok: true, reason: null, usd };
}

export function nearNative(from) {
  const chain = String(from || '').split('@').pop().split('|').pop().toLowerCase();
  return chain === 'near';
}

export function yoctoNear(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
}

/** Same string as contracts/charter_board `call_text`, once args are already sha256-hex. */
export function boardCallText({ contract, owner, receiver, method, argsHash, deposit, nonce }) {
  return `board-call-v1|${contract}|${owner}|${receiver}|${method}|${argsHash}|${deposit}|${nonce}`;
}

/** 0.001 NEAR per Tgas, plus 0.001 NEAR of slack for the receipt fees. */
export function proposeCallAllowanceOk(allowanceYocto, tgas = PROPOSE_CALL_TGAS) {
  try {
    const need = BigInt(tgas) * 10n ** 21n + 10n ** 21n;
    return BigInt(allowanceYocto) >= need;
  } catch { return false; }
}

export function orderForStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'SUCCESS') return 'delivered';
  if (s === 'REFUNDED') return 'refunded';
  if (s === 'FAILED') return 'frozen';
  if (s === 'KNOWN_DEPOSIT_TX' || s === 'PROCESSING') return 'transit';
  return 'deposit';
}

/** Sail only the first time status is SUCCESS. A refund does not play delivered. */
export function nextFerryBeat(status, { sailed = false } = {}) {
  const raw = String(status || '').toUpperCase();
  const order = orderForStatus(raw);
  const play = order === 'delivered' && !sailed;
  const terminal = raw === 'SUCCESS' || raw === 'REFUNDED' || raw === 'FAILED';
  return { order, play, sailed: sailed || play, terminal };
}

/**
 * NEAR-native corridors can be wrap.near calls from the row.
 * Anything else, or a deposit over the cap, is "you send". wallet is always false.
 */
export function depositPlan({ from, amount, depositAddress, memo = null, capYocto = null, balanceYocto = null, keyMethods = null } = {}) {
  const you = (why) => ({ kind: 'you-send', why, wallet: false, steps: [] });
  if (!nearNative(from)) return you('This chain is not wrap.near. Send the tokens yourself to the deposit address.');
  if (Array.isArray(keyMethods) && keyMethods.length && !keyMethods.includes('propose_call')) {
    return you('This session key cannot call propose_call. Send the tokens yourself. No wallet will open.');
  }
  if (!depositAddress) return you('No deposit address yet.');
  const amt = yoctoNear(amount);
  if (!amt) return you('The NEAR amount is not a number. Send the tokens yourself.');
  let cap = null;
  let bal = null;
  try { if (capYocto != null && capYocto !== '') cap = BigInt(capYocto); } catch { return you('The session cap is not a number.'); }
  try { if (balanceYocto != null && balanceYocto !== '') bal = BigInt(balanceYocto); } catch { bal = null; }
  const steps = [
    { receiver: WRAP, method: 'near_deposit', args: '{}', deposit: amt },
    { receiver: WRAP, method: 'storage_deposit', args: JSON.stringify({ account_id: depositAddress, registration_only: true }), deposit: WRAP_STORAGE_YOCTO },
    { receiver: WRAP, method: 'ft_transfer', args: JSON.stringify({ receiver_id: depositAddress, amount: amt, memo: memo || null }), deposit: '1' },
  ];
  let sum = 0n;
  for (const s of steps) {
    const d = BigInt(s.deposit);
    sum += d;
    if (cap != null && d > cap) return you('That amount is over the session cap. Send it yourself to the deposit address.');
  }
  if (bal != null && sum > bal) return you('The row does not hold enough NEAR for this wrap. Send it yourself to the deposit address.');
  return { kind: 'propose_call', why: '', wallet: false, steps };
}

export function cityCheckoutBody({ pair, recipient, charter, amountYocto, refundTo }) {
  const fromSym = pair.fromSym || String(pair.from || '').split('@')[0];
  const fromChain = pair.fromChain || String(pair.from || '').split('@')[1];
  const toSym = pair.toSym || String(pair.to || '').split('@')[0];
  const toChain = pair.toChain || String(pair.to || '').split('@')[1];
  return {
    from: { symbol: fromSym, chain: fromChain },
    to: { symbol: toSym, chain: toChain },
    amount: String(pair.amt),
    recipient,
    refundTo,
    charter,
    clause_id: 'pay',
    amount_yocto: String(amountYocto),
    privacy: 'public',
  };
}
