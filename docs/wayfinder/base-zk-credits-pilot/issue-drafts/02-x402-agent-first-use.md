Title: x402 operator first use: own agent and request-aware adapter

Map story: [x402 operator's own agent loop](https://github.com/mangekyou-labs/haze-api/issues/25#x402-operators-own-agent-loop)  
Source: [B8 integration #11](https://github.com/mangekyou-labs/haze-api/issues/11)

## Deliverable

Document the supported x402 integration as an intentional registration of the
versioned `zk-prepaid` adapter in the operator's own agent. The adapter binds
the actual HTTP method, URL, and body into payment creation backed by the
existing local proof engine. Document local proving, self-check, the custom
challenge, `PAYMENT-SIGNATURE`, facilitator settlement, and
`PAYMENT-RESPONSE`.

Add a small founder starter agent that performs a real task through this
request-aware path and displays the task result locally. It must not bypass the
adapter, fake settlement, collect prompt/response telemetry, or imply generic
x402 compatibility.

## Acceptance

- A fresh local setup can install and run the documented adapter path.
- The founder starter agent performs one task request against the real
  Base Sepolia gateway using the local proof engine.
- Authenticated local aggregate metrics record the exchange without request,
  proof, credential, nullifier, or identity fields.
- An unmodified generic x402 client remains unsupported and fails closed.
