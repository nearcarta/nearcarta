// Runtime config. Addresses come from shared/deployments/<NET>.json (mainnet by default).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// NEAR_NET=testnet is the only way off mainnet. Unset means mainnet.
export const NET = process.env.NEAR_NET === 'testnet' ? 'testnet' : 'mainnet';
const depDir = join(here, '..', '..', 'shared', 'deployments');
// The mainnet core (charter + toll) record, read-only; always served at /api/mainnet.
let mainnetDep = null;
try { mainnetDep = JSON.parse(readFileSync(join(depDir, 'mainnet.json'), 'utf8')); } catch { mainnetDep = null; }
export const MAINNET_DEP = mainnetDep;
let testnetDep = null;
try { testnetDep = JSON.parse(readFileSync(join(depDir, 'testnet.json'), 'utf8')); } catch { testnetDep = null; }
export const TESTNET_DEP = testnetDep;
// Default file follows NET. DEPLOYMENTS_FILE overrides for local trials only.
const depFile = process.env.DEPLOYMENTS_FILE || join(depDir, `${NET}.json`);
const base = JSON.parse(readFileSync(depFile, 'utf8'));
// When a trial file is loaded under NET=mainnet, overlay the committed mainnet ids.
const overlay = NET === 'mainnet' && mainnetDep && mainnetDep.status === 'deployed' && base.network !== 'mainnet'
  ? Object.fromEntries(Object.entries(mainnetDep).filter(([k, v]) => v !== null && k !== 'toll' && k !== 'rpc')) : {};
export const DEP = { ...base, ...overlay, network: NET };

export const cfg = {
  port: Number(process.env.PORT || 8787),
  rpc: process.env.NEAR_RPC || (NET === 'mainnet' ? (mainnetDep?.rpc || 'https://free.rpc.fastnear.com') : DEP.rpc),
  rpcFallbacks: (process.env.NEAR_RPC_FALLBACKS || (NET === 'mainnet' ? 'https://rpc.mainnet.near.org' : (DEP.rpc_fallbacks || []).join(','))).split(',').map((s) => s.trim()).filter(u => u && (NET !== 'mainnet' || !/testnet/i.test(u))),
  archivalRpc: process.env.NEAR_ARCHIVAL_RPC || (NET === 'mainnet' ? 'https://archival-rpc.mainnet.fastnear.com' : (DEP.archival_rpc || '')),
  archivalRpc2: process.env.NEAR_ARCHIVAL_RPC2 || (NET === 'mainnet' ? 'https://archival-rpc.mainnet.near.org' : ''),
  rpcRetries: Number(process.env.NEAR_RPC_RETRIES || 4),
  rpcBackoffMs: Number(process.env.NEAR_RPC_BACKOFF_MS || 400),
  rpcBackoffMaxMs: Number(process.env.NEAR_RPC_BACKOFF_MAX_MS || 4000),
  rpcTimeoutMs: Number(process.env.NEAR_RPC_TIMEOUT_MS || 8000),
  rpcCacheMs: Number(process.env.NEAR_RPC_CACHE_MS || 5000),
  rpcStaleMs: Number(process.env.NEAR_RPC_STALE_MS || 10 * 60 * 1000),
  // mainnet RPC is used only for free view calls (intents.near simulate / token reads). Never for signing.
  mainnetRpc: process.env.NEAR_MAINNET_RPC || 'https://free.rpc.fastnear.com',
  oneClick: process.env.ONECLICK_URL || DEP.ferry?.oneclick || 'https://1click.chaindefuser.com',
  nearAi: process.env.NEARAI_URL || 'https://cloud-api.near.ai',
  nearAiModel: process.env.NEARAI_MODEL || 'z-ai/glm-5.3-flash',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

// Secrets are read lazily and never logged or returned.
export const secret = {
  oneClick: () => (process.env.ONECLICK_PARTNER_KEY || '').trim() || null,
  nearAi: () => (process.env.NEARAI_CLOUD_API_KEY || '').trim() || null,
};

export const has = { oneClick: () => !!secret.oneClick(), nearAi: () => !!secret.nearAi() };
