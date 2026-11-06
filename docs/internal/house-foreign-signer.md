# Foreign signer interface (house consumes; Toll implements)

Nearcarta House controls a foreign address only if the **Toll** contract signs for it.
House must not sign, hold a key, or copy Toll's signer. The house contract calls one
function; Toll returns a signature; the house records what was asked.

Status: **not shipped**. `toll.nearcarta.near` (code `6aAGdUhy…`, v7) exports `cross`,
`sign_cross`, `on_signed`. There is no entry point a *contract* can call. Until Toll
ships `sign_effect`, House marks the vault `live: false` and does not claim control.

## The interface, version 1

```text
method:  sign_effect
on:      the Toll account in `mainnet.json` `toll.contract`
caller:  the house contract account (predecessor is a contract, not a person)
args:    {
           path:      string,   // "<token_id>-<chain>-1", the deed's stable path
           chain:     string,   // "base" | "btc"
           to:        string,   // base: 0x + 40 hex; btc: bech32
           asset:     string,   // "native" | "usdc" | "BTC"
           value:     u128,     // smallest unit of the asset
           gas_limit: u64,
           action_id: string,   // the house action id; Toll must refuse a repeat
           domain_id: u8        // 0, the MPC domain the path was derived in
         }
returns: PromiseOrValue<{ signature: string, nonce: u64, tx_hash: string | null }>
refuses when: frozen, the path was not derived for that predecessor, value over cap,
              the same action_id was already signed, or the chain is unknown
```

The signature must be produced by `v1.signer` `sign` for
`derived_public_key({ path, predecessor: <house contract>, domain_id: 0 })`. The
address the deed controls is therefore fixed by the **contract**, not the holder:
a deed transfer moves who may ask, never where the coins live.

## What House guarantees on its side

- `house_set_vault` (holder, 1 yocto) writes `path = "<token_id>-<chain>-1"`; the
  holder cannot choose a path.
- `house_session_prepare_send` caps `value` at the vault cap, checks the payee is in
  the vault's receiver list, and refuses Bitcoin with a value (signing only).
- `house_mark_funded` blocks `close()` while a foreign path holds value;
  `house_declare_evacuated` (deployer only) clears it after the coins leave.
- The deed's ownership **epoch** rises on release; a prepared send from the previous
  epoch cannot be signed.

## Tests that do not need Toll

`backend/test/unit/house-foreign.test.js` runs the house side against a fixture that
implements this exact ABI in memory. It proves the request shape, the cap refusals,
the repeat refusal and the epoch rule. The live path stays `live: false` until Toll's
`sign_effect` exists on the account, and `scripts/house-foreign-check.js` prints
whether it does.
