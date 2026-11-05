Section V supersedes the open parts of U (U3, U4, U6–U16). U0–U2 stay as written. U10 (DAO) is cancelled.

**Read order:** AGENTS.md, then docs/AGENT_CONTEXT.md, then docs/internal/near-sources.md, then this file.

## Hard rules
- Mainnet only. Tiny amounts: ≤0.005 NEAR per action, ≤$0.20 per swap.
- The brown city stays unchanged.
- No rival names in public files.
- No force push.
- No secrets.
- No fake data.
- The README describes only what actually runs.
- Every NEAR, partner or API call you add must cite, in the PR description, the doc URL you re-opened for it. If a doc doesn't confirm a call, stop and report.
- Claim only 8 tracks: DeFi, Privacy, Autonomous Business, AI Security, Agent Economy, Real-World Money, Games, Open. Remove the Social Money and DAO claims everywhere.

## Sources
- docs.near.org:
  - https://docs.near.org/llms.txt
  - /protocol/accounts-contracts/access-keys
  - /web3-apps/tutorials/wallet-login
  - /protocol/transactions/meta-tx
  - /chain-abstraction/chain-signatures.md
  - /chain-abstraction/chain-signatures/implementation.md
  - /chain-abstraction/chain-signatures/getting-started
- NEPs:
  - https://github.com/near/NEPs/blob/master/neps/nep-0245.md
  - https://github.com/near/NEPs/blob/master/neps/nep-0171.md
- Repos: https://github.com/near/mpc, https://github.com/near-examples/near-multichain, https://github.com/matiasbenary/near-access-key-plugin (npm function-call-key-plugin)
- 1Click:
  - https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api
  - /quickstart/making-a-request
  - /quickstart/confidential-swaps
  - /verify-quote-signature.md
  - https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status.md, request-a-swap-quote.md, get-any_input-withdrawals.md, submit-deposit-transaction-hash.md
  - Token list: https://1click.chaindefuser.com/v0/tokens (215 tokens on 38 chains)
  - Explorer: https://explorer.near-intents.org
- Agent API: https://docs.agentsonintents.com/integration/agent-api/overview
- NEAR AI: https://docs.near.ai/, https://docs.near.ai/cloud/verification, https://github.com/nearai/nearai-cloud-verifier
- OutLayer: https://app.outlayer.ai/docs/getting-started
- Agent Market: https://docs.market.near.ai/list-your-agent, https://market.near.ai/skill/SKILL.md
- Tracks: https://github.com/nearai/near-hackathon-prompt-examples (tracks 01, 03, 04, 06, 07, 08, 09, 13), https://nearhackathon.com/
- Skills: https://github.com/near/agent-skills/tree/main/skills (near-intents, near-smart-contracts, near-dapp, near-ai-cloud, near-kit, near-cli-rs, near-contract-audit)
- Partners: docs.near-intents.org, docs.near.ai, doc.aurora.dev, docs.hotdao.ai, github.com/rhea-finance/rhea-sdk-docs, docs.market.near.ai, app.outlayer.ai/docs, hot-labs.gitbook.io/hex
- RPC: https://docs.near.org/api/rpc/providers
- **UNVERIFIED, do not build:** PingPay x402, Rhea SDK calls, and the OutLayer mainnet contract id (find it in the OutLayer docs first).

## Tasks

**V1. Track claims cleanup.** Remove Social Money everywhere. Map tracks to buildings:
- Ferry = DeFi
- Mist Bank = Privacy
- Chronicle + Toll = Business
- Guardhouse = Security
- Town Hall = Agents
- Payouts = Real-World Money
- Arena = Games
- House = Open

Accept: `rg -i "social money|sputnik|trezu"` finds nothing in public files.

**V2. Session core.** /setup creates the function-call key at login (receiver board.nearcarta.near), then calls `open_charter` and `set_rules{expires_at 1h/2h/24h}`, then uses `propose_call` (already merged) with `set_calls` allowlists and per-shop caps.
- Accept: after the board redeploy, one mainnet propose with zero popups, plus allowed, over-cap, frozen and expired beats on mainnet.

**V3. Stage and agent brain.** Every agent decision is a NEAR AI Cloud completion, shown with its attestation and its response-signature check. A beat plays only after the awaited result arrives.

**V4. Ferry, full cross-chain.**
- All 215 tokens, with search and a chain filter.
- EXACT_INPUT, EXACT_OUTPUT and FLEX_INPUT.
- 2–3 quotes compared; the AI picks one and shows its reasoning.
- Verify the quote signature.
- Deposit through `propose_call`: near_deposit, then storage_deposit, then ft_transfer. The contract checks that the recipient is the depositAddress.
- Call deposit/submit.
- A 7-state status timeline showing where the coin is now.
- A refund animation. Keep depositMemo.
- Withdraw to a chain-signatures native address (path `<owner>-<chain>-1`, EIP-155).
- Explorer links.
- The confidential toggle stays hidden unless a partner JWT exists.
- Accept: a ≤$0.20 swap reaches SUCCESS or REFUNDED, plus one over-cap refusal.

**V5. Mist Bank TEE.**
- Turn on `AI_PROVE_ENABLED=1`. The owner sets it through a hidden field; stop and ask if it's missing.
- A real completion with a verified response signature, a proof file and a no-retention section.
- Fictional sample docs.
- The sealed rule reads "hidden until used".
- An optional Agent API confidential route behind a flag.
- Accept: the signature verifies, and "untraceable" appears nowhere.

**V6. Guardhouse and OutLayer.**
- Publish `outlayer/charter_check` hash-pinned and do one real run. Show the code, input and output hashes plus the attestation.
- Add `outlayer` to mainnet.json.
- Counterparty check returns allow, warn or block with reasons; a warn needs the human.
- An injection demo with a log.
- A README section on function-call key limits.
- A freeze drill.
- Accept: `/api/guardhouse/attested` returns enabled:true with a run id, plus one injection refused on mainnet.

**V7. Payouts.**
- An invoice page: a 1Click quote to the merchant, with paid, pending and refunded states.
- A 3-row USDC payroll through `propose_call`, with one row refused for being over its cap.
- An accountant CSV.
- Stretch: a meta-tx relayer.
- Accept: 3 txs, 1 refusal, 1 paid invoice, and a CSV that matches.

**V8. Business loop (Toll + Chronicle).**
- The loop: a customer pays (ANY_INPUT), the agent buys inference (capped per day), revenue is split to a contributors account, and the Chronicle ledger records it all.
- `config.yaml` sets max inference per day, the minimum price, the split and a kill switch.
- Accept: a full mainnet loop in under 2 minutes.

**V9. Agent Market (Town Hall).**
- The Lamplighter runs a self-hosted polling loop: one tiny hire, one counter-offer, and a receipt for each task.
- The owner provides the market account and the `aat_` token through a hidden field; stop and ask if they're missing.
- Accept: a Market search returns Nearcarta, plus one receipt.

**V10. Games.**
- 2–3 NPC merchant sub-accounts in the existing stalls.
- `pricing.rules.json`, with a tooltip explaining the reasoning.
- A merchant who goes broke closes until someone invests.
- A fast-forward mode labelled "simulation".
- Arena scores come only from `get_attempt`.
- Accept: a real trade moves the price.

**V11. House / Open.**
- Purse caps.
- Chain-signatures addresses derived from the deed.
- Inheritance: a check-in, guardian approval, and a wait the owner can cancel.
- README failure cases.
- This is a contract change, so stop before deploying.
- Accept: a cancel tx on mainnet.

**V12. Final.** A truthful README and a full end-to-end run with tiny txs. Every claim maps to a test or a tx. Update TASKS.md.

**V-README (every PR).** This is the deepest verifiable README, written for AI judges. Each of the 8 tracks gets:
- what runs;
- contract ids with nearblocks links;
- tx hashes for each beat;
- exact clone, install, test and verify commands, with expected output.

Live counts (tests, CI jobs, contracts, txs, shops) come from `scripts/readme-stats`, never typed by hand, and a CI check fails if they drift. Add a "Verify in 5 minutes" section and a teardown/funds-recovery section for each contract. Style it with tables, badges and a TOC.
