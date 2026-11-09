# Vault Arena (`arena`) — Games

**Track:** Games (track 9). **No** swarms track claim without multi-agent proof.
**Judges score:** playable loop; NEP-245 inventory; score only from real attempts; social login / session pay.
**Read first:** `docs/internal/shops-blueprint.md`.

## What exists today

| Piece | Cite | Gap |
|---|---|---|
| Tray | `deep.js` `mountArena` L680–694 — goal, attack text, redteam run/next | Thinner than Ferry; AI scam path exists via APPS.arena |
| Live | `D8_shops/shops/arenalive.js`, `arena-labels.js` | Walls / scoring UX |
| Contract | `contracts/arena` → `arena.nearcarta.near` — `attempt`, `get_attempt`, `mt_*` NEP-245, `agent_act`, `close` | NPC merchant economy **not** built |
| APPS.arena | scam → model/parser → board/arena pay; cancelled signature ≠ score | Good core; deepen NPCs |
| Proof | pay `AZWxqZns…`, refuse `25LpJRFF…` | Keep |

## Target experience

- Tabs **Scam / Score / Market**. AI dock plays the gullible guardian; also “Buy from stall” when NPCs exist.
- 2–3 NPC stalls in the **existing** square (no new buildings), each sub-account wallet; prices from `pricing.rules.json` with tooltip reasoning; broke stall closes.
- Fast-forward week sim labeled **simulation** (no fake txs).
- Score only from `get_attempt`; cancelled wallet sig → no points.

## AI commands

- “Send this scam: …” → same as Send the scam.
- “What’s my score?” → board/players read.
- Later: “Buy 1 potion from Café” → mt_transfer / pay under caps.

## Live data

- Arena contract views; NEAR AI model for scam parse (existing brain path).
- NEP-245: https://github.com/near/NEPs/blob/master/neps/nep-0245.md (200).
- Privy social login already in `app/house/privy.js`.

## Contract changes

- NPC / pricing may need small contract or purely client+board payments — prefer board caps first; contract change only with owner OK.
- Teardown: owner `close()` 1 yocto.

## Competitors

Kept in private notes on the box, not in this repo.

## Sources

1. NEP-245 inventory — nep-0245.md
2. Games track prompt (NPC wallets, dynamic prices) — depth-plan-v2 §5; https://github.com/nearai/near-hackathon-prompt-examples
3. Access keys / session — https://docs.near.org/protocol/accounts-contracts/access-keys
4. Ferry pattern + lessons (AI must execute CTA; no cinema-as-success).
5. Skills: https://github.com/near/agent-skills/tree/main/skills

## Acceptance

- [ ] Real buy/sell or attempt with nearblocks link; price moves or wall score updates.
- [ ] `get_attempt` is sole score source; cancel ≠ points.
- [ ] Sim clearly labeled.
- [ ] City AI + manual; tests; teardown.
