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
