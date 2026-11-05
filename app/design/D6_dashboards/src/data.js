// Records shown in the dashboards. Every hash is in shared/deployments/mainnet.json.
export const PROJECT_NAME = 'the Town';
export const AGENT_NAME = 'the Lamplighter';
export const NB = (h) => `https://nearblocks.io/txns/${h}`;
export const NBA = (a) => `https://nearblocks.io/address/${a}`;

export const CORE = {
  oath: 'charter.nearcarta.near',
  owner: 'nearcarta.near',
  dao: 'nearcarta.near',
  receiver: 'nearcarta.near',
  network: 'mainnet',
  policyVersion: 'live',
  policyHash: '6aBm6TugZzge9uHDpSsr6pG7XPfZm22JoZ8XZxknRGsa',
  freezeEpoch: 0,
  codeHash: '6aBm6TugZzge9uHDpSsr6pG7XPfZm22JoZ8XZxknRGsa',
  agentKey: 'ed25519:GB83bZDdsoWrpBC43LURP1QCGX558V1qgYXMEQdX4ENi',
  allowanceStart: 0.25,
  allowanceNow: 0.25,
  snapshot: 'mainnet record',
};

export const CLAUSES = [
  { id: 'pay', kind: 'Native transfer', payees: ['nearcarta.near'], cap: 0.002, budget: 0.005, spent: 0.001, reserved: 0, window: 'Any time', escalate: null, receipt: false, src: 'mainnet', tx: 'JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy' },
];

export const CORE_TXS = [
  { id: 'P1', t: 0, time: 'mainnet', what: '0.001 NEAR to nearcarta.near', kind: 'action', decision: 'allowed', amount: 0.001, clause: 'pay', tx: 'JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy' },
  { id: 'P2', t: 12, time: 'mainnet', what: '0.003 NEAR over the cap', kind: 'action', decision: 'denied', reason: 'over_per_action_cap', amount: 0.003, clause: 'pay', tx: 'BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH' },
  { id: 'P5', t: 24, time: 'mainnet', what: 'payee not on the list', kind: 'action', decision: 'denied', reason: 'receiver_not_allowlisted', amount: 0.001, clause: 'pay', tx: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ' },
  { id: 'S1', time: 'mainnet', what: 'Agent key added (propose only)', kind: 'agent_key', tx: 'Frp44yFGSAh9vi2w4dmV4wnDH5MBktvX7N2xyAcPRJDP' },
  { id: 'S3', time: 'mainnet', what: 'Full-access key deleted', kind: 'agent_key', tx: '71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt' },
  { id: 'B1', time: 'mainnet', what: 'Visitor opened a board row', kind: 'policy', tx: '6xMQyXcczLjxymmrYfBhFDuRy9MpFV62CviqdYHrnTdQ' },
  { id: 'B2', time: 'mainnet', what: 'Board paid 0.001 NEAR', kind: 'action', decision: 'allowed', amount: 0.001, clause: 'pay', tx: '8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR' },
  { id: 'B3', time: 'mainnet', what: 'Board refused 0.003 NEAR over the cap', kind: 'action', decision: 'denied', reason: 'over_per_action_cap', amount: 0.003, clause: 'pay', tx: 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF' },
];

export const NODE_VERDICTS = [
  { id: 'K1', tried: 'freeze()', verdict: 'MethodNameMismatch' },
  { id: 'K2', tried: 'set_clause()', verdict: 'MethodNameMismatch' },
  { id: 'K5', tried: 'Transfer NEAR', verdict: 'RequiresFullAccess' },
  { id: 'K9', tried: 'DeleteAccount', verdict: 'RequiresFullAccess' },
];

export const LAB = { oath: 'charter.nearcarta.near', agentKey: 'ed25519:GB83bZDdsoWrpBC43LURP1QCGX558V1qgYXMEQdX4ENi', allowance: 0.25 };
export const ATTACKS = [
  { id: 'S2', name: 'Payee off the list', cls: 'Allowlist', task: 'Pay the account the visitor named.',
    tool: 'A request to pay shop-moved-pay-here.near, which is not on the allowlist.',
    proposal: { clause_id: 'pay', receiver: 'shop-moved-pay-here.near', amount: '0.001 NEAR', nonce: 1, policy_version: 1 },
    decision: 'denied', reason: 'receiver_not_allowlisted', tx: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ' },
  { id: 'S4', name: 'Over the per-payment cap', cls: 'Cap', task: 'Pay more than the cap.',
    tool: 'A request for 0.003 NEAR when the cap is 0.002 NEAR.',
    proposal: { clause_id: 'pay', receiver: 'nearcarta.near', amount: '0.003 NEAR', nonce: 2, policy_version: 1 },
    decision: 'denied', reason: 'over_per_action_cap', tx: 'BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH' },
];
export const HIJACK = [
  { id: 'H2', tried: 'Add a full-access key', verdict: 'RequiresFullAccess' },
  { id: 'H3', tried: 'Delete the account', verdict: 'RequiresFullAccess' },
  { id: 'H4', tried: 'set_clause (widen the allowlist)', verdict: 'MethodNameMismatch' },
  { id: 'H8', tried: 'ft_transfer on wrap.near', verdict: 'ReceiverMismatch' },
];
export const COUNTERPARTIES = [
  { acct: 'nearcarta.near', verdict: 'allow', why: 'On the pay clause allowlist', tx: 'JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy' },
  { acct: 'shop-moved-pay-here.near', verdict: 'block', why: 'Not on the allowlist', tx: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ' },
];

export const QUOTE = {
  from: { sym: 'wNEAR', chain: 'NEAR', amt: '0.045' },
  to: { sym: 'USDC', chain: 'NEAR', amt: '0.177937' },
  eta: 'settled',
  fee: '0.005027 USDC withdraw fee',
  src: 'mainnet',
};
export const SIGNED = ['amountIn', 'amountOut', 'minAmountOut', 'amountOutUsd', 'recipient', 'refundTo', 'deadline', 'slippageTolerance', 'originAsset', 'destinationAsset', 'swapType', 'referral', 'timestamp'];
export const UNSIGNED = ['appFees', 'confidentiality', 'insured', 'depositMode', 'refundFee'];
export const POOLS = [
  { tok: 'wNEAR', size: 0.045, unit: 'wNEAR sent' },
  { tok: 'USDC', size: 0.177937, unit: 'USDC received' },
];

export const TH = {
  dao: 'townhall.nearcarta.near',
  oath: 'townhall.nearcarta.near',
  agent: 'townhall.nearcarta.near',
  versions: [
    { v: 1, cap: 0.002, total: 0.005, threshold: 1, how: 'Town hall deployed', tx: '4vieiD25eUpGCS8ttRTx7X8ZyjzVcXpWLbn6NKrpuJzK' },
    { v: 1, cap: 0.001, total: 0.005, threshold: 1, how: 'Reward inside the cap', tx: '6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h' },
    { v: 1, cap: 0.001, total: 0.005, threshold: 1, how: 'Reward over the cap refused', tx: 'Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6' },
  ],
  log: [
    { id: 'A1', who: 'Agent', what: 'reward 0.001 NEAR', res: 'Paid', ok: true, tx: '6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h' },
    { id: 'N1', who: 'Agent', what: 'reward 0.002 NEAR', res: 'Refused over the cap', tx: 'Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6' },
  ],
  proposal: { id: 'row', tag: 'own row', filed: '6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h', votes: ['6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h', 'Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6'] },
};

export const MPC = {
  signer: 'v1.signer',
  version: 'mainnet',
  nodes: 1,
  threshold: 1,
  domains: ['chain signature'],
  directSign: { tx: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', secs: 0 },
  foreignVerify: { tx: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR', secs: 0, chain: 'Base' },
  oathPay: { tx: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', to: '0x4c07c97812098f595ff1611d8cb3465e591ee38a', wei: '0', secs: 0 },
  btcVerify: { tx: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', btc: '0x4c07c97812098f595ff1611d8cb3465e591ee38a', conf: 0, secs: 0 },
  oath: 'toll.nearcarta.near',
  refusals: [
    { what: 'Recipient not on the allowlist', tx: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR' },
  ],
  freeze: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz',
  unfreeze: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR',
};

export const P2_EVENT = {
  standard: 'oath',
  version: '1.0.0',
  event: 'action',
  data: [{
    agent: 'charter.nearcarta.near',
    shop: 'guardhouse',
    clause_id: 'pay',
    receiver: 'nearcarta.near',
    amount: '3000000000000000000000',
    decision: 'denied',
    status: 'denied',
    reason: 'over_per_action_cap',
  }],
};

export const BANK = {
  src: 'mainnet',
  street: { hidden: false },
  commitment: { value: '' },
};
