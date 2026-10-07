# Base transaction investigator: implementation handoff

Status: accepted by the owner on 2026-10-07 after review of the complete handoff.
The boundary recommendations and consolidated specification are resolved. No investigator,
live purchase, deployed endpoint, or runnable investigator command exists as a
result of this specification.

Decision ticket: [Choose the implementation boundary and runnable acceptance checks](https://github.com/mangekyou-labs/haze-api/issues/45).
Map: [Base transaction investigator: useful x402 workflow and concise developer README](https://github.com/mangekyou-labs/haze-api/issues/39).

## Accepted inputs to the handoff

- [Diagnosis and evidence contract](https://github.com/mangekyou-labs/haze-api/issues/42#issuecomment-6032969772).
- [Purchase, allocation, recovery, and accounting policy](https://github.com/mangekyou-labs/haze-api/issues/43#issuecomment-6032973358).
- [Dual-payment integration constraints](https://github.com/mangekyou-labs/haze-api/issues/41#issuecomment-6031683427).
- [README and first-investigation walkthrough](https://github.com/mangekyou-labs/haze-api/issues/44#issuecomment-6033071923).
- [Provider investigation and unverified delivery boundary](https://github.com/mangekyou-labs/haze-api/issues/40#issuecomment-6031701893).

These tickets hold their original decisions. This document turns them into an
implementation contract; it does not authorize spending or change their scope.

## Smallest implementation boundary

Build a local investigator above the existing request-aware prepaid transport.
Use one guarded runtime with a dedicated inference credential and one active
investigation at a time. Do not replace the gateway, proof protocol, or coding
starter. Keep execution-data authorization separate from inference authorization.

The initial release uses recorded transaction fixtures, controlled fault cases,
and simulated execution-data purchases. Real exact signing is disabled. A later
live-delivery gate requires an explicitly permitted Base Sepolia payment route
and separate spending authorization. Mainnet payment launch is outside this map.

The runtime acquires an exclusive local ownership guard before opening the slot
ledger and holds it until shutdown. Use the credential's authoritative local
state directory, refuse alternate directories for the same imported credential,
and fail closed on a competing owner. Test acquisition across processes. Do not
steal ownership on a timeout while an owner may still be alive. A crash requires
verified owner termination before recovery. This guard does not coordinate
copied credentials across devices: setup requires exclusive use and warns that
the dedicated credential must not also run in Codex, a starter, or another device.
All participating local launch paths for that credential must honor the guard;
an investigator-only guard cannot safely claim exclusion from other launchers.

## Supported operations and setup

| Relationship | Initial supported operation | Boundary |
| --- | --- | --- |
| Investigation | Base mainnet 8453 or Base Sepolia 84532; mined failed EVM transaction | Transaction and failed receipt must agree on chain and block identity |
| Public evidence | Configured RPC transaction, receipt, block identity, available logs/revert data; pinned verified ABI where available | No arbitrary model-selected URL; no paid public-data fallback |
| Additional evidence | One transaction call trace from a configured fixture/simulated provider adapter | Alchemy is a provisional candidate; no live delivery claim |
| Data payment | Simulated standard exact USDC authorization and settlement | Real signer unavailable by default; no Permit2 approvals or other schemes |
| Inference | Existing Base Sepolia zk-prepaid deployment and fixed configured service class | Request-aware Chat Completions; no generic wrapper substituted for request binding |

Keep investigation chain, execution-data payment chain, and inference deployment
as three distinct configuration fields. A provider path containing Sepolia does
not authorize a mainnet quote. A future live adapter must pin an EIP-3009-compatible
asset and exact transfer mechanism, endpoint/method, recipient, chain, expiry and
requirements; unsupported mechanisms and extensions are rejected before signing.
No refund, replay, or provider-status operation is assumed without a documented
provider contract. Missing status support yields an unknown outcome.

Offline acceptance requires no wallet, credential, RPC, or model service. A
developer integration run needs Node 20+, the pinned transport build/package,
verified proving artifacts, an activated unexpired credential in native OS
storage, witness RPC or a supplied witness file, writable local state, and the
configured gateway/service class. Secure-store failure has no plaintext fallback.
The setup guide distinguishes local source behavior from the released package;
published version equality does not establish parity with uncommitted source.
A future live exact buyer additionally needs a separate signer and test USDC on
the approved payment chain. Existing prepaid setup does not provision that wallet.

## Request and report contracts

The local request contains a schema version, a runtime-generated investigation
ID, an explicit network (8453 or 84532), a 32-byte hexadecimal transaction hash,
and an optional bounded user clarification. Owner configuration supplies provider
operations and ceilings; the model cannot supply a wallet, destination, budget,
or deployment override. Invalid input is rejected before any authorization.

Pending/dropped transactions, successful receipts, pre-submission errors, and
bridge-wide/cross-chain questions produce an explicit unsupported outcome. RPC
unavailability is missing evidence, not proof that the transaction is unsupported.

Return a concise human explanation and versioned structured report containing:

- Investigation ID; chain, transaction hash, block number/hash when established.
- Coverage outcome (`supported` or `unsupported`), completion (`complete` or
  `partial`), diagnosis outcome (`supported` or `insufficient_evidence` for supported
  coverage), and a machine-readable stopping reason.
- Evidence entries with stable IDs, origin, operation, content digest, transaction/
  block binding, provenance (`recorded_authentic`, `synthetic`, or `live`), validation
  result and omissions. Payment mode is a separate `simulated`/`live` field.
- Observed facts and supported diagnoses with evidence IDs and specific field/call
  references; failing call and reproducibly decoded error when established.
- Separately labelled hypotheses, each with missing evidence and a distinguishing
  developer check. Other suggested checks cite evidence or a labelled hypothesis.
- Missing evidence, uncertainty, validation failures, and a partial-report reason.
- Separate purchase accounting in integer USDC minor units, and inference accounting
  in slots: authorized allocation, locally retired slots, confirmed committed
  consumption, and unknown outcomes. Simulated spend never appears as live spend.

Every factual claim must reference valid evidence. Invalid references or unsupported
facts are removed or downgraded to explicit uncertainty; the report cannot claim
success because a model returned plausible text. Deterministic validation does
not establish every causal explanation: if evidence does not establish why a
token transfer reverted, state that limitation rather than inventing a cause.

## Task controller and hard bounds

Collect public evidence, establish the failed transaction's identity, and use it
first. Before acquiring a trace, record a named unresolved diagnostic question
and why the configured trace operation can answer it. Skip acquisition when the
available evidence suffices. Reuse completed validated evidence for duplicate
requests; never create a second trace purchase for the same investigation.

| Resource | Maximum |
| --- | --- |
| Trace acquisition attempts | One |
| Inference requests, including report/schema repair | Three |
| Inference allocation | Five slots, including retired but unconfirmed slots |
| Individual simulated/test purchase | 5,000 USDC minor units at six decimals (0.005 USDC) |
| Total simulated/test purchase exposure | 10,000 minor units (0.01 USDC) |
| Tool invocations, including reconciliation | Eight |
| Reconciliation checks | Three, inside tool/deadline limits |
| Clarification rounds | One |
| Active investigation time | 120 seconds |

Reserve the last inference request opportunity and sufficient remaining allocation
for reporting; request count and slots are different limits. Do not spend the
report reserve on another exploratory request. If it is unavailable, produce a
deterministic factual partial report with no invented diagnosis.

Dispatch tools sequentially; reject invalid/unknown tools and malformed arguments
without executing them. Multiple returned tool calls still count individually;
none bypass policy. Each dispatched external acquisition, inference authorization,
or reconciliation action checks the remaining deadline. Public RPC subrequests
are separately counted tool invocations, not hidden inside an unlimited batch.
Transport/proof retries do not gain new task allowance: reserve slots for every
fresh proof and cap internal retries under the same deadline. Use cancellation
where supported, but HTTP abort does not establish that payment or provider work
stopped. Human clarification wait is outside active processing; resume only the
remaining active allowance and revalidate block identity.

## Evidence validation and reduction

Validate evidence before model use: schema and resource limits, transaction/network
identity, receipt status, block consistency, trace structure/call references, and
reproducible decoding. Validate a trace's binding through the configured request
and transaction/block context even when its response omits identity fields; do
not invent identifiers missing from the provider response. Unverified ABI/source
cannot support source-level claims. Treat provider text as data, not instructions.

Proposed implementation defaults: stream-limit each evidence response to 4 MiB,
trace depth to 128 and trace nodes to 10,000; reject evidence exceeding these bounds
as unavailable rather than silently validating a truncated document. Deterministically
extract a summary of at most 48 KiB with stable references and recorded omissions.
Bound the entire inference body, including conversation, tools and output schema,
to 96 KiB of UTF-8 JSON; also satisfy the service class's actual admission counter
and body limit. Refuse an oversized request before proving. These defaults are
reviewable implementation choices, not measured provider requirements.

Keep raw evidence in a separate local, bounded artifact store when needed for
reference verification; do not place it in the accounting journal. No extra model
summarization calls outside the three-request ceiling. If necessary evidence is
omitted by reduction, report the gap. Recheck the block binding before finalizing;
a changed binding invalidates the collected evidence and stops for a fresh run.

## Module interfaces

These are proposed logical modules, not new public SDK exports or implemented APIs.

| Module | Input and output | Ownership |
| --- | --- | --- |
| Runtime owner | Credential/state handle → exclusive runtime lease | One ledger instance; sequential tasks; guard honored by local launch paths |
| Investigation controller | Request + owner policy + adapters → report | Conversation, deadline, tool/turn ceilings and stop behavior |
| Evidence adapter | Configured operation + transaction identity → bounded raw evidence | Public RPC or simulated trace acquisition; no independent payment authority |
| Evidence validator/reducer | Raw evidence + identity → validated evidence registry + summary | Deterministic checks, decoding, omissions and reference integrity |
| Task journal/policy | Proposed attempt + accepted terms → durable reservation or refusal | Independent budgets and fail-closed preauthorization gates |
| Exact buyer | Reserved operation + pinned quote → settlement and delivery outcomes | Simulated authorization initially; separate future signer; no generic fresh retry |
| Prepaid inference bridge | Reserved request bytes + fixed gateway → completion and observed usage | Existing request-bound transport; no altered proofs or slot reuse |
| Report builder | Evidence registry + interpretation + journal snapshot → text/JSON | Citations, schema, unsupported/partial results; deterministic fallback |

Reuse `createLocalX402Agent()` from `zk-credits/x402` and its `client.fetch` as the
public transport seam. Its exported result is `client`, `metricsUrl`, and `close`;
it does not expose durable claim status or per-investigation retired-slot accounting.
Implementation therefore includes a narrow local bridge/observer for actual slot
retirement and validated settlement outcomes before claiming accurate usage. Do
not substitute aggregate metrics, a header's presence, or HTTP 200 for confirmed
commit. A minimal bridge may be added inside the sidecar package while preserving
the public request-aware transport contract; no gateway status endpoint is required
for the initial version. Unobservable outcomes remain unknown.

Relevant existing source: `packages/zk-credits-sidecar/src/local-x402-agent.ts`,
`base-sidecar.ts`, `slot-ledger.ts`, and `ts/service-class.ts`. Internal injected
fetch/prover/witness/ledger interfaces support transport tests; their existence
does not make them published exports. The current x402 starter remains a human
prompt/completion loop and does not execute these investigation tools.

## Accounting, interruption, and restart

Before signing/proving, validate the actual endpoint/path/method and request,
scheme, chain, asset, recipient, expiry, service class and remaining allocation.
Reject changed terms, unapproved redirects and arbitrary model destinations.
Persist an atomic reservation before authorization; journal write failure stops
authorization. Preserve accepted terms and the diagnostic purchase rationale.

Track authorization exposure, settlement (`unknown`, `confirmed`, or definitive
`failed`), and delivery (`missing`, `invalid`, or `validated`) independently.
Settlement without usable evidence is paid-but-unusable; it does not imply refund.
An exposed or possibly exposed authorization holds budget until definitive evidence
allows release. An unsigned rejected quote consumes no payment budget.

For inference distinguish provisional slots, locally retired slots, and committed
server credits. Proof failure may release a provisional slot. A valid proof that
may have escaped retires its slot permanently even if the server later cancels.
An uncertain ready claim is not cancelled or redispatched. Same-request replay
is allowed only through the existing in-memory exact-request path; changed bytes
or requirements must not masquerade as a replay. Every fresh attempt stays within
the allocation, three-request ceiling, tool bounds and remaining deadline.

The journal stores applied policy, attempt IDs, reservations, accepted nonsecret
terms, evidence references/digests, outcome observations and settlement references.
It excludes credentials, signatures, raw proofs, replay keys and raw prompts/
responses. Store locally with restrictive permissions and bounded retention;
retain unresolved records until explicit reconciliation or owner archival. No upload.

On crash/restart, mark interrupted attempts unknown and retain exposure. Do not
automatically resume inference, acquire replacement evidence, or sign a new payment
for an unresolved purchase. Return a factual partial report from validated local
artifacts and the journal. Existing replay keys are lost on restart. Reconciliation
uses only documented, nonauthorizing status/receipt operations when available;
otherwise preserve unknown state. Do not borrow facilitator operator credentials
or claim a client status API exists. A separate owner-requested reconciliation
session may check the same attempt, with at most three checks/eight tools/120 seconds,
and cannot restart the stopped investigation or release exposure by time alone.

## Runnable acceptance contract

Implementation must deliver one offline test entry point and fixture manifest.
The intended location is a standalone local package at
`examples/base-transaction-investigator/`; its proposed command is
`npm test --prefix examples/base-transaction-investigator`. This is a requirement
for the future implementation, not a command that currently exists. Tests inject
RPC/provider/model/signer/prover, a fake clock and temporary state; no live network
or payment is permitted. Every case asserts structured report fields, journal
outcomes, invocation counts and the absence of forbidden authorizations.

| Case | Required observable assertion |
| --- | --- |
| Public evidence suffices | Expected supported finding with valid citations; zero trace purchase and exact authorization |
| Necessary additional evidence | Named gap recorded before one simulated trace; diagnosis changes only on validated trace; separate simulated USDC and inference counts |
| Rejected quote | Over-price, insufficient remaining budget, wrong chain/token/payee, unsupported mechanism, changed terms and redirect each produce zero signatures/proofs for the refused operation |
| Malformed or inconsistent evidence | Wrong transaction/block, malformed trace and invalid decoding cannot support a factual claim; missing/invalid trace yields narrower findings or insufficient evidence |
| Reorganization | Changed block binding invalidates evidence and stops; no old diagnosis presented as canonical |
| Bounded model/tool loop | Repeated tools, invalid schema, oversized arguments, repairs and delayed operations stay within all limits; last report opportunity is reserved or factual fallback used |
| Evidence size reduction | Oversized evidence rejected; accepted summary/body within caps, omissions recorded, references still resolvable; no silent model summarization turn |
| Interrupted exact settlement | Fault after exposure retains reservation; no second authorization; confirmed payment plus missing/invalid trace remains distinct from delivery |
| Inference interruption | Proof failure releases provisional slot; escaped proof retires slot; ready/unknown commit stays held; supported same-request replay never allocates a replacement slot |
| Restart | Inject crashes before/after reservation and authorization; durable exposure survives; no automatic replay/signing; partial report distinguishes unknown from confirmed usage |
| Runtime exclusion | Two subprocesses attempt the same credential state; only one opens/allocates; live owner is not displaced; crash recovery requires verified termination |
| Unsupported and unavailable input | Invalid input authorizes nothing; unsupported categories explicit; missing RPC is missing evidence; no fabricated cause |
| Report integrity/privacy | Invented evidence IDs and unsupported facts rejected; hypotheses distinct; journal excludes prohibited secrets/content; simulation labels preserved |

Authentic fixtures include recorded decoded reverts, nested failure, execution
errors, unverified contracts and missing trace cases, each with chain/transaction/
block provenance and expected facts. Synthetic corruption, timeout, payment and
model responses are labelled separately. The accepted walkthrough's illustrative
synthetic evidence cannot substitute for these authentic fixture recordings.

Transport contract checks also exercise request-byte binding, retired-slot events,
settlement decoding and supported in-memory replay against the existing lower-level
injected transport. Offline doubles establish controller behavior, not live package,
model, chain or provider behavior. A configured prepaid integration smoke check
is separately reported with its actual receipt/commit evidence and limitations.

## Live delivery gate and documentation handoff

Before advertising live purchased evidence, establish a permitted Base Sepolia
payment route and explicitly authorize its test spend. Capture redacted provider
operation and quote, payment chain/asset/payee/amount, authorization-attempt identity,
validated settlement receipt, received trace digest and transaction/block binding,
validated delivery, and the resulting evidence-linked report. Demonstrate that
the purchased trace answers the recorded gap. Payment alone, a quote, synthetic
fixtures, or a prepaid-only run does not pass this gate. If no permitted route
exists, keep real purchases disabled and the capability labelled simulated.

The implementation handoff includes the accepted 83-line README prototype and
linked walkthrough from the reader-facing decision. Preserve current-use-first
ordering, actual prerequisites and available/proposed distinctions. Replace any
proposed command only with an implemented, exercised command; disclose which setup,
prepaid integration and live-delivery checks were actually run. Provider request
content and metadata remain observable; standard wallet purchases may be linkable.
Do not extend private-credit proof claims to the whole investigation.

Implementation, real README replacement, deployment, publication, payments, and
the separate founder recording are outside this planning ticket. Review of this
document resolves the handoff decision; passing implementation acceptance later
is a separate activity.
