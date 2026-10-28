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
  rpcFallbacks: (process.env.NEAR_RPC_FALLBACKS ?? 'https://rpc.testnet.near.org').split(',').map(s => s.trim()).filter(Boolean),
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
