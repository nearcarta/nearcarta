// Login asks for a function-call key on the board, then signs eligible calls here.
// Same sign-in fields as function-call-key-plugin 2.2.0:
// https://docs.near.org/web3-apps/tutorials/wallet-login
// A function-call key cannot attach a deposit:
// https://docs.near.org/protocol/accounts-contracts/access-keys
import { AGENT_LS, functionCall, keyFrom, rpcClient, signTx } from '../../shared/vault/tx.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

export const pluginKeyName = id => `access_key::plugin::mainnet::${id}`;

export function createBoardKeyPlugin({ contractId, methodNames, allowance }) {
  const names = [...methodNames];
  return {
    async signIn(data, next) {
      const key = keyFrom();
      if (data) {
        data.addFunctionCallKey = {
          contractId,
          publicKey: key.publicKey,
          allowMethods: { anyMethod: false, methodNames: names },
          gasAllowance: { kind: 'limited', amount: String(allowance) },
        };
      }
      const accounts = await next();
      const accountId = accounts?.[0]?.accountId;
      if (accountId && globalThis.localStorage) {
        localStorage.setItem(pluginKeyName(accountId), JSON.stringify({ privateKey: key.secretKey, contractId, methodNames: names }));
      }
      return accounts;
    },
    async signOut(_data, next) {
      const accounts = await this.getAccounts?.().catch(() => []) || [];
      if (next) await next();
      for (const a of accounts) localStorage.removeItem(pluginKeyName(a.accountId));
    },
    async signAndSendTransaction(params, next) {
      const accounts = await this.getAccounts?.().catch(() => []);
      const accountId = params?.signerId || accounts?.[0]?.accountId;
      const raw = accountId && localStorage.getItem(pluginKeyName(accountId));
      let stored;
      try { stored = raw ? JSON.parse(raw) : null; } catch { stored = null; }
      const actions = params?.actions || [];
      const eligible = stored && params.receiverId === stored.contractId && actions.length > 0 && actions.every(a =>
        a?.type === 'FunctionCall' && stored.methodNames.includes(a.params?.methodName) && BigInt(a.params?.deposit || 0) === 0n);
      if (!eligible) return next();
      // The vault slot is the secret Refresh agent key writes. The plugin copy is only a fallback.
      const vault = localStorage.getItem(AGENT_LS(accountId));
      const key = keyFrom(vault || stored.privateKey);
      const rpc = rpcClient([MAIN.rpc, ...(MAIN.rpc_fallbacks || []), ...((globalThis.NEARCARTA_NET?.net === 'mainnet' && globalThis.NEARCARTA_NET.rpc) || [])]); // F64: fall back past a 429
      const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: key.publicKey }).catch(() => null);
      if (!ak?.permission?.FunctionCall) return next();
      const signed = signTx({
        key, signerId: accountId, receiverId: params.receiverId,
        nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash,
        actions: actions.map(a => functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), 0n)),
      });
      const r = await rpc('send_tx', { signed_tx_base64: signed.base64, wait_until: 'FINAL' });
      return { transaction: { hash: signed.hash }, ...r };
    },
    async signAndSendTransactions(_params, next) { return next(); },
  };
}
