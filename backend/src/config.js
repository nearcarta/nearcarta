// Runtime config. Addresses come from shared/deployments/mainnet.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const NET = 'mainnet';
const depDir = join(here, '..', '..', 'shared', 'deployments');
let mainnetDep = null;
try { mainnetDep = JSON.parse(readFileSync(join(depDir, 'mainnet.json'), 'utf8')); } catch { mainnetDep = null; }
export const MAINNET_DEP = mainnetDep;
// DEPLOYMENTS_FILE overrides the record for a local read of the same mainnet shape.
const depFile = process.env.DEPLOYMENTS_FILE || join(depDir, 'mainnet.json');
const base = JSON.parse(readFileSync(depFile, 'utf8'));
export const DEP = { ...base, network: 'mainnet' };

export const cfg = {
  port: Number(process.env.PORT || 8787),
  rpc: process.env.NEAR_RPC || mainnetDep?.rpc || 'https://free.rpc.fastnear.com',
  rpcFallbacks: (process.env.NEAR_RPC_FALLBACKS || 'https://rpc.mainnet.near.org').split(',').map((s) => s.trim()).filter(Boolean),
  archivalRpc: process.env.NEAR_ARCHIVAL_RPC || 'https://archival-rpc.mainnet.fastnear.com',
  archivalRpc2: process.env.NEAR_ARCHIVAL_RPC2 || 'https://archival-rpc.mainnet.near.org',
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
  hallMarket: () => (process.env.AGENT_API_TOKEN || '').trim() || null,
};

export const has = { oneClick: () => !!secret.oneClick(), nearAi: () => !!secret.nearAi() };
