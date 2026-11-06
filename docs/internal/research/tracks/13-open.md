# 13. Open Innovation

**Track id:** `open` · **Tagline:** Something we haven't seen

Bring the idea that refuses to fit a category: new ways for money, intelligence and ownership to work together. You can enter this track alongside any other, since the submission form lets you pick every track your project fits.

**Lean on:** Experimental, chain abstraction, build your own

## Start here

- [Chain Signatures getting started](https://docs.near.org/chain-abstraction/chain-signatures/getting-started)
- [NEAR docs](https://docs.near.org/)
- [HACKATHON.md](https://nearhackathon.com/HACKATHON.md)

## Prompt

```text
Track: Open Innovation (id: open).

Build [an inheritance account]. One NEAR account controls the owner's addresses on Bitcoin and Ethereum through Chain Signatures. The owner checks in on a schedule. If they miss check-ins for [90] days, a set of guardians can approve releasing the assets to named heirs, after a waiting period the owner can still cancel.

Requirements:
- The release rules live in a contract and anyone can read them.
- The owner can cancel any pending release until the waiting period ends.
- A demo on testnet with the timers shortened to minutes.
- A README section on failure cases: lost guardian keys, a guardian who turns hostile, an owner who is alive but offline.

Before building, argue against this idea for one paragraph. Then tell me which of your objections the design must answer and wait.
```
