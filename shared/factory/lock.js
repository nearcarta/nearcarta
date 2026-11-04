// Storage math for the mainnet lock factory. Matches contracts/charter_factory_lock.
// 10^19 yoctoNEAR per byte is the protocol storage price. The stake is returned by reap.
export const STATE_SLACK_BYTES = 8192;
export const REGISTRY_FEE_YOCTO = 10n ** 22n;
export const BYTE_YOCTO = 10n ** 19n;
export const MAX_DEPOSIT_YOCTO = 10n * 10n ** 24n;

export function minDepositYocto(codeLen) {
  const n = BigInt(codeLen);
  if (n <= 0n) throw new Error('code length');
  return (n + BigInt(STATE_SLACK_BYTES)) * BYTE_YOCTO + REGISTRY_FEE_YOCTO;
}

// What the factory account itself must hold: its own wasm, the stored oath wasm,
// a little state, and 0.5 NEAR of liquid gas. All of it except gas comes back on reap.
export function factoryFundYocto(factoryWasmLen, oathLen) {
  const slack = 20_000n;
  return (BigInt(factoryWasmLen) + BigInt(oathLen) + slack) * BYTE_YOCTO + 5n * 10n ** 23n;
}
