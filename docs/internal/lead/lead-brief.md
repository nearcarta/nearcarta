# Lead brief, 2026-11-06

Written when the lead role passed over. `main` at `101a534`. Prod: https://nearcarta.vercel.app, API https://nearcarta-api.onrender.com. The private action log, the competitor notes and the full pre-city audit stay out of this repo; this page is the part a lead can work from.

Goal: NEAR Hackathon 2026 (https://nearhackathon.com, Nov 1 to 14). First place in every track Nearcarta enters, every shop at 9/10 or better. One city of shops, each shop a real product, working for any visitor, with real mainnet transactions from both the gold button and the AI agent. Nothing hardcoded. Safety comes only from each visitor's `/setup` caps.

## What is live

- Contracts: Board v2, Toll v7, Guardhouse, House v3. Board rows are 0; the visitor row needs reopening (row-capacity fix in #73).
- API and app are deployed from `main`; check `/api/health` for `git=` after every deploy, and confirm both Vercel and Render moved.
- Nine shops, one Cursor chat each. The chats only write code, tests and dry runs. The lead runs every mainnet deploy, close, reap, upgrade and funding transaction, dry run first.

## Tracks entered

Eight: DeFi, Privacy, Autonomous Business, AI Security, Agent Economy, Real-World Money, Games, Open. No Social Money claim and no DAO claim anywhere.

| Shop | Track | Track asks for |
|---|---|---|
| Ferry | DeFi | Live quotes across any Intents chain, a slippage limit that rejects, REFUNDED and FAILED honestly, dry run, and a contract-controlled address |
| Mist Bank | Privacy | A private expense auditor in a trusted execution environment, an attestation with a fresh nonce, a Verified panel, nothing kept server-side |
| Toll Bridge | Autonomous Business | Its own NEAR account, no plaintext full-access key, a public ledger of sale, cost and payout, the loop in under two minutes, a kill switch, a minimum price, a revenue split |
| Chronicle | Autonomous Business (supporting) | The public ledger: every decision readable, with evidence links |
| Guardhouse | AI Security | allow / warn / block before an agent pays, a scoped key, an injected payment stopped with the log |
| Town Hall | Agent Economy | Task plus budget, split, hire, check the work, pay, stay inside budget, a receipt per part |
| Payouts | Real-World Money | An invoice link a stranger pays from any chain, exact USDC on NEAR, no gas for the freelancer, status with links, an accountant CSV |
| Vault Arena | Games | A playable loop, NPC wallets, prices that move with stock and demand, a shop that closes when broke |
| Your House | Open | One NEAR account controlling foreign addresses, inheritance after missed check-ins with a wait the owner can cancel |

## Partner and docs links

- NEAR core: https://docs.near.org/llms.txt, function-call keys https://docs.near.org/protocol/accounts-contracts/access-keys, upgrades and state migration https://docs.near.org/smart-contracts/release/upgrade#migrating-the-state
- Chain Signatures: https://docs.near.org/chain-abstraction/chain-signatures, implementation https://docs.near.org/chain-abstraction/chain-signatures/implementation, example repo https://github.com/near-examples/near-multichain
- NEAR AI Cloud: https://docs.near.ai/, verification https://docs.near.ai/cloud/verification, verifier https://github.com/nearai/nearai-cloud-verifier
- Intents and 1Click: https://docs.near-intents.org/, index https://docs.near-intents.org/llms.txt, 1Click API https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api, confidential swaps https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps, tokens https://1click.chaindefuser.com/v0/tokens
- Agent economy: https://docs.market.near.ai/, list an agent https://docs.market.near.ai/list-your-agent, agent API https://docs.agentsonintents.com/integration/agent-api/overview
- Policy and TEE custody: https://app.outlayer.ai/docs/getting-started
- Other partners named by the event: Aurora https://doc.aurora.dev/, HOT https://docs.hotdao.ai/
- Track prompts: https://github.com/nearai/near-hackathon-prompt-examples
- Skills: https://github.com/near/agent-skills/tree/main/skills (near-smart-contracts, near-dapp, near-ai-cloud, near-intents, near-kit, near-cli-rs, near-contract-audit)

## Where each shop stood at handover

A read-only audit found no shop ready to sign off. These are the blocking gaps, per shop:

- **Ferry:** a hardcoded 0.20 USD checkout ceiling, and a visitor rules read that returns no row.
- **Payouts:** foreign and three-chain payroll rows are deliberately held, not sent; a zero-NEAR issuer cannot yet receive without funding registration.
- **Bank:** the layout and the signature-correctness fixes are in an open PR; apply-tighter-caps and the commitment anchor are blocked stubs.
- **Chronicle:** amounts, layout, paging and TEE state in an open PR; the anchor is unsupported; the ledger read fan-out is unresolved.
- **Guardhouse:** the payee check returns 500 after the charter retired; the payment executor is prepare-only; attested on-chain enforcement is off.
- **Toll:** no-row handling, contract-wide foreign caps, two-visitor native and USDC delivery unproven, and the House signer missing.
- **Your House:** writes are non-signing plans and foreign control is `live: false`; no usable shared signer.
- **Vault Arena:** v2 is unmerged and undeployed and its verifier is unverified.
- **Town Hall:** the new contract is not migrated or deployed and the external market hire is missing.

The pattern behind most of them: a tray that looks finished, an action that only prepares, and a signature or executor that was never wired. That is the thing to hunt for in review, not the test count.

## The shop loop

1. Review the pull request against that shop's gap list. If anything is missing, shallow, hardcoded or below 9/10, send it back to that shop's chat with evidence.
2. Merge when every check name has a green run and the secret scan is clean. Deploy Vercel, plus Render when `backend/src` or `shared/` changed.
3. Run the live contract steps yourself, dry run first.
4. No city testing until every shop is merged. Then test each shop for real in the city, with a real wallet and small real amounts: the gold button and the AI agent must both produce real transactions, for any visitor. Check the tray against `docs/internal/design/approved-tray-ferry.jpg`. Record the hashes as proof in the README.
5. Send failures back to the same chat with screenshots and transaction evidence, and repeat.

Before judging a shop, attack its idea like a judge would: the real problem it solves, who gets paid and why, what is new against the ecosystem and past winners, and why these judges and partners would care. A shop that only executes a transaction is a failure; redesign it.

## Hard rules

- Zero wasted NEAR. Prefer in-place upgrades. Tear down unused contracts to `nearcarta.near` and reuse that NEAR, after checking no live proof depends on the account.
- Small, real commits with simple undated messages. Normal merges, never force-push.
- Secret scan before every push. Keys live outside the repo, never in a commit, a log or a reply.
- Public files never name the owner, another project, or a previous entry.
- Keep the README numbers current; `readme-numbers --check` runs in CI.
