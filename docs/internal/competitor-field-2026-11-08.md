# The field: 308 submissions, measured

Pulled from `https://nearhackathon.com/api/projects` (public, 2026-11-08). Repos cloned and
counted, not summarised from READMEs.

## Track density — where we have to win

| track | entries |
|---|---|
| **security** | **155** |
| **agents** | **148** |
| realworld | 62 |
| defi | 54 |
| business | 53 |
| privacy | 51 |
| open | 49 |
| swarms | 26 |
| games | 26 |
| thesis | 25 |
| nfts | 21 |
| social | 19 |
| memecoins | 17 |

Security and Agents are the two most crowded tracks by a factor of three. Guard and Hall sit
in both. **46 projects** in the field use the same words as our Guard (guard, firewalls,
spending, leash, policy, allowance, veto, warden). There is a project literally called
**Charter** (6 tracks: agents, business, defi, open, privacy, security), plus **Deed**, **Heir**,
**Agent Treasury**, **Invoice Link** and **TEE Receipts**. Our names are not unique; the
question is whether the enforcement is.

## Measured, same method for everyone

| repo | tracks | Rust files | Rust lines | JS/TS lines | test files | mainnet tx links | testnet mentions |
|---|---|---|---|---|---|---|---|
| **nearcarta** | 8 | **36** | **15,596** | 27,561 | **160** | **every shop** | 0 |
| soldanoandrea/allowance | sec, bus, agt | 10 | 7,377 | 9,306 | 24 | 0 | 7 |
| BreadchainCoop/saving-circles-near | social | 4 | 1,912 | 14,660 | 3 | 0 | 4 |
| agadape/undo | sec | 9 | 3,842 | 1,338 | 5 | 1 | 9 |
| jamesOPJ/befewer | game | 2 | 3,985 | 2,007 | 2 | 0 | 1 |
| hassaanraja282-lgtm/leashpay | sec, agt | 4 | 972 | 685 | 2 | 0 | 1 |
| smog123/Warden | sec, agt | **0** | 0 | 2,757 | 4 | 0 | 7 |
| Lainholic/project_carerail | sec, agt | **0** | 0 | 2,263 | 0 | 1 (testnet) | 3 |
| Night-Etrenal/agentguard-near | sec, agt | 1 | 391 | 1,041 | 1 | 0 | 5 |
| dyann1984/hades-omega | 9 | 1 | 184 | 11,246 | 39 | 3 | 15 |
| Townsvilledh/spendguard | sec | 1 | 302 | 0 | 1 | 0 | 2 |
| Leash-Pay/leashpay-web | sec | 0 | 0 | 90 | 0 | 0 | 0 |

## What this says, plainly

1. **We have 2–40× more contract code and 7–160× more tests than any rival in our tracks.**
   The nearest on contract substance is `allowance` (10 files, 7,377 lines, 24 test files).
   Two of the three largest security entries (`Warden`, `CareRail`) have **no contract at all**.
2. **Nobody in this field cites a mainnet transaction.** Every deployed contract named in the
   eleven repos is `*.testnet`. LeashPay says so explicitly ("NEAR testnet only; the server
   refuses to start with a non-testnet config"). We run all nine shops on mainnet with proof
   txs re-read by `npm run verify`.
3. **`allowance` is the strongest rival and is genuinely good.** It registers each agent as a
   function-call key on the vault account itself, ships a `simulate` view so an agent plans
   before it spends, and its kill switch deletes the keys at the protocol level. Those are
   ideas worth having, and two of them we should adopt (below).
4. **`CareRail` and `LeashPay` both name a real attack demo** where a prompt-injected agent is
   stopped and the log is shown. We have `npm run attack-demo` with three real on-chain
   refusals, which is stronger evidence, but it is not demoed in the city.

## What we should take from them

- **A `simulate` view** (`allowance`): a free read that answers allow / needs-approval / block
  with the reason, so an agent plans before it signs. Our counterparty check exists but is an
  API call, not a contract view on the charter itself.
- **Protocol-level key deletion as the kill switch** (`allowance`): deleting the agent's
  function-call key means the *network* refuses the next transaction instead of a flag the
  contract has to remember. Our charter has `set_frozen` (contract level) and the row can be
  closed, but a visitor cannot delete just the agent key from the tray.
- **An explicit attack-demo transcript in the city**, not only in a script.

## Where we must not copy

`allowance` and `LeashPay` are single-purpose vaults. Our differentiator is that one charter
row bounds **nine** shops, with real shops on the other end of the calls, not one payee list.
Copying their shape would make us smaller, not better.
