# Security
- No secret is stored in this repo. Keys are read from env only (`ONECLICK_PARTNER_KEY`, `NEARAI_CLOUD_API_KEY`). The agent key file path is given by `AGENT_KEY_FILE`, used only by scripts.
- The HTTP API has no signing route. `/api/ferry/quote` always sends `dry:true` and is rate-limited.
- The NEAR AI agent (`backend/src/agent.js`) only proposes; the on-chain charter allows or refuses. Model output is treated as untrusted text: its signature is checked against a fresh TEE attestation, and it is capped by max tokens, per-guest limits and a daily budget (`AGENT_DAILY_USD`, `AGENT_DAILY_CALLS`). The API key is never logged.
- Every push is scanned with gitleaks.
- Report issues privately to the repository owners.
