# Section U (Nearcarta depth pass)
Read in this order: AGENTS.md, then docs/AGENT_CONTEXT.md, then docs/internal/near-sources.md, then this list. One item per small commit. Run each item's acceptance test before moving on.

## Hard rules
If you would break one, stop and report.
1. Mainnet only. Amounts stay tiny: ≤0.005 NEAR per action, ≤$0.20 per 1Click swap, ≤0.05 NEAR per test session.
2. The brown/brass low-poly city stays exactly as is. Add characters and beats inside it; no restyle.
3. No competitor names in any public file, UI, README, commit or PR. Internal comparisons stay in docs/internal/.
4. Small commits. No force push, no history rewrite, no amending pushed commits.
5. No secrets anywhere. No private keys in the API. The agent key lives only in the browser or the TEE.
6. No fake data. Every number on screen comes from a live RPC or API call, or is labelled "example".
7. The README describes only what actually runs. Claude Code and Codex screen the entries.
8. Before any NEAR API call, re-check the official page. DelegateV2 was removed in protocol 87.
9. Never deploy over a live contract without green tests, a migration plan and a state dump.

## U0: docs/internal/near-sources.md (verified 5 Nov 2026; re-fetch before relying on it)

### Keys
- Access keys: https://docs.near.org/protocol/accounts-contracts/access-keys
  - A FunctionCall key has one receiver_id and optional method_names.
  - Its allowance pays gas only. It cannot attach a deposit and never expires.
- Gas keys: https://docs.near.org/protocol/accounts-contracts/gas-keys
- Meta tx (NEP-366): https://docs.near.org/web3-apps/tutorials/meta-transactions
  - Expiry is per action (max_block_height), not per session.
- Wallet login: https://docs.near.org/web3-apps/tutorials/wallet-login (@hot-labs/near-connect 0.12.x)
- Login FC-key plugin: npm `function-call-key-plugin` 2.2.0
  - Source: github.com/matiasbenary/near-access-key-plugin
  - Example: github.com/near-examples/hello-near-examples
- Legacy: github.com/near/wallet-selector

### Router: board.nearcarta.near (contracts/charter_board)
- `propose(owner, receiver, amount, signature, reveal)` checks, in order:
  - ed25519_verify over proposal_message(owner, receiver, amount, nonce) against row.agent;
  - frozen;
  - rules.expires_at ("clause_expired");
  - receiver allowlist, min, window, per_action_cap, daily_budget, max_actions_per_day, seal.
- On success it does a native Transfer, with an on_paid refund if that fails.
- A session is set_agent(pk) + set_rules{expires_at}.
- There is no propose_batch, and propose only moves native NEAR.

### Chain Signatures
- https://docs.near.org/chain-abstraction/chain-signatures.md and https://docs.near.org/chain-abstraction/chain-signatures/implementation.md
- MPC on mainnet is `v1.signer`. The call is `sign{request:{path, payload_v2, domain_id}}`, with domain 0 = Secp256k1 and 1 = Ed25519.
- The derived address depends on the predecessor account plus the path. A contract derives from its own account, so put the owner id in the path.
- Use a distinct path per chain. EVM transactions must use EIP-155.
- Live read: `near contract call-function as-read-only v1.signer state json-args {} network-config mainnet now`
- Libraries: chainsig.js and Omni Transaction.
- Repos: github.com/near-examples/near-multichain and github.com/near/mpc
- toll.nearcarta.near uses sign (domain 0) and verify_foreign_transaction (domain 3; cite near/mpc).

### 1Click
- Quickstart: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
- Flow:
  1. GET /v0/tokens
  2. POST /v0/quote with dry:false (dry:true returns no deposit address)
  3. Deposit to depositAddress, plus depositMemo if given
  4. Optionally POST /v0/deposit/submit
  5. Poll GET /v0/status?depositAddress=
- States: PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, SUCCESS, INCOMPLETE_DEPOSIT, REFUNDED, FAILED.
- A JWT bearer avoids the +0.25% fee.
- Explorer: https://explorer.near-intents.org
- Paying in NEAR: wrap.near near_deposit, then storage_deposit, then ft_transfer to the deposit address.
- SDK: @defuse-protocol/one-click-sdk-typescript

### Privacy
- Confidential swaps: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps
  - B2B only. Needs a partner JWT plus a user-session token, and is funded by user-signed intents, so it sits outside the board caps.
  - Allowed claim: "deposits and withdrawals cannot be tracked to each other". Never say "untraceable".
- TEE verify: github.com/nearai/nearai-cloud-verifier
- Our seal is hidden until used. The reveal goes on-chain in the propose args.

### Hackathon
- Dev ends 14 Nov 23:59 UTC.
- Submit a public repo and an X post tagging @NEARProtocol with #NEARHackathon.
- Social Money entries must build on Sputnik DAO/Trezu.

## Repos to read
near/mpc, near-examples/near-multichain, near-examples/chainsig-script, near-examples/hello-near-examples, near-examples/cross-contract-calls, near-examples/yield-resume, near-examples/near-intents-examples, defuse-protocol/one-click-sdk-typescript, defuse-protocol/sdk-monorepo, near/intents, near/near-sdk-rs, near/near-api-js, near/agent-skills, NearDeFi/agent-payments-skill, NearDeFi/shade-agent-framework, nearai/nearai-cloud-verifier, nearai/private-ml-sdk, matiasbenary/near-access-key-plugin, sputnik-dao contracts.

Docs MCPs: near-docs, near-intents-docs, near-ai-docs. In repo: skills/nearcarta/SKILL.md, shared/deployments/mainnet.json, contracts/*, docs/MAINNET_*.md.

## Tasks
Do U4 before U2.

**U1. Global bugs.** Fix the false "something did not load", the stale balance after a tx, and the setup summary that names charter instead of board.
- Accept: a tiny open_charter shows board.nearcarta.near in the summary, the balance refreshes within 5s, and no error banner appears.

**U2. Agent key at sign-in.** Use function-call-key-plugin 2.2.0 on near-connect. The key's receiver is the board, its methods are propose (plus propose_call after U4), and its allowance is 0.05. Pass the same pk to set_agent.
- Accept: after one popup, a propose lands on nearblocks signed by the agent pk, with zero further popups, and no key appears in the API logs.

**U3. /setup session.** One review screen covering:
- duration (1h, 2h or 24h), which sets set_rules{expires_at};
- budget, plus per-tx, daily and per-shop caps;
- privacy mode: Public, Sealed rules, or Confidential (only if a partner JWT is present).
- Accept: a 2-minute session fails with clause_expired on mainnet after it ends, the UI shows an "expired" chip, and Renew costs one popup.

**U4. Board vNext.** Add `propose_call{owner, receiver, method, args, deposit, signature}`. The signed message includes the method and sha256(args). Add:
- a (receiver, method) allowlist;
- per-shop and session caps;
- a callback refund.

Keep the propose ABI unchanged and migrate existing rows.
- Accept: cargo tests cover allowed, wrong pk, replayed nonce, not allowlisted, over the per-shop cap, over the session cap, expired, frozen, and callback refund.
- Deploy only after the owner's OK. The first mainnet call is ≤0.001.

**U5. Stage engine.** A character rig and a beat queue bound to awaited RPC results, with receipt chips that link to nearblocks.
- Accept: no beat plays before its tx is final, and a cancelled signature plays a refuse beat.

**U6. Ferry.** Run the real loop:
1. tokens;
2. quote(dry:false);
3. deposit via propose_call (near_deposit, storage_deposit, ft_transfer);
4. deposit/submit;
5. poll all 7 states;
6. show any refund.
- Accept: one ≤$0.20 swap reaches SUCCESS or REFUNDED on mainnet with links, and an over-cap attempt is refused on-chain.

**U7. Toll.** Gate the animation on on_signed/check_visit, and use pay_for.
- Accept: pay leads to an MPC signature, check_visit passes, and the bar lifts only after the tx is final.

**U8. Payouts.** Send 3 real rows. The row over the cap is refused; the others are paid.
- Accept: 3 txs on nearblocks plus one refusal with its reason.

**U9. Mist Bank.** Run the 8 TEE checks live, with a downloadable proof. Add a sealed rule worded "hidden until used". No private-payment claim.
- Accept: the proof verifies with the verifier steps.

**U10. Town Hall.** Use a real Sputnik DAO: the agent proposes within its cap, plus a timelock hourglass and a freeze bell.
- Accept: one DAO proposal tx is linked in the UI.

**U11. Guardhouse.** Each rule lamp lights from the real contract error string, plus a freeze drill.

**U12. House.** Fund, pay, lower the cap, refuse, then close with a refund.

**U13. Chronicle.** Live entries from receipts, sealed entries, and JSON export.

**U14. Arena.** Scores come only from get_attempt; a cancelled signature scores nothing. Add a season reveal, with the fight animation last.

**U15. Chain-sig native address (stretch).** Path `<owner>-<chain>-1`, with EIP-155.

**U16. README and full e2e.** Every claim maps to a test or a tx.

## The 10/10 bar for every shop
1. A real mainnet tx for each beat.
2. Allowed, refused, frozen and expired beats, each enforced on-chain.
3. No popups after setup.
4. Privacy modes that are visible and match the docs.
5. Animation tied to the awaited result.
6. No fake numbers.
7. The city unchanged.
8. A README section plus a test.
9. Loads in under 3s with no console errors.
10. Uses its track's tech: Ferry Intents + chain sig, Bank TEE, Toll chain sig, Hall Sputnik, Arena NEP-245, Guard FC keys + policy, Payouts stablecoins, House NFT account, Chronicle transparency.

## Owner notes
(a) Order: U4 before U2. Start the login key with `propose` only, then add `propose_call` after U4.
(b) Write acceptance tests for U11–U15 too: real on-chain error strings, purse refund on close, a live receipt feed, scores only from get_attempt, and a derived address that matches the MPC derivation.
(c) Before U7 and U15, live-read `v1.signer` on mainnet. Confirm the sign deposit (1 yocto vs 0.1 NEAR) and whether domain 3 is live. Record both in near-sources.md.
(d) The owner pre-approves needed mainnet contract deploys, but only after cargo tests are green, a state view dump is saved, a migration is tested against a copy of the live state, and the existing propose ABI and rows still work. Then deploy and make a first call of ≤0.001 NEAR. Never redeploy a contract without migration if state would break. Never touch funds beyond tiny test amounts. Report the tx hashes.
(e) Shared depth layer: /setup sets funding, session duration, caps, policy and privacy once with one wallet signature. After that the character spends inside shops with no popups, within those limits. Each shop shows allowed, refused, frozen and expired beats, and the character visibly performs each action.
