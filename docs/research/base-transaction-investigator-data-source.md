# Base transaction investigator: execution-data sources

Research decision: [Find a useful x402 execution-data source for Base transactions](https://github.com/mangekyou-labs/haze-api/issues/40), within [Base transaction investigator: useful x402 workflow and concise developer README](https://github.com/mangekyou-labs/haze-api/issues/39). Checked 7 October 2026. This records evidence and feasible choices; it does not select a provider or authorize purchases.

## Finding

**Alchemy is a credible candidate for authentic execution evidence, with a reachable x402 gateway, but paid trace delivery is unverified.** An unpaid `debug_traceTransaction` request received an x402 v2 quote for $0.001 USDC on Base mainnet. This demonstrates a payment gate, not acceptance of the RPC method or delivery of its result. The same request to the Base Sepolia investigation URL offered mainnet payments only. A testnet payment rehearsal cannot assume this vendor accepts Base Sepolia USDC.

The missing evidence is the transaction's recursive calls and revert data. A receipt establishes success or failure but does not explain a failure. Base documents `debug_traceTransaction` with `callTracer` for execution replay, including nested calls, inputs, outputs and errors; availability and limits depend on the provider. [Base receipt reference](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_getTransactionReceipt), [Base debug reference](https://docs.base.org/base-chain/api-reference/debug-api/debug_traceTransaction).

No verified usable provider meets the complete trace-plus-testnet-payment requirement yet: no provider in this research has demonstrated an **authenticated, paid trace response**, and none has demonstrated that response paid with **Base Sepolia USDC**. The product should not describe either as proven.

## Alchemy: published support versus observed behavior

Alchemy lists Debug and Trace APIs for Base. Its `debug_traceTransaction` reference accepts a mined transaction hash and tracer configuration and describes recursive call frames with `input`, `output`, `error` and `calls`. This is materially more useful for explaining failed execution than purchasing another receipt. However, the Debug API quickstart requires a pay-as-you-go or enterprise plan. Broad gateway coverage does not establish whether this method's entitlement is available through the currently quoted x402 route. [Base API overview](https://www.alchemy.com/docs/base/base-api-overview), [method reference](https://www.alchemy.com/docs/chains/debug-api/debug-api-endpoints/debug-trace-transaction), [Debug API access](https://www.alchemy.com/docs/reference/debug-api-quickstart).

The ordinary method reference lists 40 compute units and 1,000 throughput compute units. These are upstream API accounting figures, not verified x402 billing or rate limits. Gateway request frequency, maximum response size, and historical trace retention remain unverified. [Method reference](https://www.alchemy.com/docs/chains/debug-api/debug-api-endpoints/debug-trace-transaction).

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Base and debug method documentation | Alchemy offers authentic Base execution tracing generally | Current x402 gateway entitlement, historical coverage or actual response |
| First-party gateway reference | Base mainnet and Sepolia query routes; documented SIWE wallet authentication and x402 v2 | Current acceptance of testnet payments |
| Unpaid live mainnet and Sepolia probes | Gateway returns a v2 payment challenge; first option is Base mainnet USDC | RPC validation, successful execution, price of every trace, or refund behavior |

The wallet-auth documentation describes SIWE tokens in `Authorization: SIWE <token>` instead of API keys; the published gateway reference says authentication is required. Its payment reference describes the `exact` scheme and EIP-3009 authorization, with facilitator settlement. Those are provider integration facts, not a requirement that the investigator deploy contracts or give the vendor its private key. The agent would need signing capability, payment policy and funded payment assets; any LLM account or inference-credit setup remains separate. [Wallet authentication](https://www.alchemy.com/docs/alchemy-for-agents), [gateway reference at inspected commit](https://github.com/alchemyplatform/skills/blob/4caf3e555c3af8dbb9e5b540aed558aef986d885/skills/agentic-gateway/rules/x402/reference.md), [payment reference](https://github.com/alchemyplatform/skills/blob/4caf3e555c3af8dbb9e5b540aed558aef986d885/skills/agentic-gateway/rules/x402/payment.md).

**Documentation and live behavior differ.** The February launch article describes buying compute credits from $1, with USDC settled on Base and requests consuming that balance. The inspected gateway reference lists both Base mainnet and Base Sepolia payment networks. The October unpaid response instead says $0.001 per request and offers no Base Sepolia payment. It also produces a challenge without SIWE. This proves that authentication is unnecessary to obtain this quote; it does not prove that authentication is unnecessary for paid delivery. Use current challenges as evidence of offered payment terms, and verify delivery before documenting a supported integration. [Launch description](https://www.alchemy.com/blog/ai-agents-can-now-sign-up-for-alchemy), [gateway reference](https://github.com/alchemyplatform/skills/blob/4caf3e555c3af8dbb9e5b540aed558aef986d885/skills/agentic-gateway/rules/x402/reference.md).

### Live probe: quote only; authenticated/paid trace delivery unverified

On 7 October 2026 at approximately 05:30 UTC, these requests returned HTTP 402. They contained **no authorization or payment headers**. No wallet was connected, authorization signed, account provisioned, or transaction submitted. The hash is an example hash, not a validated failing-transaction fixture.

```sh
curl -sS -i https://x402.alchemy.com/base-mainnet/v2 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"debug_traceTransaction","params":["0x03c8f106f18ad94190e763e21b584c5825b2f4c61f1274c0e8abe65b4476cd51",{"tracer":"callTracer"}]}'
```

Repeat with `https://x402.alchemy.com/base-sepolia/v2` to reproduce the investigation-network comparison. Decode the `payment-required` header to inspect the challenge without retrying with payment. The response body also contained it. Selected exact fields from the mainnet response, including the first accepted payment option:

```json
{
  "x402Version": 2,
  "error": "Payment Required",
  "resource": {
    "url": "https://x402.alchemy.com/base-mainnet/v2",
    "description": "Pay $0.001 per request — no account required. See https://www.alchemy.com/docs/reference/compute-unit-costs",
    "mimeType": "application/json"
  },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "amount": "1000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x0573c4dA7fC31E944e5FF959fEf3b42199C308B2",
    "maxTimeoutSeconds": 300,
    "extra": {"name": "USD Coin", "version": "2"}
  }]
}
```

This excerpt omits two additional `accepts` entries: Solana mainnet USDC, and another Base mainnet USDC option whose `extra.name` is `GatewayWalletBatched`. The Sepolia route returned those same three payment options and a matching resource URL for Sepolia. **Neither response offered `eip155:84532`.** Addresses are observed public quote values, not credentials or configuration recommendations. Prices and recipients must be read from a fresh challenge; this quote does not establish the price for larger legitimate traces.

To establish usability later requires a separately authorized, bounded purchase against a known failed transaction: confirm method acceptance, the complete call tree and revert bytes, network/block identity, historical retention, authentication requirements, timeout/size limits, and billing on an RPC error or unavailable trace. Until then the quote may precede method validation, including for an unsupported method.

## Other services checked

**x402 web tools** publishes `GET /evm/internal-tx` for $0.01, with Base among its investigation networks. Its documented output contains internal transaction types, addresses, value and success/error information from Blockscout. An unpaid GET using its documented example returned HTTP 402, x402 v2 `exact`, `eip155:8453`, USDC amount `10000`, timeout 300. Its first-party agent card says no API key or account is needed. Successful paid output was not tested. [Agent card](https://api.agentstools.dev/.well-known/agent-card.json), [endpoint and output documentation](https://api.agentstools.dev/llms.txt).

Reproducible unpaid request:

```sh
curl -sS -i 'https://api.agentstools.dev/evm/internal-tx?network=base&tx=0xe661f796c921f6fc1b366c9c62ef630ca1b33a7f61d433a4b4b6fc06ad84c86b'
```

This is a partial evidence source, not a demonstrated substitute for a complete EVM call trace with revert return bytes. Its documentation warns that Blockscout rate limits or downtime can produce `status: unavailable`. The underlying public explorer may already expose the same evidence, so purchase necessity must be checked for the particular task. The docs also mention legacy `X-PAYMENT`; the observed challenge was v2. Neither billing on unavailable output nor the paid retry contract was verified. [Service documentation](https://api.agentstools.dev/llms.txt).

Blockscout's first-party June article says x402 is next after agent skills; that announcement is not proof of a live payable trace endpoint. Other paid transaction/receipt endpoints add ordinary RPC data, while Chain Analyzer's paid “trace” describes financial-flow/AML analysis rather than EVM execution replay. None establishes the needed revert-evidence purchase. [Blockscout announcement](https://www.blog.blockscout.com/agent-skills-live-x402-next/), [402.com.tr endpoint catalog](https://402.com.tr/agents), [Chain Analyzer x402 API](https://chain-analyzer.com/en/docs/x402).

## Choices for a testnet rehearsal

1. **Separately hosted x402 trace gateway:** a service can fetch authentic evidence from a documented trace API and accept Base Sepolia payment independently of the investigated chain. Alchemy's ordinary Debug API is an option with documented plan requirements; Chainnodes also documents a keyed Base mainnet `debug_traceTransaction` endpoint. Upstream API keys belong on the hosted service, not in the agent. This is a feasible architecture, not an existing deployed vendor or an owner-approved fallback. Before claiming it works, validate upstream coverage, a known failed transaction, preserved frame/revert output, price caps and behavior on unavailable data. [Alchemy access requirements](https://www.alchemy.com/docs/reference/debug-api-quickstart), [Chainnodes method](https://www.chainnodes.org/docs/base/debug_traceTransaction).
2. **Explicit fixture rehearsal:** an authentic captured trace can demonstrate decision-making and report generation with a clearly labelled simulated payment gate. It cannot be presented as a live provider purchase or as evidence that mainnet settlement works. The report decision must choose whether this satisfies the rehearsal goal.
3. **Alchemy live candidate:** preserve it for later verification, but a mainnet-funded purchase is outside the testnet rehearsal scope unless the owner changes that scope. A Base Sepolia query URL alone does not make the payment testnet.

The useful demo boundary is: inspect free data, identify a concrete evidence gap, buy the missing evidence only when necessary, then use LLM inference to explain that evidence. Consuming the project's existing prepaid inference credits is a separate operation from the execution-data purchase.

## When no purchase is useful

For confirmation status, successful execution, gas used or emitted logs, the receipt and transaction are generally sufficient. A supplied trusted call trace or public explorer evidence may already answer the specific failure question. The agent should then skip the purchase; it should not pay just to demonstrate x402. A failed receipt alone does not identify the cause, and gas usage alone should not be treated as proof of a particular revert. [Base receipt fields](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_getTransactionReceipt), [Base trace fields](https://docs.base.org/base-chain/api-reference/debug-api/debug_traceTransaction).

No claim is made that every public or free RPC lacks tracing. Providers differ. An attempted read-only request to `https://mainnet.base.org` returned HTTP 403 from this research environment before any useful result; this does not establish trace-method support or absence.

## Research limits

Context7 library resolution followed by documentation fetch was used for Base and Alchemy, then first-party documentation, source and unpaid live challenges resolved service-specific gaps. There were no paid requests or authenticated trials. Current endpoint availability, a quoted price and a general API catalog are three distinct kinds of evidence; none substitutes for a validated trace result. Provider selection, deployment, payment policy and the permitted fixture/testnet rehearsal belong to subsequent owner decisions.
