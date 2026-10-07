# Base transaction investigator: payment and inference constraints

Research for [Establish the dual-payment and inference integration constraints](https://github.com/mangekyou-labs/haze-api/issues/41), under [Base transaction investigator: useful x402 workflow and concise developer README](https://github.com/mangekyou-labs/haze-api/issues/39). Checked 2026-10-07. Findings and implementation options only; budget values, provider choice, retry policy and production scope remain owner decisions.

## Result

The existing runtime supplies request-bound private-credit inference, including function-tool and multi-message requests. It does not supply an investigation loop, standard `exact` wallet purchases, or a task-wide spend controller. A useful demo can fetch public facts, identify missing execution evidence, purchase that evidence within delegated limits, and use prepaid inference to produce an evidence-linked report. The paid purchase must change what the investigator can conclude; merely paying to send a prompt does not demonstrate resource selection.

Use two explicit payment relationships: execution data bought with a separately configured `exact` signer, and inference authorized by the existing local `zk-prepaid` credential. The current credit deployment is Base **Sepolia**, `eip155:84532`, not Base mainnet. Execution target chain, data-payment chain and inference-credit deployment must be separate configuration fields. Investigating a mainnet transaction does not make the Sepolia inference credential a mainnet payment credential. Sources: [credit adapter](../../packages/x402-zk-prepaid/src/index.ts), [local runtime](../../packages/zk-credits-sidecar/src/local-x402-agent.ts), the proposed local `docs/wayfinder/base-transaction-investigator/CONTEXT.md` glossary in the inspected shared workspace; durable term pointer: [Base transaction investigator: useful x402 workflow and concise developer README](https://github.com/mangekyou-labs/haze-api/issues/39).

## Evidence provenance

Inspected the active shared working tree at `/Users/kyler/repos/feature-zk-api-credits`, based on commit `e4525386d5f159718b3efe5e78e667789cdeeefe`, **including existing uncommitted changes**. This research branch intentionally contains only this note. Relative source links refer to repository paths; dirty files in that other working tree may differ from this branch and published packages. In particular the proposed investigator glossary is a shared-tree untracked artifact; its terms are pointed to through the map issue until that file is committed. No product code was changed and no paid call or transaction was made.

Official x402 sources were resolved and queried with Context7 (`library x402`, then two distinct `docs` queries), and key source was read directly. External source pin: `coinbase/x402` main commit `dd927a26cfefc98c24b3ec38b3a8f204dad0c60d`. These are current-source findings, not a guarantee about an unpinned future package release.

Core inspected file SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `ts/service-class.ts` | `4928fb062640a8d922b32944a71cac497b9cd8c2f6def31bd384c75363c0b967` |
| `ts/claim-completion.ts` | `bda8461705118a1aebb1b9d2621271195df5794f6651227e1308c557681d015a` |
| `packages/zk-credits-sidecar/src/base-sidecar.ts` | `f2b6ecc8448a96e73c513abd2d6dc667e279296ef7eb250bdd1cf1a607bc07f7` |
| `packages/zk-credits-sidecar/src/slot-ledger.ts` | `717dfc33de62a2c357e94810dafc0cb73f5f91412f9b25cf54c088d829e2bcbd` |
| `packages/x402-zk-prepaid/src/index.ts` | `d621a27be2318aed1183ae86bc1e2a2094ba17199e0e185d1dd012d158ed79c3` |
| Dirty `packages/zk-credits-sidecar/src/cli.ts` | `6803350b38380455ac45f93c2f637ffa798d39b73d594a94cfe22cb9388a84a8` |
| Dirty `packages/zk-credits-sidecar/src/credential-store.ts` | `ed615dda557f072850523419bec15ceced714065b4f7e98c7964d5c26d95fc9c` |

## What the current inference path can do

`runX402Agent` reads one task, posts one Chat Completions body, prints `message.content`, and repeats on the next human input. It neither executes returned tools nor retains a task conversation. `createLocalX402Agent().client.fetch(url, init)` is the reusable request-aware integration seam; an investigator must own the task loop above it. Sources: [CLI](../../packages/zk-credits-sidecar/src/cli.ts), [runtime](../../packages/zk-credits-sidecar/src/local-x402-agent.ts).

The gateway service class is fixed as `coding-deepseek-v4-flash-v1`, model `deepseek/deepseek-v4-flash`, via OpenRouter Chat Completions. Client-selected models are ignored. It accepts nonempty conversations with system/developer/user/assistant/tool roles, text-only content, assistant function `tool_calls`, and tool results. Function definitions, `tool_choice`, `parallel_tool_calls`, and `response_format` text/JSON object/JSON schema are accepted. This establishes **request support**, not demonstrated provider adherence to a schema or reliable diagnosis. Validate returned tool arguments and final reports locally. The gateway's provider routing requires parameter support and disables fallbacks. Sources: [service-class normalization](../../ts/service-class.ts), [provider adapter](../../ts/providerAdapter.ts).

| Boundary | Current value or behavior |
| --- | --- |
| Raw request | At most 256 KiB |
| Input allowance | At most 128,000 counted units: UTF-8 bytes of selected input plus message/tool overhead; deliberately more conservative than actual model token counting |
| Output | At most 4,000 tokens; positive integer lower requests permitted |
| Choices | One (`n=1`) |
| Upstream dispatch wait | 120 seconds; see timeout caveat below |
| Replay response | At most 1 MiB plaintext / 2 MiB encrypted envelope |
| Server claim replay retention | 24 hours |
| Dispatch attempts for one server claim | At most two, before explicit operator budget reset |
| Unsupported | Streaming fields even when supplied as `false`, media inputs, client routing/fallback controls, built-in web search, reasoning controls, legacy function-calling fields |

Sources: [service class](../../ts/service-class.ts), [replay bounds](../../ts/response-replay.ts), [claim lifecycle](../../packages/x402-zk-prepaid/src/claim-lifecycle.ts). The unit counter explicitly counts messages and tool definitions, not every forwarded field: for example `response_format` is forwarded without adding its schema to that counter. Treat 128,000 as the implemented admission metric, not a proven cap on all provider-visible input. Large traces therefore need deterministic extraction, truncation with recorded omissions, or bounded summarization before inference. A raw trace cannot be assumed to fit. Summarizing in extra model turns consumes additional inference entitlements.

The gateway itself rejects `/v1/responses`. The loopback sidecar translates a supported subset of Responses into Chat Completions; its emitted Responses events are a compatibility bridge over a buffered response. It does not add provider-native streaming, built-in search or a task executor. Sources: [gateway routes](../../ts/zk-prepaid-gateway.ts), [sidecar routes](../../packages/zk-credits-sidecar/src/sidecar.ts), [Responses bridge](../../packages/zk-credits-sidecar/src/responses-bridge.ts).

## Different authorization mechanics

### Private-credit inference

`createBasePaymentFactory` derives a request signal from exact method, URL, body bytes, accepted requirements, nonce and response public key. It checks the credential deployment domain, generates and self-verifies the pinned proof locally, and retires the chosen slot locally before emitting payment. The gateway independently recomputes the signal and verifies the challenge, proof and known root before reservation. The requirement asset is a versioned service entitlement, amount `1`, not USDC. Server settlement consumes an offchain claim and returns `transaction: ''`; it is not a per-request Base transfer. Sources: [proof factory](../../packages/zk-credits-sidecar/src/base-sidecar.ts), [proof coordinator](../../packages/zk-credits-sidecar/src/proof-coordinator.ts), [gateway request verification](../../ts/zk-prepaid-gateway.ts), [adapter](../../packages/x402-zk-prepaid/src/index.ts).

The custom client chooses the first `zk-prepaid` option, caches fresh terms by method/URL/requirements, and checks timestamp freshness. It has no investigator-specific origin/payee allowlist or task budget. Existing proof/deployment validation is not a substitute for those authorization checks. Its official-core scheme wrapper receives terms and extensions, **not actual method/URL/body**. Registering that wrapper alone under a generic payment-fetch client does not invent the request context required by the proof. Reuse the request-aware runtime, or design a deliberate request-context bridge; avoid one mutable global request context shared by concurrent purchases. Sources: [custom client and official wrapper](../../packages/x402-zk-prepaid/src/index.ts), [runtime](../../packages/zk-credits-sidecar/src/local-x402-agent.ts).

### Standard execution-data purchase

The official EVM `exact` client signs an authorization and a facilitator transfers the token. For EIP-3009 the signed fields are payer, recipient, amount, validity window and nonce, in the token/chain typed-data domain. Method, URL, trace query and body hash are not those signed fields. The envelope's resource description is not proof of evidence quality or HTTP-request binding. Permit2 additionally needs approval handling; newer specs also describe delegated accounts. The current TypeScript client dispatches EIP-3009/Permit2. Integration should choose a supported transfer method deliberately, rather than treating any `exact` challenge as equivalent. Sources: [exact EVM specification](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/specs/schemes/exact/scheme_exact_evm.md), [current exact client](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/typescript/packages/mechanisms/evm/src/exact/client/scheme.ts).

Official core filters terms by registered schemes, applies policies, then selects an option; its default selector takes the first. `onBeforePaymentCreation` can abort before scheme signing. These are useful gates, but do not provide a durable task budget automatically. The fetch wrapper handles a 402 and returns the paid retry response; it does not establish an evidence replay contract, refund promise or successful-settlement interpretation for the task. Sources: [core client](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/typescript/packages/core/src/client/x402Client.ts), [fetch wrapper](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/typescript/packages/http/fetch/src/index.ts), [buyer quickstart](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/docs/getting-started/quickstart-for-buyers.mdx).

## Limits before automatic signing

Implementation options, pending owner policy:

- Resolve data needs to a configured provider operation. Treat model-proposed URLs, payees and prices as untrusted suggestions. Bind the selected transaction hash and evidence type locally to that operation, and verify returned evidence belongs to the requested transaction/chain.
- Validate actual destination origin/path/method and redirect behavior, x402 version/scheme, payment network, canonical token address/units, expected recipient, transfer method/extensions, authorization expiry, per-purchase ceiling and remaining task allowance **before** signing. A token name or dollar-looking description is not sufficient. Also validate trusted inference origin, fixed asset, deployment pins and entitlement count before proving.
- Reserve task allowance atomically before calling either authorization engine. Policies can filter challenge terms and the before-creation hook can gate signing, but request origin/method/body must be retained by the surrounding operation. Never rely solely on the server-declared resource URL. A refusal to pay should return a partial report or a bounded stop, according to owner policy.

These gates follow from the request-context gap and payment selection hooks documented above; the specific allowlist and ceilings are not selected by this research.

Keep separate counters for `exact` token minor units and inference entitlements. Optional display estimates may express a common currency, but cannot substitute for either counter. Also bound tool steps, purchase attempts, wall time and trace/input bytes: free retries can still loop, and paid retries can still generate new authorizations. Existing gateway provider-cost ceilings protect the operator's dispatch budget; they do not implement the principal's investigation budget. Source: [service-class cost ceiling](../../ts/service-class.ts), [completion admission](../../ts/claim-completion.ts).

Provider availability and payment network require explicit review. The sibling [Find a useful x402 execution-data source for Base transactions](https://github.com/mangekyou-labs/haze-api/issues/40) investigates live quotes and delivery. Its reported Alchemy challenge includes Base mainnet payment terms even for a Base Sepolia resource path; that is not permission for a testnet demo to sign a mainnet authorization. Consult that ticket's cited asset for the exact quote and its delivery limitations, and make the permitted payment network part of the owner's policy.

## Completion, retries and cancellation

**Local slot retirement is not a server credit charge.** `BaseSlotLedger.commit` means never reuse a slot after a valid proof might have escaped. It occurs before HTTP send. Proof failure releases a provisional slot. A network failure or a subsequently cancelled server claim does not roll back the local committed slot. Conversely a gateway claim consumes a credit only after a successful response has been buffered, encrypted replay staged, and server commit confirmed. Report these as separate facts. Sources: [local ledger](../../packages/zk-credits-sidecar/src/slot-ledger.ts), [payment factory](../../packages/zk-credits-sidecar/src/base-sidecar.ts), [claim completion](../../ts/claim-completion.ts).

The Base client caches a pending payload and RSA replay key by canonical method, URL, exact body and full requirements, and shares in-flight proof generation for that key. Interrupted response reads retain the entry; complete body reads remove it. A committed retry can return 409 with replay available; the client retrieves and decrypts `/x402/replay`. Cache retention is at most 24 hours and 64 pending payments, **in process memory**. Restart, eviction, changed body or refreshed `issuedAt` terms can lose the same-payload retry path or produce a new slot/proof. Fresh timestamp validation is five minutes, so 24-hour replay storage must not be advertised as a universal 24-hour ability to repeat the paid completion request. Sources: [pending/replay handling](../../packages/zk-credits-sidecar/src/base-sidecar.ts), [challenge freshness](../../packages/x402-zk-prepaid/src/index.ts), [gateway](../../ts/zk-prepaid-gateway.ts).

Before ready, gateway dispatch failure attempts fenced cancellation; cancelled claims do not consume server credits. Failure after ready is commit ambiguity: hold and reconcile rather than cancel or redispatch. The completion timeout races a promise; it does not abort the underlying provider request or add a caller AbortSignal to the provider adapter. Closing a task or HTTP transport is not evidence that no dispatch or settlement occurred. Sources: [completion timeout/cancellation](../../ts/claim-completion.ts), [provider transport](../../ts/providerAdapter.ts), [claim-state decisions](../../packages/x402-zk-prepaid/src/claim-lifecycle.ts).

For EIP-3009, the nonce can be spent once onchain; this prevents charging the **same authorization** twice. It does not make two different signed retries one purchase, ensure response delivery, or promise a refund. After an interrupted paid request, do not convert a fresh challenge into a new signed payment solely because no body arrived. Preserve the exposure, consult the provider's receipt/status/replay contract and, where appropriate, check authorization consumption/transaction receipt. Chain evidence confirms payment, not correct trace delivery. HTTP abort does not cancel an authorization already delivered to a server. Sources: [EIP-3009 settlement specification](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/specs/schemes/exact/scheme_exact_evm.md), [official nonce diagnosis](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/python/x402/mechanisms/evm/exact/eip3009_utils.py). No provider refund or end-to-end idempotency was established by this investigation.

The custom client's `settlement_confirmed` metric checks presence of `PAYMENT-RESPONSE`, without decoding success or validating its contents. It returns HTTP responses even when that header is missing. The investigator needs explicit, scheme-specific outcome parsing and evidence-body validation; aggregate metric increments are not sufficient receipts. Source: [custom client settlement observer](../../packages/x402-zk-prepaid/src/index.ts).

## Concurrency and durable accounting

Within one `BaseSlotLedger` instance, allocation excludes provisional/committed slots and writes are serialized by `writeChain`. On open, the file is read once; there is no file lock, reload on allocation or compare-and-swap. Two processes, or two independently opened instances sharing `base-slots.json`, can therefore allocate the same slot and overwrite each other's snapshot. Proof serialization is per process and cannot fix this. Source: [ledger implementation](../../packages/zk-credits-sidecar/src/slot-ledger.ts), [proof coordinator](../../packages/zk-credits-sidecar/src/proof-coordinator.ts).

Options are a single runtime owning a credential/ledger and serial task accounting, or explicit shared storage with process locking and atomic reservations. Do not create multiple independent runtimes for one credential as a shortcut. Cross-device copies of the same credential also need an explicit ownership story. Current file accounting records slot numbers, not the credential identity or purchase/task status; the inspected allowance is 250 slots. Sources: [ledger file](../../packages/zk-credits-sidecar/src/slot-ledger.ts), [shared allowance](../../packages/zk-credits-shared/src/base.ts), [runtime state path](../../packages/zk-credits-sidecar/src/local-x402-agent.ts).

A proposed task journal can distinguish authorized exposure, confirmed spend, delivered/validated evidence, rejected purchase, and unknown outcome. It must reserve concurrently and survive restart if restart recovery is promised. Keep unknown exposure held until a definitive outcome; a wallet balance snapshot alone is not a task budget. These are new seams, not current product guarantees.

## Local setup, published behavior and privacy

The existing setup imports an activated credential into native OS credential storage, installs verified proving artifacts and configures a Base Sepolia witness source. Runtime setup requires Node 20+, artifacts, a funded/unexpired credential, RPC or a supplied witness file, and writable state. Credential-store failure has no plaintext runtime fallback. The downloaded passwordless recovery file remains a bearer capability. The new exact buyer additionally needs a signer and a balance of the accepted token on the payment chain; current `setup x402` supplies private-credit runtime setup, not that wallet provisioning. Sources: [package](../../packages/zk-credits-sidecar/package.json), [runtime](../../packages/zk-credits-sidecar/src/local-x402-agent.ts), [credential storage](../../packages/zk-credits-sidecar/src/credential-store.ts), [setup](../../packages/zk-credits-sidecar/src/setup-config.ts).

Registry read on 2026-10-07 reports `zk-credits` latest **0.2.11**, and its tarball includes `dist/local-x402-agent.js` and CLI diagnostics text. This contradicts the shared-tree untracked release note saying 0.2.11 is unpublished; that note is stale evidence. Published tarball: [registry metadata](https://registry.npmjs.org/zk-credits/0.2.11), integrity `sha512-RybQoVV6Kg1h68U5kngw2XrzesePU6eamkFEejbEce5qnV1VcC7KLU+/wUYCXSpB0UjID3jepBmvGNqI8gZqVg==`. Its local-agent JS SHA-256 is `4cf58067a193b881193240790c997ca3d9c440ed2cea78c0ec0d93b2cb9e85de`; CLI JS is `cf9174eb08c85b8ab32f138d8a46f210d158c68419cd57e041cdeda50fad479b`. Inspection was static; no published runtime or paid-flow test was run. Do not infer parity with every dirty source change from version equality.

Repository builds bundle matching shared credential code but leave `@x402/core`, `@zk-credits/x402-zk-prepaid`, `snarkjs` and native keyring external. Build tooling also reads a local launch RPC to replace the default RPC placeholder. This makes an arbitrary clean checkout build different from installing a published artifact; local build instructions need their prerequisites and public deployment pins checked. No launch secret contents were read for this research. Source: [bundle script](../../packages/zk-credits-sidecar/scripts/bundle.mjs).

The private-credit proof hides ordinary payer/credential linkage, not request content. The gateway/provider see inference content and network metadata. An execution-data seller sees the transaction query and standard exact payer; token settlement is public. Including the same transaction hash in both paid evidence request and inference prompt can correlate a task even if the credential proof is unlinkable. A dedicated payer reduces reuse but does not give proof-style privacy. Sources: [private-credit glossary](../wayfinder/base-zk-credits-pilot/CONTEXT.md), [exact payload specification](https://github.com/coinbase/x402/blob/dd927a26cfefc98c24b3ec38b3a8f204dad0c60d/specs/schemes/exact/scheme_exact_evm.md).

Current lifecycle observers intentionally emit closed enums and aggregate counts, with no exchange identifier, request/proof/credential fields. Task receipts should live locally with an explicit retention boundary; do not export wallet-to-proof joins, prompts, trace payloads or credentials into those aggregate metrics. Source: [lifecycle contract](../../packages/x402-zk-prepaid/src/lifecycle.ts). The operator can show useful receipts and spending in a report without changing gateway metrics into a per-principal ledger.

## Candidate implementation seams and failure matrix

Possible modules are: evidence acquisition/validation; a task controller holding the bounded conversation; a policy gate and durable task budget; a standard-exact buyer retaining authorization and settlement outcomes; the existing request-aware prepaid inference client; and a report builder requiring evidence citations and explicit uncertainty. Tool handlers return facts to the controller and cannot directly authorize purchases. Choosing how autonomous those purchases are remains an owner decision.

| Trigger | Existing behavior or evidence | New investigator responsibility |
| --- | --- | --- |
| Invalid tx/chain or public RPC unavailable | Current demo has no transaction validation/data tools | Stop or partial report before purchase; distinguish missing data from successful execution |
| Provider quote exceeds limits or changes recipient/token | Core policies/hooks can refuse; no task policy exists | Validate quote and actual operation before authorization; keep explicit refusal reason |
| Trace too large, malformed, or for a different transaction | Service has input/output bounds; no trace validator | Verify evidence identity/shape, extract bounded facts, record omissions; payment success cannot imply usable evidence |
| Model returns invalid schema/tool arguments | Request shapes are accepted; no semantic executor | Validate locally, cap repair turns, reject uncontrolled URLs or tool invocation |
| Proof generation or self-verification fails | Provisional slot released; no payable claim | Record no server charge; bounded local retry, no automatic switch to another payment scheme |
| Valid proof retired locally, send fails | Local slot remains committed; server outcome unknown | Preserve exposure; same-payload recovery where available, never equate retirement with confirmed server charge |
| Provider dispatch fails before ready | Fenced cancellation attempted; credit not consumed on confirmed cancellation | Separate dispatch failure, cancellation success and unknown state; don't assume local slot reusable |
| Inference commit uncertain after ready | Held `ready` state, ambiguous commit response | Reconcile existing claim; don't cancel or dispatch a replacement automatically |
| Paid exact response interrupted or receipt missing | Wrapper returns/rejects transport; no universal provider replay guarantee | Hold authorization exposure, reconcile settlement and provider delivery, require explicit contract before retrying |
| Exact settlement succeeds but evidence unusable | Payment protocol proves transfer, not correctness/refund | Report paid-but-unusable evidence; follow provider-specific refund terms if any, not an assumed refund |
| Operator cancels while signing/request is in progress | No universal revocation via HTTP abort; provider timeout doesn't abort upstream | Stop creating new authorizations; preserve and reconcile those already exposed |
| Concurrent processes share credential/state | Current file ledger lacks cross-process exclusion | Single owner or atomic shared store; reserve both task budgets before signing |
| Task restarts or pending cache expires | Replay keys/payload caches are in memory | Define restart promise and durable journal/key storage boundary, or stop with explicit unrecoverable/unknown result |
| Required evidence unavailable within budget | No current bounded-report behavior | Produce uncertainty/evidence gaps with the spending outcome; never fabricate a trace or definitive cause |

This research establishes integration constraints. It does not pick a trace seller, authorize spending, promise mainnet availability, or select task ceilings, retry/refund policy or report UX.
