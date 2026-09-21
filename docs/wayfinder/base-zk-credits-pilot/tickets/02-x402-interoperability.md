# Choose the pilot x402 interoperability posture

Type: grilling  
Status: resolved  
Blocked by: none

## Question

Which x402 clients and settlement paths must work in the pilot, and how should
the custom private-credit entitlement be represented without misusing core
x402 v2 fields?

## Recommended answer

Launch `zk-prepaid` as an explicitly custom x402 v2 scheme supported by the
project's client adapter, sidecar, resource server, and self-hosted facilitator.
Do not claim compatibility with generic x402 agents, the public facilitator,
or hosted Bazaar discovery.

Keep core `amount` and `asset` fields semantically meaningful under the x402
specification. Put bundle identity, claim semantics, nullifier, proof, and
reservation metadata in the scheme payload or `extra`. Confirm the final field
mapping with x402 maintainers before calling it conformant.

Treat the OpenAI-compatible sidecar as the primary coding-agent integration.
An MCP wrapper is optional for paid MCP tools; it does not intercept a coding
agent's underlying model traffic.

## Decision evidence required

- A normative local scheme schema and example 402/request/response exchange.
- A compatibility matrix covering project adapters, generic x402 clients,
  hosted facilitators, Bazaar, MCP tools, and provider-compatible sidecars.
- A real `@x402/core` registration and `/supported` negotiation test.
- A decision on whether a standard `exact` rail is deferred or included as a
  separately described, linkable product mode.

## Downstream consequences

This decision fixes public compatibility language, adapter boundaries,
discovery scope, and the minimum integration surface for design partners.

## Answer

The paid Base Sepolia pilot guarantees one path: the project `zk-prepaid`
adapter in the OpenAI-compatible sidecar, the project resource server, and a
self-hosted facilitator, for `/v1/chat/completions` on the already-chosen
service class `coding-deepseek-v4-flash-v1`.

Describe the product as a **custom x402 v2 scheme requiring the project
adapter**, never as broadly “x402 compatible.” `@x402/core` documents custom
non-token assets such as “points,” so a versioned credit asset is
SDK-compatible, but the published v2 specification still describes token/fiat
assets. Do not claim full specification conformance until x402 maintainers
confirm this custom-asset reading and a real `@x402/core` registration plus
`/supported` negotiation test passes. Maintainer confirmation is a later
conformance gate, not a pilot blocker.

### Compatibility matrix

| Consumer or channel | Pilot contract |
| --- | --- |
| Project sidecar / SDK with the `zk-prepaid` adapter | Required |
| Custom agent that deliberately registers the same adapter | Possible, not a launch requirement |
| Generic x402 wallets or agents | Out of scope |
| Public or hosted facilitator | Out of scope |
| Hosted / public Bazaar listing | Out of scope |
| Self-hosted facilitator `/supported` | Required (capability discovery only) |
| MCP wrapper | Optional follow-on, not acceptance |
| `/v1/responses` or Anthropic translation | Optional follow-on, not acceptance |
| Standard Base-USDC `exact` rail | Not a product rail |

A concierge linkable-payment control, if used at all, belongs to validation
evidence. It is not a supported product path.

### Core fields

- `amount` is `"1"`: one credit of the purchased service class, not one atomic
  unit of USDC or of the bond.
- `asset` is the scheme-local credit asset
  `coding-deepseek-v4-flash-v1`, the same identifier as the service class.
- The `PrivateCreditBond` address, circuit id, verifying-key id, deployment
  domain, and escrow flow live in `extra`.
- Proof, public signals (including the nullifier), nonce, and response key
  live in the `PAYMENT-SIGNATURE` scheme payload.
- Reservation identity is a facilitator settlement field, never a core
  `amount`/`asset` value.
- Bundle identity is proven by membership; it is not named in the 402
  challenge or payload. Putting it in `extra` would link spends.

The client must select the `zk-prepaid` acceptance by `scheme`, never by
`accepts[0]`.

### Normative 402 challenge

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://<gateway>/v1/chat/completions",
    "description": "One private prepaid API credit",
    "mimeType": "application/json"
  },
  "accepts": [{
    "scheme": "zk-prepaid",
    "network": "eip155:84532",
    "amount": "1",
    "asset": "coding-deepseek-v4-flash-v1",
    "payTo": "<treasury address>",
    "maxTimeoutSeconds": 300,
    "extra": {
      "assetTransferMethod": "prepaid-claim",
      "paymentFlow": "escrow",
      "requirementsVersion": "zk-prepaid-v1",
      "circuit": "<circuit id>",
      "verifyingKey": "<verifying-key id>",
      "deploymentDomain": "<field element>",
      "contract": "<PrivateCreditBond address>",
      "issuedAt": "<unix seconds>"
    }
  }]
}
```

### Normative PAYMENT-SIGNATURE envelope

The header is Base64 of:

```json
{
  "x402Version": 2,
  "accepted": { "...": "exact accepted requirements from the 402" },
  "payload": {
    "proof": {},
    "publicSignals": ["<root>", "<timestamp>", "<domain>", "<signal>", "<nullifier>", "<share>"],
    "nonce": "<request nonce>",
    "responseKey": "<response-encryption public key>"
  }
}
```

Client payload validation still rejects unknown or identifying fields
(`account`, `commitment`, `order`, `secret`, `tier`, `wallet`, `payer`,
`user`, `subject`). `payer` is omitted.

### Normative PAYMENT-RESPONSE

```json
{"success":true,"transaction":"","network":"eip155:84532"}
```

An empty `transaction` is intentional: there is no per-call chain
transaction. `/supported` advertises x402 v2, `zk-prepaid`, `eip155:84532`,
`prepaid-claim`, and `escrow` on the self-hosted facilitator. It does not
imply support from a public facilitator.

### Integration surface

Design-partner traffic uses the OpenAI-compatible sidecar against
`/v1/chat/completions` only. MCP, `/v1/responses`, and Anthropic translation
may be added later; they are not required to close this map.

## Comments

### Amendment from [Freeze the pilot proof and authorization boundary](03-proof-and-authorization-boundary.md) (2026-09-20)

`extra.issuedAt` is required. It is unix seconds issued by the gateway. The
public timestamp must equal it. Spend authorization rejects an `issuedAt`
outside `[now - maxTimeoutSeconds, now + 5s]`. Cached 402s die when
`issuedAt` leaves that window. Slash evidence does not use this window.
