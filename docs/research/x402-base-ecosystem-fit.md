# x402 and Base ecosystem fit for zk-prepaid credits

**Research date:** 2026-09-20  
**Scope:** x402 v2 interoperability, Base ecosystem fit, agents and MCP, Bazaar discovery, ERC-8021 attribution, and implications for the current `feature-base-zk-credits` requirements/design/plan.  
**Source policy:** Primary and official sources only.

## Executive result

The current architecture is viable as a **custom x402 v2 deployment**, but it is not automatically interoperable with generic x402 agents, public facilitators, or hosted Bazaar catalogs. The protocol is intentionally extensible, while compatibility is negotiated at the exact `(scheme, network)` pair. A client, resource server, and facilitator must each install code that understands `zk-prepaid`; a conventional `exact` client cannot infer how to use a private prepaid credential or create the proof.

That makes the proposed self-hosted facilitator and dedicated sidecar the correct launch architecture. The fastest credible launch is a Base Sepolia, direct-distribution beta for privacy-motivated coding-agent users. Do not make initial product validation depend on public Bazaar placement, generic agent-wallet support, MCP, or mainnet.

Base is a good settlement and accountability anchor for the bundle bond, release, and slashing lifecycle. It is not the per-request payment rail in this design. As a result, the product fits the Base ecosystem as an application that anchors economic guarantees on Base, but it will not naturally produce an onchain transaction or ERC-8021 attribution event for every API call.

Before claiming full x402 v2 conformance, resolve one specification question with the x402 maintainers: the core v2 document describes `amount` as the required amount in atomic units and `asset` as the payment asset. The current design instead uses `amount: "1"` as one prepaid claim and `asset` as the bond-contract namespace. A custom scheme may define additional semantics, but this reinterpretation of core fields is not clearly established by the official material reviewed here.

## Compatibility matrix

| Consumer or channel | Works at launch? | What is required |
|---|---:|---|
| Project sidecar / SDK | Yes | Register the `zk-prepaid` client adapter, hold the encrypted credential, and produce proofs locally. |
| Custom x402 agent | Yes | The same adapter and proving/credential support must be deliberately integrated. |
| Generic x402 wallet agent | No | Generic agents support only the schemes they register; they cannot derive `zk-prepaid` behavior from the HTTP challenge. |
| Public x402 facilitator | No, based on current support | The facilitator must install and advertise a `zk-prepaid` implementation. The live public `/supported` response did not advertise it on 2026-09-20. |
| Self-hosted facilitator | Yes | Run the scheme-specific verifier, reservation/commit state machine, and settlement integration. |
| Self-hosted Bazaar catalog | Technically yes | Implement Bazaar discovery and catalog the custom scheme. This does not create meaningful third-party distribution by itself. |
| Hosted/public Bazaar | Not yet | Its operator must accept/catalog the scheme, and target clients must still have the matching adapter. |
| MCP agent using a custom bridge | Yes | Register the custom scheme in the x402 MCP client and expose the paid tool/resource. |
| Coding agent's underlying LLM API traffic | Yes through the sidecar, not MCP alone | The local proxy must own/intercept the provider HTTP transport; an MCP tool does not automatically own Codex/Claude model traffic. |
| Web2 API user | Possible, with installation friction | Stripe removes wallet friction, but the user still needs secure credential storage and a local prover/adapter. |

## What x402 v2 permits—and what it does not provide automatically

The v2 specification separates transports from payment mechanisms and allows HTTP, MCP, A2A, and custom transports. It also defines multiple settlement flows. In particular, escrow-style schemes may settle before the resource call to reserve value and settle again afterward to finalize it. The spec also says settlement need not always be an onchain transaction: a client-prepaid scheme may consume a proof or update backend state. These provisions fit the design's reserve-before-handler and commit-after-success lifecycle. See the official [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

The extensibility boundary is explicit in the official [x402 repository](https://github.com/x402-foundation/x402): clients and facilitators support particular scheme/network combinations. The official resource-server implementation likewise registers handlers by network and scheme, then matches those values against the facilitator's advertised support; see [`x402ResourceServer.ts`](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/server/x402ResourceServer.ts). Therefore:

- An x402-formatted `402` response is not enough for a generic client to spend a zk-prepaid credential.
- A generic facilitator cannot validate, reserve, commit, cancel, or slash this scheme without its scheme module.
- A resource server can offer more than one accepted payment requirement, but each client can select only a scheme it implements.
- The self-hosted facilitator described in the current design is a necessity for launch, not merely an operational preference.

The design's successful response with an empty `transaction` has an official precedent: the x402 [SVM batch-settlement scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement_svm.md) permits successful offchain voucher acceptance with `transaction: ""`. The v2 response schema also makes `payer` optional. This supports the response shape, although the custom scheme specification should state the convention directly.

### Core field semantics need confirmation

The v2 core specification documents `PaymentRequirements.amount` as an amount in the asset's atomic units and `asset` as the payment asset identifier. The current requirements use:

- `amount: "1"` to mean one prepaid claim; and
- `asset` as the sponsor bond contract / entitlement namespace.

The reviewed official sources show that schemes can define their own payloads and settlement phases, but do not clearly authorize changing these core field meanings. This may still be acceptable for a custom scheme, but it should not be assumed. The safest choices are:

1. obtain an explicit x402 maintainer answer and document the scheme's semantics; or
2. keep core `amount`/`asset` economically meaningful and move claim/bundle identifiers into `extra` and the scheme payload.

This is the main protocol-conformance question in the current documents.

## Bazaar discovery and public distribution

The official [Bazaar extension documentation](https://github.com/x402-foundation/x402/blob/main/docs/extensions/bazaar.mdx) describes discovery as facilitator-specific and still evolving. A facilitator catalogs a resource when it processes a request containing the echoed Bazaar extension. The schema can represent HTTP and MCP resources and includes the payment scheme, so it is not inherently limited to `exact`.

However, catalog inclusion is an implementation decision by the facilitator operator. A successfully settled custom payment does not force a hosted catalog to index it, and indexing it does not teach clients how to pay it. Thus the current product-doc statement should be made more precise:

> A self-hosted Bazaar-compatible catalog can describe `zk-prepaid`, but CDP/public Bazaar distribution is unavailable until a hosted catalog accepts the scheme and target agents ship the corresponding client adapter.

The live official [x402 facilitator support endpoint](https://x402.org/facilitator/supported), checked on 2026-09-20, advertised Base Sepolia v2 support for schemes including `exact`, `upto`, and `batch-settlement`, but not `zk-prepaid`. This is expected for a project-specific scheme and confirms that the public facilitator cannot serve as the launch facilitator.

Coinbase's official [Agentic Wallet quickstart](https://docs.cdp.coinbase.com/agentic-wallet/cli/quickstart) exposes Bazaar search and x402 payment commands with Base as the default network. This is useful evidence of distribution for standard supported schemes, not evidence that Agentic Wallet can use arbitrary schemes. The same restriction applies to general wallet/agent frameworks: wallet access and transaction tools do not supply the zk-prepaid credential store, proof generator, or state machine.

## MCP and coding-agent fit

The official [x402 MCP guide](https://github.com/x402-foundation/x402/blob/main/docs/guides/mcp-server-with-x402.md) shows that MCP payment becomes automatic only after concrete schemes are registered on the x402 client. A custom MCP bridge can therefore support `zk-prepaid`, but only by bundling the custom adapter and the credential/prover integration.

MCP is useful when the paid product is itself an MCP tool or resource. It does not, on its own, intercept a coding agent's calls to its configured LLM provider. The current sidecar design remains the right integration for Codex, Claude, Cline, and similar coding workflows because the sidecar owns the provider-compatible HTTP endpoint and can attach the proof to those requests.

Practical segment fit:

- **Privacy-focused coding-agent users:** strongest initial fit. They have a concrete reason to accept local setup and can route high-value model traffic through a sidecar.
- **General coding-agent users:** plausible after installation, recovery, latency, and provider compatibility are nearly invisible.
- **Generic x402 agents:** weak launch fit because they need a new adapter and non-wallet secret/proving lifecycle.
- **Conventional Web2 API users:** Stripe purchase is familiar, but local encrypted credentials and proof generation are substantially more work than an API key. Offer an SDK/sidecar rather than expecting direct protocol implementation.
- **Privacy users:** the construction can separate purchase identity from ordinary spend identity at the application layer. It does not hide request content, timing, IP/network metadata, or the gateway's view of traffic; product claims must preserve that boundary.

## Base mainnet and ERC-8021 attribution

Base's official [Builder Codes and ERC-8021 announcement](https://blog.base.dev/builder-codes-and-erc-8021-fixing-onchain-attribution) describes attribution as a suffix appended to transaction calldata. Base's [Builder Code integration reference](https://github.com/base/skills/blob/master/skills/build-on-base/references/builder-codes/overview.md) recommends generating a `dataSuffix` (for example with `ox/erc8021`) and installing it at the wallet-client layer.

That matches the planned server-wallet integration for bond funding, release, and slash transactions. It also sets a hard boundary: requests that are entirely offchain have no transaction calldata to tag. Therefore ERC-8021 can attribute the bundle lifecycle, not every private API call. The launch plan should:

- claim the project's Builder Code before mainnet;
- attach and test the suffix on every application-originated lifecycle transaction;
- verify decoded attribution on Base Sepolia before mainnet; and
- avoid promising per-call onchain attribution, transaction count, or payment volume.

The design is consequently a reasonable Base application, but its Base story is **escrow-backed prepaid accountability**, not onchain micropayments per request.

## Comparison with the current documents

### Aligned and worth keeping

- Base Sepolia-first launch and no premature mainnet deployment.
- A self-hosted facilitator and project-owned `zk-prepaid` adapters.
- Reserve before calling the upstream handler, commit only after a successful buffered response, and cancel on pre-success failure.
- No Base transaction for every request.
- ERC-8021 on application-originated bond lifecycle transactions.
- Sidecar-first integration for coding agents.
- Explicit privacy limits: the gateway sees request content/timing, the control plane can associate purchase records with commitments, and double-spend handling can reveal the configured identity evidence.

### Clarify or change before launch

1. **Resolve `amount` and `asset` semantics.** Record a maintainer answer or revise the fields before presenting the scheme as conformant x402 v2.
2. **State compatibility narrowly.** Use “custom x402 v2 scheme requiring an adapter,” not language that implies generic x402 compatibility.
3. **Refine the Bazaar limitation.** The protocol can describe the scheme; third-party hosted discovery and client support are the actual blockers.
4. **Add an interoperability test.** Exercise a current `@x402/core` client, resource server, and facilitator with explicit custom registration and verify `/supported` negotiation—not only internal structural types.
5. **Document the empty transaction convention.** It has an official precedent but should be normative in the local scheme spec.
6. **Fix the package README's commit-timing drift.** The README says commit occurs once provider dispatch begins; the reviewed design correctly requires a successful buffered handler response before commit. Those statements should not coexist.
7. **Keep MCP optional.** An MCP wrapper is a distribution adapter for paid tools, not a replacement for the coding-agent HTTP sidecar.

## Fast launch recommendation

### Phase 1: direct private beta on Base Sepolia

Ship one excellent path: install sidecar/SDK, buy a small Stripe bundle, recover the encrypted credential, make a provider-compatible request, and observe correct reserve/commit/cancel behavior. Recruit users who already run coding agents and explicitly care about limiting identity linkage or credential exposure.

Validate these outcomes before expanding protocol surfaces:

- time from landing page to first successful paid request;
- install and provider-configuration completion rate;
- proof-generation plus gateway latency;
- cancellation correctness under upstream failure and client disconnect;
- credential loss/recovery rate;
- repeat bundle purchase and retained weekly use;
- whether privacy motivation is strong enough to justify the sidecar.

### Phase 2: deliberate x402 distribution

Publish a concise scheme specification and stable client/server adapters. Add a custom MCP bridge only if beta users want to buy MCP-hosted tools. Approach x402/CDP maintainers with an interop fixture and the resolved core-field semantics; do not wait for them to validate the product's core user value.

### Phase 3: optional dual rail

If generic agent distribution matters, offer a separate standard Base USDC `exact` requirement alongside `zk-prepaid`. This gives standard x402 agents and Bazaar users a compatible path while preserving the private prepaid path for users who choose it. Treat the two rails as distinct product modes: standard exact payment gains ecosystem reach but does not offer the same purchase/spend unlinkability.

### Mainnet gate

Move to Base mainnet only after the Sepolia beta demonstrates real repeat use, reservation safety under concurrency/failure, operational key management, and a credible bond/slash policy. Mainnet does not solve distribution or product-market fit; it raises the cost of mistakes.

## Bottom line

Ship the sidecar-led Sepolia beta quickly. The product does not need generic x402 or Bazaar support to test its core thesis. It does need precise claims: it is a custom x402 v2 scheme anchored by Base escrow, with explicit adapters and offchain per-request settlement. Resolve the core-field semantics and test real x402 registration/negotiation before using a broad “x402 compatible” label. Add standard `exact` as a separate rail later if ecosystem distribution becomes more valuable than preserving one uniform private payment path.
