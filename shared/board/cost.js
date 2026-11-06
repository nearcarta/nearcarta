// Deploy cost for the one mainnet board. The numbers are the live mainnet
// protocol config (EXPERIMENTAL_protocol_config, block 223075967, 2026-11-04):
// storage_amount_per_byte, num_bytes_account, num_extra_bytes_record,
// account_creation_charge, and the action gas costs used below.
// A new account starts at 100 bytes. Code adds the wasm length. The `new`
// call writes one trie record: key "STATE" (5) + the encoded owner + 40.
// The account must hold storage_bytes * 10^19. Creating it also burns 0.007 NEAR,
// taken out of the gas refund. Gas is burned at 10^8 yoctoNEAR and prepaid at 10^9.
export const BYTE_YOCTO = 10n ** 19n;
export const ACCOUNT_BYTES = 100n;
export const RECORD_EXTRA = 40n;
export const STATE_KEY_BYTES = 5n;
export const ACCOUNT_CREATION_YOCTO = 7_000_000_000_000_000_000_000n;
export const GAS_PRICE_YOCTO = 100_000_000n;
export const GAS_PURCHASE_YOCTO = 1_000_000_000n;
export const ONE_NEAR = 10n ** 24n;
// 2.1 NEAR. The live account (108955 bytes, sha256 910268da…, code hash
// Am4FLfphc4JF7ZZLRrs3j1otwyKyiQZqygBJ8nnZs78C, deploy CfdUppnLo…) staked about
// 1.09 NEAR. Board v2 is larger. The cap is a maximum, not a blank cheque.
// The stake comes back on reap.
export const MAX_DEPLOY_YOCTO = 21n * ONE_NEAR / 10n;

const CREATE_SEND = 500_000_000_000n;
const CREATE_EXEC = 7_200_000_000_000n;
const TRANSFER_SEND = 115_123_062_500n;
const TRANSFER_EXEC = 115_123_062_500n;
const DEPLOY_SEND = 184_765_750_000n;
const DEPLOY_SEND_PER_BYTE = 47_683_715n;
const DEPLOY_EXEC = 184_765_750_000n;
const DEPLOY_EXEC_PER_BYTE = 64_572_944n;
const CALL_SEND = 200_000_000_000n;
const CALL_SEND_PER_BYTE = 47_683_715n;
const CALL_EXEC = 780_000_000_000n;
const CALL_EXEC_PER_BYTE = 2_235_934n;
const RECEIPT_SEND = 108_059_500_000n;
const RECEIPT_EXEC = 108_059_500_000n;

/** Encoded empty board: u32 len + owner + three u32 counters. Matches `state_bytes()` in the contract. */
export function initStateBytes(owner) {
  if (!owner || owner.length > 64) throw new Error('owner account id');
  return 4 + owner.length + 4 + 4 + 4;
}

/** Empty v2 header: magic, owner, count, owed, hold count, "mainnet", hash, eta, flag. */
export function headValueBytes(owner) {
  if (!owner || owner.length > 64) throw new Error('owner account id');
  return 4 + (4 + owner.length) + 4 + 16 + 4 + (4 + 'mainnet'.length) + 32 + 8 + 1;
}

export function storageBytes(wasmLen, owner) {
  const n = BigInt(wasmLen);
  if (n <= 0n) throw new Error('wasm length');
  const v1 = ACCOUNT_BYTES + n + STATE_KEY_BYTES + BigInt(initStateBytes(owner)) + RECORD_EXTRA;
  const v2 = ACCOUNT_BYTES + n + 4n + BigInt(headValueBytes(owner)) + RECORD_EXTRA;
  return v1 > v2 ? v1 : v2;
}

/** Gas for CreateAccount + Transfer + DeployContract + FunctionCall("new", {}). */
export function deployGas(wasmLen, argBytes = 2) {
  const n = BigInt(wasmLen);
  const a = BigInt(argBytes);
  return CREATE_SEND + CREATE_EXEC
    + TRANSFER_SEND + TRANSFER_EXEC
    + DEPLOY_SEND + DEPLOY_SEND_PER_BYTE * n + DEPLOY_EXEC + DEPLOY_EXEC_PER_BYTE * n
    + CALL_SEND + CALL_SEND_PER_BYTE * a + CALL_EXEC + CALL_EXEC_PER_BYTE * a
    + RECEIPT_SEND + RECEIPT_EXEC;
}

export function deployCost(wasmLen, owner) {
  const bytes = storageBytes(wasmLen, owner);
  const stakeYocto = bytes * BYTE_YOCTO;
  const gas = deployGas(wasmLen);
  const burnedGasYocto = gas * GAS_PRICE_YOCTO;
  const prepaidYocto = gas * GAS_PURCHASE_YOCTO;
  const accountCreationYocto = ACCOUNT_CREATION_YOCTO;
  // What leaves the owner and does not come back before reap: the stake (returned by reap),
  // the burned gas, and the 0.007 NEAR account-creation charge.
  const totalYocto = stakeYocto + burnedGasYocto + accountCreationYocto;
  // What the owner must hold to send the transaction. The gas is prepaid at the higher
  // purchase price; the difference comes back in the same transaction, minus the 0.007 charge.
  const peakYocto = stakeYocto + prepaidYocto;
  return { storageBytes: bytes, stakeYocto, gas, burnedGasYocto, prepaidYocto, accountCreationYocto, totalYocto, peakYocto };
}

/** Yocto a function-call key's allowance is charged for one zero-deposit call.
 *  Same split as nearcore `calculate_tx_cost`: send fees burn at the block gas
 *  price; attached gas and exec fees are bought at max(that price, GAS_PURCHASE_YOCTO),
 *  which on mainnet is 0.001 NEAR/Tgas. `numBytes` is the method name plus the args.
 *  The sender is not the receiver. Deposit is not included: a function-call key cannot
 *  attach NEAR. https://docs.near.org/protocol/transactions/gas#buying-vs-burning-gas
 *  Live Ferry propose (80 Tgas, 310 bytes) charged 80921036784705000000000. */
export function functionCallAllowanceCost({ tgas, numBytes, gasPrice = GAS_PRICE_YOCTO }) {
  const bytes = BigInt(numBytes);
  const price = BigInt(gasPrice);
  const attached = BigInt(tgas) * 10n ** 12n;
  const burnt = RECEIPT_SEND + CALL_SEND + CALL_SEND_PER_BYTE * bytes;
  const remaining = attached + RECEIPT_EXEC + CALL_EXEC + CALL_EXEC_PER_BYTE * bytes;
  const buy = price > GAS_PURCHASE_YOCTO ? price : GAS_PURCHASE_YOCTO;
  return burnt * price + remaining * buy;
}
