// Runtime config. Addresses come from shared/deployments/<network>.json, chosen by NEAR_NETWORK.
// Unset means mainnet, and every default mainnet value stays exactly what it was, so one image can
// run as the mainnet service or as the testnet service without a second code path.
// Docs: https://docs.near.org/api/rpc/providers · https://docs.near.org/tools/cli
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkFrom, loadDep } from '../../shared/deployments/net.js';

const here = dirname(fileURLToPath(import.meta.url));
export const NET = networkFrom();
const depDir = join(here, '..', '..', 'shared', 'deployments');
let mainnetDep = null;
try { mainnetDep = JSON.parse(readFileSync(join(depDir, 'mainnet.json'), 'utf8')); } catch { mainnetDep = null; }
export const MAINNET_DEP = mainnetDep;
// DEPLOYMENTS_FILE overrides the record for a local read of the same network shape.
const base = loadDep(NET, process.env.DEPLOYMENTS_FILE);
export const DEP = { ...base, network: NET };

// Per-network RPC defaults. The mainnet values are the ones this file always had.
const NET_RPC = {
  mainnet: {
    rpc: mainnetDep?.rpc || 'https://free.rpc.fastnear.com',
    fallbacks: 'https://rpc.mainnet.near.org',
    archival: 'https://archival-rpc.mainnet.fastnear.com',
    archival2: 'https://archival-rpc.mainnet.near.org',
    fastnearTx: 'https://tx.main.fastnear.com',
    explorerApi: 'https://api.nearblocks.io',
  },
  testnet: {
    rpc: 'https://rpc.testnet.fastnear.com',
    fallbacks: 'https://rpc.testnet.near.org,https://near-testnet.drpc.org',
    archival: 'https://archival-rpc.testnet.fastnear.com',
    archival2: '',
    fastnearTx: 'https://tx.test.fastnear.com',
    explorerApi: 'https://api-testnet.nearblocks.io',
  },
}[NET];

export const cfg = {
  port: Number(process.env.PORT || 8787),
  net: NET,
  rpc: process.env.NEAR_RPC || NET_RPC.rpc,
  rpcFallbacks: (process.env.NEAR_RPC_FALLBACKS || NET_RPC.fallbacks).split(',').map((s) => s.trim()).filter(Boolean),
  archivalRpc: process.env.NEAR_ARCHIVAL_RPC || NET_RPC.archival,
  archivalRpc2: process.env.NEAR_ARCHIVAL_RPC2 ?? NET_RPC.archival2,
  // The public tx index for the chosen network. Testnet's nearblocks API is v3 (v1 was retired).
  fastnearTx: process.env.FASTNEAR_TX_API || NET_RPC.fastnearTx,
  explorerApi: process.env.NEARBLOCKS_API || NET_RPC.explorerApi,
  // Testnet's nearblocks API is v3 only (v1 answered 410 after 2026-11-05). Mainnet still answers v1.
  // NEARBLOCKS_API_V3=1 forces v3 on either network, so the adapter is exercised on both.
  explorerApiV3: process.env.NEARBLOCKS_API_V3 ? process.env.NEARBLOCKS_API_V3 === '1' : NET === 'testnet',
  explorer: process.env.NEAR_EXPLORER || DEP.explorer || (NET === 'testnet' ? 'https://testnet.nearblocks.io' : 'https://nearblocks.io'),
  rpcRetries: Number(process.env.NEAR_RPC_RETRIES || 4),
  rpcBackoffMs: Number(process.env.NEAR_RPC_BACKOFF_MS || 400),
  rpcBackoffMaxMs: Number(process.env.NEAR_RPC_BACKOFF_MAX_MS || 4000),
  rpcTimeoutMs: Number(process.env.NEAR_RPC_TIMEOUT_MS || 8000),
  rpcCacheMs: Number(process.env.NEAR_RPC_CACHE_MS || 5000),
  rpcStaleMs: Number(process.env.NEAR_RPC_STALE_MS || 10 * 60 * 1000),
  // mainnet RPC is used only for free view calls (intents.near simulate / token reads). Never for signing.
  // It stays mainnet on both services: NEAR Intents has no testnet.
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
