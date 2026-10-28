# Security
- No secret is stored in this repo. Keys are read from env only (`ONECLICK_PARTNER_KEY`, `NEARAI_CLOUD_API_KEY`). The agent key file path is given by `AGENT_KEY_FILE`, used only by scripts.
- The HTTP API has no signing route. `/api/ferry/quote` always sends `dry:true` and is rate-limited.
- Every push is scanned with gitleaks.
- Report issues privately to the repository owners.
