// Deploy arena v2 onto the existing arena account.
// Dry by default. --live signs. The signer key is read from the environment
// and is never printed.
//
//   node scripts/arena-deploy.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node scripts/arena-deploy.js --live
//
// The account has no access key today, so --live closes it (the balance,
// including each pot whose NFT owner is that same beneficiary, returns to
// the owner) and creates the same name again. An in-place deploy runs only
// when a full-access key is already on the account. A pot whose owner is
// someone else stops the script. v1 has no method that pays that holder.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };
import { BYTE_YOCTO, deployCost } from '../shared/board/cost.js';

const ACCOUNT = MAIN.planned.arena;
const OWNER = MAIN.extras.arena.owner;
const BOARD = MAIN.board.contract;
const WASM_FILE = new URL('../contracts/arena_v2/target/wasm32-unknown-unknown/release/arena_v2.wasm', import.meta.url);

export function nearText(yocto) {
  const y = BigInt(yocto);
  const neg = y < 0n;
  const v = neg ? -y : y;
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (frac ? `${whole}.${frac}` : String(whole));
}

export function planDeploy({ account, owner, board, balanceYocto, storageUsage, keys, guardians, wasm, ownerBalanceYocto = null }) {
  const steps = [];
  const transfers = [];
  const blockers = [];
  const balance = BigInt(balanceYocto);
  const usage = BigInt(storageUsage);
  const stakeNow = usage * BYTE_YOCTO;
  const liquid = balance > stakeNow ? balance - stakeNow : 0n;
  if (stakeNow > balance) blockers.push('storage stake is above the account balance');
  const fullAccess = (keys || []).filter(k => {
    const perm = k.permission ?? k.access_key?.permission;
    return perm === 'FullAccess';
  });
  let pots = 0n;
  for (const g of guardians || []) {
    const reserved = BigInt(g.reserved || 0);
    const inflight = BigInt(g.in_flight || 0);
    if (reserved > 0n || inflight > 0n) blockers.push(`guardian ${g.token_id} still has reserved or in-flight NEAR`);
    const pot = BigInt(g.pot || 0);
    if (pot > 0n) {
      if (!g.owner_id) blockers.push(`guardian ${g.token_id} has a pot and no owner`);
      pots += pot;
      transfers.push({
        payee: g.owner_id,
        amount: pot.toString(),
        near: nearText(pot),
        why: `pot on guardian ${g.token_id}`,
      });
    }
  }
  if (pots > liquid) blockers.push('pots are larger than the liquid balance');
  const sha = createHash('sha256').update(wasm).digest('hex');
  const cost = deployCost(wasm.length, owner);
  const ownerBalance = ownerBalanceYocto == null ? null : BigInt(ownerBalanceYocto);
  const need = cost.stakeYocto + cost.prepaidYocto;
  const covered = ownerBalance == null ? null : ownerBalance + balance;
  const shortfall = covered == null ? null : (need > covered ? need - covered : 0n);
  const foreign = transfers.filter(t => t.payee !== owner);
  if (foreign.length) blockers.push('a pot payee is not the close beneficiary, and v1 cannot pay that holder');
  let path = 'refuse';
  steps.push({
    step: 'precheck',
    ok: blockers.length === 0,
    detail: blockers.length ? blockers.join('; ') : 'account, pots, and keys are ready',
  });
  if (!blockers.length && fullAccess.length > 0) {
    path = 'in_place';
    for (const t of transfers) steps.push({ step: 'transfer', payee: t.payee, amount: t.amount, near: t.near, detail: t.why });
    steps.push({ step: 'deploy', bytes: wasm.length, sha256: sha, detail: 'replace the code on the same account' });
    steps.push({ step: 'clean', method: 'clean', args: { board, owner }, detail: 'ignore the old state. Pots have already moved.' });
  } else if (!blockers.length) {
    path = 'same_name';
    steps.push({
      step: 'close',
      method: 'close',
      deposit: '1',
      payee: owner,
      amount: balance.toString(),
      near: nearText(balance),
      detail: 'no access key, so the owner closes the account. The whole balance returns to that owner.',
    });
    for (const t of transfers) {
      steps.push({
        step: 'refund',
        payee: t.payee,
        amount: t.amount,
        near: t.near,
        detail: `${t.why}. Included in close because this payee is the owner.`,
      });
    }
    steps.push({
      step: 'storage',
      payee: owner,
      amount: stakeNow.toString(),
      near: nearText(stakeNow),
      detail: 'storage stake returned by close',
    });
    const surplus = liquid - pots;
    steps.push({
      step: 'surplus',
      payee: owner,
      amount: surplus.toString(),
      near: nearText(surplus),
      detail: 'liquid NEAR that is not a pot, returned by close',
    });
    steps.push({
      step: 'create',
      account,
      stake: cost.stakeYocto.toString(),
      near: nearText(cost.stakeYocto),
      bytes: wasm.length,
      sha256: sha,
      detail: 'the same account name, new code',
    });
    steps.push({
      step: 'init',
      method: 'new',
      args: { board, owner, inference_budget: '0', inference_cost: '0' },
      detail: 'empty guardians. The owner sets the inference budget after this.',
    });
  }
  for (const t of foreign) steps.push({ step: 'unpaid', payee: t.payee, amount: t.amount, near: t.near, detail: t.why });
  const after = path === 'same_name' ? cost.stakeYocto : path === 'in_place' ? balance - pots : balance;
  return {
    account,
    owner,
    board,
    path,
    blockers,
    signs: false,
    wasm: { bytes: wasm.length, sha256: sha },
    storage: { bytes: usage.toString(), stake: stakeNow.toString(), near: nearText(stakeNow) },
    nextStorage: { bytes: cost.storageBytes.toString(), stake: cost.stakeYocto.toString(), near: nearText(cost.stakeYocto) },
    balanceBefore: { yocto: balance.toString(), near: nearText(balance) },
    balanceAfter: {
      yocto: after.toString(),
      near: nearText(after),
      note: path === 'same_name'
        ? 'the new arena balance is the storage stake. close pays the old balance to the owner first. Gas is paid by the signer and the unused part is refunded.'
        : 'arena balance after the pot transfers, before gas',
    },
    ownerReceives: path === 'same_name' ? { yocto: balance.toString(), near: nearText(balance) } : null,
    funding: {
      prepaidGas: cost.prepaidYocto.toString(),
      prepaidNear: nearText(cost.prepaidYocto),
      burnedGas: cost.burnedGasYocto.toString(),
      burnedNear: nearText(cost.burnedGasYocto),
      need: need.toString(),
      needNear: nearText(need),
      ownerBalance: ownerBalance == null ? null : ownerBalance.toString(),
      ownerNear: ownerBalance == null ? null : nearText(ownerBalance),
      shortfall: shortfall == null ? null : shortfall.toString(),
      shortfallNear: shortfall == null ? null : nearText(shortfall),
    },
    transfers,
    steps,
    postDeploy: { method: 'get_config', account },
    smoke: {
      signs: false,
      view: 'get_config',
      mint: {
        method: 'mint',
        fee: '1',
        pot: '1',
        deposit: '2',
        allow: owner,
        detail: 'the smallest mint the contract accepts. Not a visitor price, and not sent by the dry-run.',
      },
    },
  };
}

function printPlan(plan) {
  console.log('Account: ' + plan.account);
  console.log('Owner: ' + plan.owner);
  console.log('Board: ' + plan.board);
  console.log('Path: ' + plan.path);
  console.log('Wasm: ' + plan.wasm.bytes + ' bytes, sha256 ' + plan.wasm.sha256);
  console.log('Storage now: ' + plan.storage.bytes + ' bytes, stake ' + plan.storage.stake + ' yoctoNEAR (' + plan.storage.near + ' NEAR)');
  console.log('Storage after: ' + plan.nextStorage.bytes + ' bytes, stake ' + plan.nextStorage.stake + ' yoctoNEAR (' + plan.nextStorage.near + ' NEAR)');
  console.log('Balance before: ' + plan.balanceBefore.yocto + ' yoctoNEAR (' + plan.balanceBefore.near + ' NEAR)');
  console.log('Balance after: ' + plan.balanceAfter.yocto + ' yoctoNEAR (' + plan.balanceAfter.near + ' NEAR)');
  console.log(plan.balanceAfter.note);
  if (plan.ownerReceives) console.log('Owner receives from close: ' + plan.ownerReceives.yocto + ' yoctoNEAR (' + plan.ownerReceives.near + ' NEAR)');
  if (plan.funding) {
    console.log('Prepaid gas: ' + plan.funding.prepaidGas + ' yoctoNEAR (' + plan.funding.prepaidNear + ' NEAR), burned about ' + plan.funding.burnedNear + ' NEAR');
    console.log('Owner must cover stake plus prepaid gas: ' + plan.funding.need + ' yoctoNEAR (' + plan.funding.needNear + ' NEAR), counting the close refund');
    if (plan.funding.ownerNear) console.log('Owner liquid now: ' + plan.funding.ownerBalance + ' yoctoNEAR (' + plan.funding.ownerNear + ' NEAR)');
    if (plan.funding.shortfallNear) console.log('Shortfall after the refund: ' + plan.funding.shortfall + ' yoctoNEAR (' + plan.funding.shortfallNear + ' NEAR)');
  }
  if (!plan.transfers.length) console.log('Transfers: none');
  for (const t of plan.transfers) console.log('Transfer: ' + t.amount + ' yoctoNEAR (' + t.near + ' NEAR) to ' + t.payee + ' (' + t.why + ')');
  for (const s of plan.steps) {
    const payee = s.payee ? ' payee ' + s.payee : '';
    const amount = s.amount ? ' amount ' + s.amount : '';
    console.log('Step ' + s.step + ':' + payee + amount + ' ' + (s.detail || ''));
  }
  console.log('Post-deploy view: ' + plan.postDeploy.method + ' on ' + plan.postDeploy.account);
  console.log('Smoke: view ' + plan.smoke.view + ', then mint fee ' + plan.smoke.mint.fee + ' yocto, pot ' + plan.smoke.mint.pot + ' yocto, deposit ' + plan.smoke.mint.deposit + ' yocto, allow ' + plan.smoke.mint.allow + '. ' + plan.smoke.mint.detail);
  console.log('This command does not sign and does not send NEAR.');
}

function wasmBytes() {
  if (!existsSync(WASM_FILE)) {
    const built = spawnSync('cargo', ['+1.95.0', 'build', '--target', 'wasm32-unknown-unknown', '--release', '--locked'], {
      cwd: new URL('../contracts/arena_v2/', import.meta.url),
      stdio: 'inherit',
    });
    if (built.status !== 0 || !existsSync(WASM_FILE)) throw new Error('arena_v2 wasm did not build');
  }
  return readFileSync(WASM_FILE);
}

async function rpc(method, params) {
  const res = await fetch(MAIN.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'arena-deploy', method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || body.error.data || 'rpc error');
  return body.result;
}

async function view(method, args) {
  try {
    const result = await rpc('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: ACCOUNT,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    const text = Buffer.from(result.result).toString();
    return text ? JSON.parse(text) : null;
  } catch {
    return undefined;
  }
}

async function liveState() {
  const account = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: ACCOUNT });
  const ownerAccount = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: OWNER }).catch(() => null);
  const listed = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: ACCOUNT });
  const tokens = await view('nft_tokens', { from_index: '0', limit: 50 });
  const guardians = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const g = await view('get_guardian', { token_id: token.token_id });
    guardians.push({
      token_id: token.token_id,
      owner_id: token.owner_id,
      pot: g?.pot ?? '0',
      reserved: g?.reserved ?? '0',
      in_flight: g?.in_flight ?? 0,
    });
  }
  return { account, ownerAccount, keys: listed.keys || [], guardians };
}

async function signLive(plan) {
  const signerKey = process.env.NEAR_MAINNET_SIGNER_KEY || '';
  if (!signerKey.startsWith('ed25519:')) {
    console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + OWNER + '.');
    process.exit(1);
  }
  const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
  const provider = new JsonRpcProvider({ url: MAIN.rpc });
  const signer = KeyPairSigner.fromSecretKey(signerKey);
  const publicKey = (await signer.getPublicKey()).toString();
  const access = await rpc('query', {
    request_type: 'view_access_key', finality: 'final', account_id: OWNER, public_key: publicKey,
  }).catch(() => null);
  if (!access || access.permission !== 'FullAccess') {
    console.error('Refusing to sign: the key is not a full-access key on ' + OWNER + '.');
    process.exit(1);
  }
  const ownerAccount = new Account(OWNER, provider, signer);
  const wasm = wasmBytes();
  const TG = 10n ** 12n;
  const cost = deployCost(wasm.length, OWNER);
  let sent;
  if (plan.path === 'same_name') {
    const closed = await ownerAccount.signAndSendTransaction({
      receiverId: ACCOUNT,
      waitUntil: 'FINAL',
      throwOnFailure: false,
      actions: [A.functionCall('close', {}, 30n * TG, 1n)],
    });
    console.log('close tx: ' + (closed.transaction?.hash || closed.transaction_outcome?.id || 'sent'));
    for (let i = 0; i < 20; i++) {
      const still = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: ACCOUNT }).catch(() => null);
      if (!still) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    sent = await ownerAccount.signAndSendTransaction({
      receiverId: ACCOUNT,
      waitUntil: 'FINAL',
      throwOnFailure: false,
      actions: [
        A.createAccount(),
        A.transfer(cost.stakeYocto),
        A.deployContract(new Uint8Array(wasm)),
        A.functionCall('new', {
          board: BOARD, owner: OWNER, inference_budget: '0', inference_cost: '0',
        }, 80n * TG, 0n),
      ],
    });
  } else {
    const arena = new Account(ACCOUNT, provider, signer);
    if (plan.transfers.length) {
      for (const t of plan.transfers) {
        const moved = await arena.signAndSendTransaction({
          receiverId: t.payee, waitUntil: 'FINAL', throwOnFailure: false,
          actions: [A.transfer(BigInt(t.amount))],
        });
        console.log('refund tx: ' + (moved.transaction?.hash || 'sent') + ' to ' + t.payee);
      }
    }
    sent = await arena.signAndSendTransaction({
      receiverId: ACCOUNT,
      waitUntil: 'FINAL',
      throwOnFailure: false,
      actions: [
        A.deployContract(new Uint8Array(wasm)),
        A.functionCall('clean', { board: BOARD, owner: OWNER }, 80n * TG, 0n),
      ],
    });
  }
  console.log('deploy tx: ' + (sent.transaction?.hash || sent.transaction_outcome?.id || 'sent'));
  const cfg = await view('get_config', {});
  console.log('Post-deploy get_config: ' + JSON.stringify(cfg));
}

async function main() {
  if (!ACCOUNT || !OWNER || !BOARD) throw new Error('mainnet.json is missing the arena account, its owner, or the board');
  const wasm = wasmBytes();
  const state = await liveState();
  const plan = planDeploy({
    account: ACCOUNT,
    owner: OWNER,
    board: BOARD,
    balanceYocto: state.account.amount,
    storageUsage: state.account.storage_usage,
    keys: state.keys,
    guardians: state.guardians,
    wasm,
    ownerBalanceYocto: state.ownerAccount
      ? (BigInt(state.ownerAccount.amount) - BigInt(state.ownerAccount.storage_usage) * BYTE_YOCTO).toString()
      : null,
  });
  printPlan(plan);
  if (!process.argv.includes('--live')) return;
  if (plan.blockers.length || plan.path === 'refuse') {
    console.error('Refusing to sign: ' + (plan.blockers.join('; ') || plan.path));
    process.exit(1);
  }
  if (plan.funding?.shortfall && plan.funding.shortfall !== '0') {
    console.error('Refusing to sign: after close, ' + OWNER + ' is short ' + plan.funding.shortfallNear + ' NEAR for the new stake and prepaid gas.');
    process.exit(1);
  }
  await signLive(plan);
}

const direct = process.argv[1] && process.argv[1].endsWith('arena-deploy.js');
if (direct) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : 'arena deploy failed');
    process.exit(1);
  });
}
