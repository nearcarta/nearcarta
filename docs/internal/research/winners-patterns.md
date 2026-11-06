# Past NEAR hackathon winners: patterns (no project names)

Summary of a public-record search of past NEAR hackathon winners. Project names stay in the private research; here only the shapes.

| # | Pattern | Evidence | What it means for a shop |
|---|---|---|---|
| P1 | One NEAR account controls money on other chains (Chain Signatures + Intents). No bridge, no second wallet | Strongest. Won in 3 recent events (an agent sending BTC from a NEAR account; a swap extending to BTC/EVM with chain signatures + a TEE agent) | Toll, House: the visitor's NEAR row must move real value on Base/ETH/BTC |
| P2 | Verifiable private agents: TEE + Chain Signatures (Shade Agents) doing something a normal bot cannot prove | Strong, 2025 | Bank, Guard, Arena: show the attestation and tie it to an on-chain decision |
| P3 | Real-world money with a named payer and payee and a verifiable on-chain leg | Moderate, durable | Payouts: a real invoice paid by a stranger from any chain |
| P4 | Infra other NEAR apps can plug into, not a standalone app | Moderate | Guard as a firewall any agent can call; Chronicle as a statement any account can get |
| P5 | Tooling that makes building on NEAR easier | Moderate | Skills / MCP listing of each shop's agent |
| P6 | Games/NFTs win only when the economy is on chain and playable | Weak-moderate | Arena: real pot, real players, real refusals; no static price tables |

## The "distinctive NEAR capability" test (every shop must pass at least one)
1. One account, many chains, no bridge (Chain Signatures). If you delete NEAR, does the user need a second wallet and a bridge?
2. An agent holding money without anyone holding its key (TEE + MPC).
3. Permissioned delegation without giving away the account (function-call keys, the board session).
4. Enforced release of money by rules (escrow, inheritance, schedule).
5. Named human-readable accounts and sub-accounts as product surface.
6. Intent-based execution with solver competition (1Click).

**Anti-test:** a dApp that could run on any EVM chain with NEAR swapped in as the RPC; a chatbot that reads balances but signs nothing; a payment to our own contract that buys nothing.
