// A payee on the public path is a NEAR mainnet account.
export function rejectTestnetReceiver(id) {
  const s = String(id || '');
  if (!s || /\.testnet$/i.test(s) || s.toLowerCase().includes('.testnet')) {
    const err = new Error('receiver must be a mainnet account');
    err.status = 400;
    throw err;
  }
  return s;
}
