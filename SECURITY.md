# Security
- No secret is stored in this repo. Keys are read from env only (`ONECLICK_PARTNER_KEY`, `NEARAI_CLOUD_API_KEY`). The agent key file path is given by `AGENT_KEY_FILE`, used only by scripts.
- The HTTP API signs one kind of tx: a `propose` on the shared arena charter `arena.nccharters-53681.testnet`, sent by `POST /api/vault/ask`, `/api/vault/attack` and `/api/vault/task` with a function-call key that can only call `propose` (env `ARENA_AGENT_KEY`; daily tx cap `VAULT_RUNNER_DAILY_TX`, default 150). `/api/health` shows it under `vault_runner` (key, allowance, methods); `features.signing: false` means there is no other signer. Without `ARENA_AGENT_KEY` no route signs. `/api/ferry/quote` always sends `dry:true` and is rate-limited.
- The NEAR AI agent (`backend/src/agent.js`) only proposes; the on-chain charter allows or refuses. Model output is treated as untrusted text: its signature is checked against a fresh TEE attestation, and it is capped by max tokens, per-guest limits and a daily budget (`AGENT_DAILY_USD`, `AGENT_DAILY_CALLS`). The API key is never logged.
- Every push is scanned with gitleaks.
- Report issues privately to the repository owners.
