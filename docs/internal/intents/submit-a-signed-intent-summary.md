# Submit a signed intent (summary)

The upstream OpenAPI page is 394 KB, so this is a summary of the parts Ferry uses. Read
the live page when you need a field this does not name:
<https://docs.near-intents.org/api-reference/oneclick/submit-a-signed-intent>

## Endpoint

`POST https://1click.chaindefuser.com/v0/submit-intent`, partner auth (`X-API-Key`, or
the legacy `JWT-auth` bearer). It does not use the end-user `User-Session` token.

## Body

```json
{
  "type": "swap_transfer",
  "signedData": {
    "standard": "nep413",
    "payload": { "recipient": "intents.near", "nonce": "<base64>", "message": "<the JSON string from generate-intent>" },
    "public_key": "ed25519:...",
    "signature": "ed25519:..."
  }
}
```

- `type` is `swap_transfer` today; it is the only discriminator value.
- `signedData` is the `intent` object `/v0/generate-intent` returned, plus `public_key`
  and `signature`. Do not edit `payload` between generate and sign: the signature covers
  those exact bytes.
- `standard` matches what generate-intent was asked for (`nep413`, `erc191`,
  `raw_ed25519`, `webauthn`, `ton_connect`, `sep53`, `tip191`).

## Response

```json
{ "intentHash": "44XpLRAuZKoVGs9T4qbSNv33MDKMePPAibA52geVLWFw", "correlationId": "..." }
```

`intentHash` identifies the submitted intent. Track the swap with `GET /v0/status` on the
quote's `depositAddress`, exactly as an on-chain deposit swap is tracked.

## Errors

`400` for a bad body or a quote that is not in a signable state, `401` for a bad key.
Branch on the HTTP status; the generate/submit pair does not publish a stable code list
the way the order endpoints do.

## What Ferry needs from this

1. A quote with `depositType: INTENTS` (or `CONFIDENTIAL_INTENTS`).
2. `POST /v0/generate-intent` with that quote's `depositAddress`, the visitor's
   `signerId` and `standard: "nep413"`.
3. The visitor signs the returned `payload` off-chain (NEP-413: `sha256` of the
   Borsh-serialised `{ message, nonce, recipient, callbackUrl }`).
4. `POST /v0/submit-intent` with `intent` plus `public_key` and `signature`.
5. `GET /v0/status?depositAddress=...` to track it.
