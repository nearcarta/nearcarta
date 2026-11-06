// Pure plan for scripts/hall-deploy.js. No network and no key.
// An open bounty is refunded to the signer of the post_bounty transaction
// that created it, and only when that signer is the contract's dao or the shop.
// The new code then replaces the account with migrate (clean state).

export const BYTE_YOCTO = 10n ** 19n;
export const GAS_PRICE_YOCTO = 100_000_000n;
export const GAS_PURCHASE_YOCTO = 1_000_000_000n;
const TRANSFER_GAS = 115_123_062_500n + 115_123_062_500n;
const DEPLOY_SEND = 184_765_750_000n;
const DEPLOY_SEND_PER_BYTE = 47_683_715n;
const DEPLOY_EXEC = 184_765_750_000n;
const DEPLOY_EXEC_PER_BYTE = 64_572_944n;
const CALL_SEND = 200_000_000_000n;
const CALL_SEND_PER_BYTE = 47_683_715n;
const CALL_EXEC = 780_000_000_000n;
const CALL_EXEC_PER_BYTE = 2_235_934n;
const RECEIPT_GAS = 108_059_500_000n + 108_059_500_000n;
// The `migrate` FunctionCall attaches this much gas. The sender prepays all of it
// at 0.001 NEAR/Tgas (0.08 NEAR) and is refunded the unused part after execution,
// so the balance must hold it at send time even though most comes back.
export const MIGRATE_TGAS = 80n;
export const MIGRATE_ATTACHED_YOCTO = MIGRATE_TGAS * 10n ** 12n * GAS_PURCHASE_YOCTO;

export const SMOKE_YOCTO = 10n ** 21n; // 0.001 NEAR, the smoke size only

const near = y => {
  const neg = y < 0n;
  const v = neg ? -y : y;
  return (neg ? '-' : '') + (Number(v / 10n ** 18n) / 1e6).toFixed(6);
};

function deployGas(wasmLen, argBytes) {
  const n = BigInt(wasmLen);
  const a = BigInt(argBytes);
  return DEPLOY_SEND + DEPLOY_SEND_PER_BYTE * n + DEPLOY_EXEC + DEPLOY_EXEC_PER_BYTE * n
    + CALL_SEND + CALL_SEND_PER_BYTE * a + CALL_EXEC + CALL_EXEC_PER_BYTE * a
    + RECEIPT_GAS;
}

export function refundTransfers({ shop, dao, bounties, posts }) {
  const open = (bounties || []).filter(b => b.claimed_by == null || b.claimed_by === '');
  const transfers = [];
  for (const bounty of open) {
    const post = (posts || []).find(p => p.method === 'post_bounty' && p.bountyHash === bounty.hash && String(p.amount) === String(bounty.amount) && p.receiver === shop);
    if (!post) {
      const err = new Error('No posting transaction matches open bounty ' + bounty.hash);
      err.code = 'ERR_POSTER';
      throw err;
    }
    if (post.signer !== dao && post.signer !== shop) {
      const err = new Error('Posting signer ' + post.signer + ' is not the dao or the shop');
      err.code = 'ERR_PAYEE';
      throw err;
    }
    transfers.push({
      payee: post.signer,
      amount: String(bounty.amount),
      reason: 'open bounty ' + bounty.hash,
      sourceTx: post.tx,
    });
  }
  return transfers;
}

export function hallDeployPlan({
  shop, owner, board, dao, balanceYocto, storageBytes, oldWasmBytes, newWasmBytes, wasmSha256,
  bounties, posts, fullAccessKeys, codeHash, oldCodeHash, smokeWorkers,
}) {
  const transfers = refundTransfers({ shop, dao, bounties, posts });
  const refund = transfers.reduce((n, t) => n + BigInt(t.amount), 0n);
  const balance = BigInt(balanceYocto);
  const storage = BigInt(storageBytes);
  const oldWasm = BigInt(oldWasmBytes);
  const nextWasm = BigInt(newWasmBytes);
  const stakeNow = storage * BYTE_YOCTO;
  const storageAfter = storage - oldWasm + nextWasm;
  const stakeAfter = storageAfter * BYTE_YOCTO;
  const migrateArgs = JSON.stringify({ owner, board });
  const gasDeploy = deployGas(nextWasm, migrateArgs.length);
  const gasRefund = TRANSFER_GAS * BigInt(Math.max(transfers.length, 1)) + RECEIPT_GAS;
  const burnedRefund = gasRefund * GAS_PRICE_YOCTO;
  const burnedDeploy = gasDeploy * GAS_PRICE_YOCTO;
  const prepaidDeploy = gasDeploy * GAS_PURCHASE_YOCTO + MIGRATE_ATTACHED_YOCTO;
  const balanceAfter = balance - refund - burnedRefund - burnedDeploy;
  const liquidAfter = balanceAfter - stakeAfter;
  const peakNeed = stakeAfter + prepaidDeploy;
  const afterRefund = balance - refund;
  const shortfall = afterRefund > peakNeed ? 0n : peakNeed - afterRefund;
  // The exact shortfall leaves no liquid NEAR. New STATE keys at migrate add a few
  // hundred bytes, and the smoke post needs its own deposit, so the printed top-up
  // rounds up to the next 0.01 NEAR. The stake itself does not change.
  const STEP = 10n ** 22n; // 0.01 NEAR
  const recommendedTopUp = shortfall === 0n ? 0n : ((shortfall + STEP - 1n) / STEP) * STEP;
  const checks = [];
  const need = (ok, label) => checks.push({ ok: !!ok, label });
  need(fullAccessKeys >= 1, 'the shop account has a full-access key');
  need(oldCodeHash && codeHash === oldCodeHash, 'the code hash is still the oath wasm');
  need(balance > stakeNow, 'the balance covers the current storage stake');
  need(refund > 0n || (bounties || []).every(b => b.claimed_by), 'every open bounty is in the refund list');
  need(transfers.every(t => t.payee === dao || t.payee === shop), 'each refund payee is the posting signer');
  need(balance > refund + burnedRefund, 'the balance covers the refund and its gas');
  need(liquidAfter > 0n, 'after the refund and the new wasm, the storage stake still fits');
  need(shortfall === 0n, 'the account can prepay deploy gas and the new storage stake');
  const smoke = smokeWorkers && smokeWorkers.length >= 1
    ? {
      skipped: false,
      deposit: SMOKE_YOCTO.toString(),
      row_owner: shop,
      workers: smokeWorkers,
      calls: [
        { method: 'post_job', deposit: SMOKE_YOCTO.toString(), args: { row_owner: shop, task: 'smoke', parts: 1, workers: smokeWorkers } },
        { method: 'refund', deposit: '0', args: { row_owner: shop, job_id: '1' } },
      ],
    }
    : { skipped: true, deposit: SMOKE_YOCTO.toString(), workers: [], note: 'Set HALL_SMOKE_A and HALL_SMOKE_B. No worker account is hardcoded.' };

  return {
    shop, owner, board, dao,
    wasm: { bytes: Number(nextWasm), sha256: wasmSha256 },
    storage: {
      bytesNow: storage.toString(),
      stakeNow: stakeNow.toString(),
      stakeNowNear: near(stakeNow),
      bytesAfter: storageAfter.toString(),
      stakeAfter: stakeAfter.toString(),
      stakeAfterNear: near(stakeAfter),
    },
    balance: {
      before: balance.toString(),
      beforeNear: near(balance),
      refund: refund.toString(),
      refundNear: near(refund),
      burnedGas: (burnedRefund + burnedDeploy).toString(),
      prepaidDeploy: prepaidDeploy.toString(),
      prepaidDeployNear: near(prepaidDeploy),
      after: balanceAfter.toString(),
      afterNear: near(balanceAfter),
      liquidAfter: liquidAfter.toString(),
      liquidAfterNear: near(liquidAfter),
      shortfall: shortfall.toString(),
      shortfallNear: near(shortfall),
      recommendedTopUp: recommendedTopUp.toString(),
      recommendedTopUpNear: near(recommendedTopUp),
    },
    transfers,
    checks,
    ok: checks.every(c => c.ok),
    steps: [
      { n: 1, name: 'refund open bounties', pre: ['view get_bounties', 'view get_state', 'match each open bounty to its post_bounty signer'], transfers },
      { n: 2, name: 'deploy hall wasm and migrate', pre: ['refund transfers above are the only spends', 'code hash is still the oath wasm', 'new stake fits'], method: 'migrate', args: { owner, board } },
      { n: 3, name: 'post-deploy view', method: 'get_hall', expect: { owner, board, jobs: 0 } },
      { n: 4, name: 'smoke', ...smoke },
    ],
  };
}
