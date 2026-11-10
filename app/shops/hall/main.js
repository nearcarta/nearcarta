// Wallet send for Town Hall. The page mounts the shared editor from /panels/boot.js.
// This module only signs, and only when that editor calls it. Deposit is always 0.
import { currentAccount, makeConnector, txHashOf } from '../vault/wallet.js';
import { BOARD, callsFor } from './row.js';

const GAS = '80000000000000';

/** Sends the list from callsFor. A changed cap is set_rules. Loosening calls carry 1 yocto (refunded). */
export async function signCalls(calls) {
  const list = Array.isArray(calls) ? calls : callsFor({}, {});
  if (!list.length) return { hash: null, signer: null };
  if (list.some(c => !['set_rules', 'set_frozen', 'set_seal'].includes(c.method))) throw new Error('Only set_rules, set_frozen and set_seal are signed here.');
  const { connector } = makeConnector();
  let id = await currentAccount(connector);
  if (!id) {
    const picked = await connector.selectWallet();
    await connector.connect({ walletId: picked });
    id = await currentAccount(connector);
  }
  if (!id) throw new Error('Sign in to sign this row.');
  const w = await connector.wallet();
  const res = await w.signAndSendTransaction({
    receiverId: BOARD,
    actions: list.map(c => ({
      type: 'FunctionCall',
      params: { methodName: c.method, args: c.args, gas: GAS, deposit: String(c.deposit ?? '0') },
    })),
  });
  return { hash: txHashOf(res), signer: id };
}
