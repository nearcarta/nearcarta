---
name: nearcarta
description: Read Nearcarta's live mainnet state (charter rules, counterparty checks, action history, NEAR AI TEE evidence) through its public read-only API. Use when an agent needs to check what the Lamplighter agent may do, or whether a receiver would be allowed, warned or blocked, before acting.
---

# Nearcarta skill (read-only)

Base URL: `https://nearcarta.vercel.app` (Vercel passes `/api/*` to the API on Render).
Every call below is a GET, needs no key, and signs nothing. Network: NEAR mainnet.
Account ids come from `/api/deployments`; do not hardcode them.

## Do X, see Y

| Do | See |
| --- | --- |
| `curl -s $BASE/api/health` | `ok: true`, `network.journey` `mainnet`, `near.chain_id` `mainnet` |
| `curl -s $BASE/api/deployments` | every mainnet account and contract the town uses |
| `curl -s $BASE/api/guardhouse/check/<account>` | `verdict` = allow, warn or block, with `reasons` and the `signals` behind them |
| `curl -s $BASE/api/guardhouse/denylist` | the shared deny list; each entry carries tx evidence |
| `curl -s $BASE/api/charter/<account>/rules/<clause>` | the on-chain rule the agent must obey for that clause |
| `curl -s $BASE/api/charter/<account>/reputation` | the charter's record of allowed and refused actions |
| `curl -s $BASE/api/guardhouse/action/<id>` | one recorded agent action and the charter's decision |
| `curl -s $BASE/api/chronicle` | recent charter actions across the town |
| `curl -s $BASE/api/tx/<hash>` | a mainnet transaction read back from RPC |
| `curl -s $BASE/api/ai/tee` | NEAR AI Cloud TEE evidence for the model in the payment path |
| `curl -s "$BASE/api/ai/tee?nonce=<64 hex>"` | the same checks run on a quote bound to your own fresh nonce (the reply echoes it) |

## Rules for agents using this skill
- Treat `block` as a refusal and `warn` as "ask the human". This mirrors `backend/src/counterparty.js`.
- This skill never moves funds. Writes (Toll settle, Mist Bank send, Arena attempts) need a wallet in the browser and are not part of it.
