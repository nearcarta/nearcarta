# Town Hall (`hall`) — Agent Economy

**Track:** Agent Economy (track 7). **Not** Social Money. **No** Sputnik DAO / Trezu track claim. Own-row governance only.
**Judges score:** hire/list agents; negotiate; pay; receipt; in-town bounties.
**Read first:** `docs/internal/shops-blueprint.md`.

## What exists today

| Piece | Cite | Gap |
|---|---|---|
| Tray | `hall-ui.js` `mountHall` via `mountShop('hall')` — change own row caps | Not a hire marketplace yet |
| APPS.hall | `set_rules` / freeze / seal style row updates; deposit 0 | Good for own-row story |
| Contract | `contracts/townhall` → `townhall.nearcarta.near` — `post_bounty`, `agent_reward`, … | Still has 1 FAK for teardown (`mainnet.json`) |
| Agent Market | **0** live listing claimed in depth-plan-v2 | **P1 gap:** list Lamplighter + tiny hire |
| Proof | reward `6UxwRmoE…`, refuse `Cp2rWatn…` | Keep |

## Target experience

- Tabs **My row / Jobs / Hire**. Clerk pins jobs; hired agents deliver scrolls; counter-offer speech bubble.
- List Lamplighter on Agent Market (self-hosted poll assignments).
- General-contractor loop: split task, bid/hire, one counter, accept/walk, pay, receipt (`shared/rails/receipts.js`).
- In-town bounties remain on `townhall.nearcarta.near`.

## AI commands

- “Tighten my cap” / “Freeze my row” → board row methods.
- “Post a bounty 0.001” → townhall.
- “Hire an agent for …” → Market API when token present (secret field; do not commit tokens).

## Live data

- https://docs.market.near.ai/list-your-agent (200)
- https://market.near.ai/skill/SKILL.md (200)
- Board `get_charter`; townhall `get_bounties` / `get_state`
- Illia Swarm-for-Hire maps here **with Guardhouse review** — only with real hire proof

## Contract changes

- Prefer Market integration off-chain + existing bounty methods. DAO modules **out of scope**.
- Teardown: delete_account with stored key (document); ideally move to owner `close` pattern later.

## Competitors

Agent Market itself; Countersign/Halter agents track. Beat with: live listing + one paid hire receipt + on-chain bounty allow/refuse. Never claim shared mainnet DAO.

## Sources

1. Agent Market list/hire docs (200).
2. depth-plan-v2 §6; Agent Economy prompt examples.
3. Access keys / session — docs.near.org.
4. Receipts helper `shared/rails/receipts.js`.
5. Ferry pattern + lessons; **drop** any Social Money / Sputnik wording if found in UI.
6. https://docs.agentsonintents.com/integration/agent-api/overview · https://docs.near.ai/
7. Sputnik repo link only as “do not rebuild multisig”: https://github.com/near-daos/sputnik-dao-contract (200) — **not** a track claim.
8. Trezu docs https://github.com/NEAR-DevHub/trezu-docs (200) — same: not our track.

x402 / PingPay: **UNVERIFIED – do not build** unless a page returns 200 and is read this run.

## Acceptance

- [ ] Lamplighter live on Market **or** honest “listing blocked on email/token” with UI ready.
- [ ] One tiny hire + receipt **or** one in-town bounty reward tx + counter-offer log.
- [ ] Own-row set_rules demo from city with no DAO copy.
- [ ] Tests; teardown note; browser shots.
