# `@zk-credits/x402-zk-prepaid`

Custom x402 v2 adapter for authorizing one private prepaid API
credit at a time. The scheme is designed for the Base Sepolia `PrivateCreditBond`
deployment and uses a Groth16 proof as an authorization envelope. It does not
broadcast a blockchain transaction for each API request.

Part of the invite-only, unpaid, experimental Base Sepolia pilot. Credits are
founder-provisioned test credits, and the circuit is experimental and not
independently audited.

This is a custom adapter, not general x402 or Bazaar compatibility. Generic
x402 clients and facilitators do not discover it unless they register the
adapters in this package; an unmodified generic client fails closed with an
unsupported-scheme result. There is no public facilitator, MCP, or standard
`exact` rail, and this is not a production or mainnet security claim.

## Install

```sh
npm install @zk-credits/x402-zk-prepaid @x402/core
```

`@x402/core` `^2.26.0` is a required peer dependency. The adapter types and
registration helpers use the published v2 client, resource-server, and
facilitator interfaces directly.

## Requirements

Every challenge advertises one credit on Base Sepolia:

```json
{
  "x402Version": 2,
  "scheme": "zk-prepaid",
  "network": "eip155:84532",
  "amount": "1",
  "asset": "coding-deepseek-v4-flash-v1",
  "payTo": "0x<immutable-treasury>",
  "maxTimeoutSeconds": 300,
  "extra": {
    "assetTransferMethod": "prepaid-claim",
    "paymentFlow": "escrow",
    "circuit": "private-credit-spend-bn254-v1",
    "verifyingKey": "dev-sepolia-v1",
    "deploymentDomain": "<deployment-domain>",
    "contract": "0x<deployed-PrivateCreditBond>",
    "requirementsVersion": "zk-prepaid-v1",
    "issuedAt": 1700000000
  }
}
```

The bond address is carried only in `extra.contract`. `issuedAt` is gateway
issued and the timestamp public signal must equal it. The fixed asset is the
credit namespace, not a token transfer.

## Payment payload

The `PAYMENT-SIGNATURE` value is the base64-encoded JSON `PaymentPayload`:

```json
{
  "x402Version": 2,
  "accepted": { "scheme": "zk-prepaid", "network": "eip155:84532", "amount": "1" },
  "payload": {
    "proof": { "pi_a": [], "pi_b": [], "pi_c": [] },
    "publicSignals": ["root", "timestamp", "domain", "requestSignal", "nullifier", "share"],
    "nonce": "random-request-nonce",
    "responseKey": "client-encryption-public-key"
  }
}
```

The production payload contains the complete accepted requirements; the
abridged example only shows the important fields. It must not contain a
commitment, tier, account, order, wallet, payer, secret, or subject.

The request signal is derived from the HTTP method, canonical URL, canonical
JSON body, complete accepted requirements, nonce, and response-encryption key.
The proof binds that signal to the private credential, current known Merkle root,
deployment domain, timestamp, nullifier, and share. Reusing the same signal is
an exact retry; a different settled signal under the same nullifier is a
cryptographic slash condition.

## HTTP flow

1. A resource server returns `402` with base64 `PAYMENT-REQUIRED` when the
   request has no valid authorization.
2. The local `zk-credits` sidecar creates a request-bound proof and retries
   with `PAYMENT-SIGNATURE`.
3. The facilitator verifies the proof and reserves the nullifier in its
   isolated claim store. The response includes `PAYMENT-RESPONSE` with
   `transaction: ""`; `payer` is omitted.
4. The gateway commits the reservation once provider dispatch begins. A
   pre-dispatch failure cancels it, while concurrent exact retries coalesce.

The self-hosted facilitator exposes the x402 v2 operations at:

- `GET /x402/facilitator/supported`
- `POST /x402/facilitator/verify` (read-only)
- `POST /x402/facilitator/settle` (reserve/commit/cancel escrow state)

The gateway's replay endpoint returns only the client-encrypted response copy.
Plaintext prompts, responses, secrets, proofs, and identifying spend metadata
are not persisted by this package.

## Integration

The supported clients are the project sidecar and an x402-native agent that
deliberately registers this adapter; an unmodified generic x402 client is not
supported. For direct HTTP clients, use the request-aware client so the signal
includes the actual request:

```ts
const client = createZkPrepaidClient({
  createPayload: ({ requirements, method, url, body }) => sidecar.createPayment({ requirements, method, url, body }),
});
const response = await client.fetch('https://api.example.test/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [] }),
});
```

For official x402 v2 instances, use the registration helpers:

```ts
registerZkPrepaidClient(x402Client, proofFactory);
registerZkPrepaidResourceServer(x402ResourceServer, requirements);
registerZkPrepaidFacilitator(x402Facilitator, facilitator);
```

The `asOfficialX402Scheme*` helpers remain available when an application needs
to compose adapters directly. Escrow reserve/commit/cancel phases come from
core settlement context; a client cannot select a phase. Durable claim
persistence and gateway HTTP lifecycle remain a later unit.

See `src/index.test.ts` and the gateway tests for malformed payload, requirement
cache, escrow reservation, retry, and forbidden-identity-field coverage.

SPDX-License-Identifier: AGPL-3.0-or-later
