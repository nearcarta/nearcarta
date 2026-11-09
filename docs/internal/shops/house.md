# Your House (`house`) — Open Innovation

**Track:** Open Innovation (track 13). Inheritance / deed-as-account pattern.
**Judges score:** NEP-171 deed controls purse with allow/refuse; chain-sig derived addresses; guardian release with cancel window (if claimed).
**Read first:** `docs/internal/shops-blueprint.md`.

## What exists today

| Piece | Cite | Gap |
|---|---|---|
| Tray | `deep.js` `mountHouse` L903–958 — reads board row via `/api/board/row/:id`; deed markup | **Thin:** mostly charter row read, not full purse UX |
| Contract | `contracts/house_nft` → `house.nearcarta.near` — `house_fund`, `house_pay`, `house_lower_cap`, `close` | Inheritance / guardian release **not** built (needs owner OK) |
| Deed helpers | `app/src/panels/deed.js`, `app/house/` | Privy login exists |
| Proof | allow `83nyJmTW…`, refuse `3Z4UAb6N…` | Keep; add inheritance proofs when built |

## Target experience

- Tabs **Deed / Purse / Guardians**. AI: “Pay 0.001 from the house”, “Show my ETH derived address”, “Check in”.
- Deed NFT owns purse; pay under cap; refuse over cap on chain.
- Derive chain-sig paths `<owner>-eth-1` / `-btc-1` (docs).
- Inheritance mode (contract change): check-in window; missed → guardians; waiting period cancellable by owner; README failure cases.

## AI commands

- “Pay 0.001 NEAR from my deed” under house_pay rules (1 yocto owner path may still need wallet — **be honest**; session key cannot attach deposit).
- “Show derived addresses”.
- “Check in” when inheritance exists.

## Live data

- House contract views; board row for agent rules.
- NEP-171: https://github.com/near/NEPs/blob/master/neps/nep-0171.md (200).
- Chain signatures: https://docs.near.org/chain-abstraction/chain-signatures/implementation (200).

## Contract changes

- Inheritance = **contract change** → owner OK, state backup, first mainnet call ≤0.001 NEAR.
- Teardown: `close()` refuses while purse &gt; 0; then owner close 1 yocto.

## Competitors

Kept in private notes on the box, not in this repo.

## Sources

1. NEP-171 + house_nft source.
2. depth-plan-v2 §8; Open Innovation track prompt.
3. Chain signatures + https://github.com/near/mpc
4. Ferry pattern (city tray, AI dock) adapted to deed metaphor.
5. https://docs.near.org/llms.txt · agent-skills repo

## Acceptance

- [ ] Purse allow + refuse txs linked (existing OK if re-verified).
- [ ] If inheritance ships: pending release cancelled on mainnet with minute-scale timers.
- [ ] City browser; tests; teardown documented.
