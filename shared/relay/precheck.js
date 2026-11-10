// Balance pre-check for relayed market moves. A move that the market would refuse for a balance
// (an empty purse, goods not in the bag, a stall someone else holds) is stopped before it is sent, so it
// never burns the relayer's gas. Pure: the caller reads the state (server: RPC views; app: the same views).
//   state = { purse: bigint, storage?: bigint, bag: { [good]: number }, rules: { stall_rent }, stalls: [{ id, holder, until }], now_ns: bigint, me }
// Returns { ok: true } or { ok: false, why, need, have }.
const B = (v) => BigInt(v ?? 0);
// A first share or a stall writes a new record, paid from the citizen's market storage. Measured on
// mainnet: an invest refused ERR_STORAGE with 0.00324 left (tx 7DnRUbEzLXAcPz73WTkBUQjeyW3UbdQJMS9X3haDrwfm).
export const STORAGE_NEED = 5n * 10n ** 21n; // 0.005 NEAR
const lowStorage = (s) => s.storage != null && B(s.storage) < STORAGE_NEED;
export function precheck(calls, s) {
  let purse = B(s.purse); const bag = { ...(s.bag || {}) }; let soldIntoPurse = false, gathered = false;
  for (const { method, args = {} } of calls) {
    if (method === 'gather') { gathered = true; continue; }
    if (method === 'sell') {
      if (!gathered && Number(bag[args.good] || 0) < Number(args.qty || 0)) return { ok: false, why: 'ERR_PRECHECK_BAG', need: String(args.qty), have: String(bag[args.good] || 0) };
      bag[args.good] = Number(bag[args.good] || 0) - Number(args.qty || 0); if (args.keep) soldIntoPurse = true; continue;
    }
    if (method === 'purse') {
      const amt = B(args.amount);
      if (args.action === 'invest' && lowStorage(s)) return { ok: false, why: 'ERR_PRECHECK_STORAGE', need: STORAGE_NEED.toString(), have: B(s.storage).toString() };
      if (!soldIntoPurse && purse < amt) return { ok: false, why: 'ERR_PRECHECK_PURSE', need: amt.toString(), have: purse.toString() };
      purse -= amt; continue;
    }
    if (method === 'stall') {
      const st = (s.stalls || []).find((x) => Number(x.id) === Number(args.stall));
      const live = st && B(st.until) >= B(s.now_ns);
      if (args.action === 'rent') {
        if (live && st.holder !== s.me) return { ok: false, why: 'ERR_PRECHECK_STALL_TAKEN' };
        if (lowStorage(s)) return { ok: false, why: 'ERR_PRECHECK_STORAGE', need: STORAGE_NEED.toString(), have: B(s.storage).toString() };
        const rent = B(s.rules?.stall_rent);
        if (!soldIntoPurse && purse < rent) return { ok: false, why: 'ERR_PRECHECK_PURSE', need: rent.toString(), have: purse.toString() };
        purse -= rent; continue;
      }
      if (args.action === 'list') {
        if (!live || st.holder !== s.me) return { ok: false, why: 'ERR_PRECHECK_NOT_HOLDER' };
        if (!gathered && Number(bag[args.good] || 0) < Number(args.qty || 0)) return { ok: false, why: 'ERR_PRECHECK_BAG', need: String(args.qty), have: String(bag[args.good] || 0) };
        continue;
      }
      if (args.action === 'buy') {
        const max = B(args.price);
        if (!soldIntoPurse && purse < max) return { ok: false, why: 'ERR_PRECHECK_PURSE', need: max.toString(), have: purse.toString() };
        purse -= max; continue;
      }
    }
  }
  return { ok: true };
}
/** The goods a batch of calls touches (to read only those balances). */
export const goodsOf = (calls) => [...new Set(calls.filter((c) => c.args?.good).map((c) => c.args.good))];
