// Runtime config. Addresses come from shared/deployments/testnet.json; secrets only from env.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const depPath = process.env.DEPLOYMENTS_FILE || join(here, '..', '..', 'shared', 'deployments', 'testnet.json');
export const DEP = JSON.parse(readFileSync(depPath, 'utf8'));

export const cfg = {
  port: Number(process.env.PORT || 8787),
  rpc: process.env.NEAR_RPC || DEP.rpc,
  // Tried in order when the main testnet RPC answers 429/5xx or is unreachable (free RPCs rate-limit shared host IPs).
  rpcFallbacks: (process.env.NEAR_RPC_FALLBACKS || (DEP.rpc_fallbacks || []).join(',')).split(',').map((s) => s.trim()).filter(Boolean),
  // Tx status for anything older than ~2.5 days lives only on archival nodes (others answer NOT_OBSERVED/timeout).
  archivalRpc: process.env.NEAR_ARCHIVAL_RPC || DEP.archival_rpc || 'https://archival-rpc.testnet.fastnear.com',
  // Second archival node, used when the first rate-limits (Render egress IPs are shared and see 429s).
  archivalRpc2: process.env.NEAR_ARCHIVAL_RPC2 || 'https://archival-rpc.testnet.near.org',
  rpcRetries: Number(process.env.NEAR_RPC_RETRIES || 4),
  rpcBackoffMs: Number(process.env.NEAR_RPC_BACKOFF_MS || 400),
  rpcBackoffMaxMs: Number(process.env.NEAR_RPC_BACKOFF_MAX_MS || 4000),
  rpcTimeoutMs: Number(process.env.NEAR_RPC_TIMEOUT_MS || 8000),
  rpcCacheMs: Number(process.env.NEAR_RPC_CACHE_MS || 5000),
  rpcStaleMs: Number(process.env.NEAR_RPC_STALE_MS || 10 * 60 * 1000),
  // mainnet RPC is used only for free view calls (intents.near simulate / token reads). Never for signing.
  mainnetRpc: process.env.NEAR_MAINNET_RPC || 'https://free.rpc.fastnear.com',
  oneClick: process.env.ONECLICK_URL || DEP.ferry.oneclick,
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
