# Base transaction investigator

The local runtime investigates mined failed EVM transactions on Base mainnet or
Sepolia. The fixture CLI needs no wallet, credential, inference, RPC or payment:

```sh
npm ci --prefix examples/base-transaction-investigator
npm test --prefix examples/base-transaction-investigator
node examples/base-transaction-investigator/cli.mjs 8453 0x79c9d880aa711cbfea0f45739850e1a440a0f54274b19cbaef6fdcbf3a7007f1 /tmp/haze-first-investigation
```

Node 20+ and installed/built checkout dependencies are required; see the
[walkthrough](walkthrough.md) for dependency preparation and actual output.
The unified entry builds investigator bindings and runs controller, injected
transport, subprocess ownership/crash and real service-class checks. The
[manifest](acceptance-manifest.json) maps 13 controller cases and four authentic
cases; recorded-fixture acceptance passes. See [validation](../../docs/wayfinder/base-transaction-investigator/implementation-validation.md).

## Installed live command (local candidate)

After ordinary `zk-credits setup` with an activated credential, use the reviewed
locally packed candidate:

```sh
zk-credits investigate --chain base 0x79c9d880aa711cbfea0f45739850e1a440a0f54274b19cbaef6fdcbf3a7007f1
```

`base-sepolia` is also supported. The command fetches live public RPC and original
public execution evidence, with no fixture fallback or exact trace purchases.
It pins the prepaid gateway/service class and caps the task at three requests
and three slots. Use the credential sequentially; stop Codex and other runtimes
first. Existing OS credentials, setup and canonical ledger are reused. Missing
credentials require setup; ownership conflicts require stopping the other runtime.
RPC/model errors produce an honest partial report. Unknown outcomes block further
proofs; running the same transaction again recovers its local report without
spending again. Zero or unknown consumption exits unsuccessfully for the live gate.

Reports distinguish Base mainnet evidence from Base Sepolia bundle funding and
offchain credit consumption. Only this invocation's challenge and confirmed
settlement observations count as payment evidence. Registry parity and public
release remain separate. See [founder validation](../../docs/wayfinder/base-transaction-investigator/founder-live-validation-2026-10-07.md).

## Integration

Import `createInvestigator` from `investigator.mjs`. Owner configuration is
`{stateDir,rpc,policy,provider?,inferenceFactory?,clarification?,inferenceStatus?}`;
call `investigate({schemaVersion:1,chainId,transactionHash})`, inspect `journal()`,
then `close()` in `finally`. No input URL, wallet, deployment or budget override
is accepted. RPC exposes fixed transaction/receipt/block/revert operations.
`provider` exposes explicitly simulated quote/acquire; exact signing is disabled.
`policy.trace` pins endpoint, POST, asset, payee and individual/exposure ceilings;
`policy.executionDataPaymentChain` is independent of the investigated chain.
`purchase.test.mjs` and `inference.test.mjs` exercise these public interfaces.
Provider/model text never establishes factual truth.

Real prepaid inference needs a pinned local source transport build, verified
circuit/artifact manifest, activated unexpired OS-stored credential, writable
canonical authoritative state, witness RPC or verified witness file, fixed gateway
and service class `coding-deepseek-v4-flash-v1`. Linux needs Secret Service.
Dedicate the credential to this runtime; do not simultaneously use it with Codex,
the starter or another device. `localPrepaidInferenceFactory(options)` imports
`zk-credits/x402`; resolve it to the reviewed local build exposing
`prepareLocalX402Agent`. Source declares 0.2.11; equal versions do not prove
published-package parity. Registry parity was not checked here.

The runtime owns the credential before journal/ledger access and reserves actual
bounded request bytes/terms before proof. `recover(id)` reads validated local
artifacts without network/proof/replay; restart never resumes a task.
`reconcile({investigationId,attemptId})` checks a documented nonauthorizing status
operation only; see [the adapter contract](RECONCILIATION.md). No live status API
is claimed. The runtime holds one dedicated transport until `close()`.

## Separately authorized prepaid smoke

```sh
npm run smoke:prepaid --prefix examples/base-transaction-investigator
```

Default result is SKIP before configuration, credentials or network. Only after
separate consumption authorization, set
`INVESTIGATOR_AUTHORIZE_PREPAID_CONSUMPTION=yes` and
`INVESTIGATOR_SMOKE_CONFIG=/absolute/private/config.json`; see
[configuration and evidence limits](prepaid-smoke.md). This handoff ran SKIP only.
Activation, live proving/model calls, package parity and provider delivery were
not checked. Offline doubles cannot establish them.

## Accounting, evidence and privacy

Bounds: one trace, three model requests, eight tools, 120 active seconds, one
clarification (human wait excluded, then block revalidated), five inference slots.
Execution data allows at most 5000 USDC minor units per purchase, 10000 total
(six decimals, simulated). Reports separate confirmed simulated/live USDC,
held exposure and settlement from delivery; inference reports requests,
allocated/provisional/retired slots, confirmed consumption and unknown outcomes.
Elapsed time never releases unknown exposure. The last report chance is reserved.

Evidence responses are capped at 4 MiB, summary at 48 KiB, model body at 96 KiB.
Reports cite stable IDs, label hypotheses/omissions, reject invented claims and
invalidate old findings on reorganization. Historical replay is not original
execution. [Authentic recordings](fixtures/README.md) establish failed receipts,
original nested calls, revert bytes and an execution error. Explicit unverified
metadata describes one provider at collection time. Synthetic faults stay distinct.

Owner-local directories/files use 0700/0600. Accounting excludes prompts,
responses, proofs, signatures, secrets and recovery material; evidence artifacts
are separate. Retention is bounded to 100 resolved tasks, preserving unresolved
reservations. Providers see content and traffic metadata; wallet purchases may
link users. Local exclusion does not coordinate another device. Private-credit
proof privacy does not cover the whole investigation.

Real purchases remain disabled. The [future live gate](../../docs/wayfinder/base-transaction-investigator/implementation-spec.md#live-delivery-gate-and-documentation-handoff)
needs a permitted Base Sepolia route, explicit spend permission, pinned exact
EIP-3009 terms, redacted attempt identity, validated settlement, delivered trace
digest and tx/block binding, validated delivery and a cited report answering its
recorded gap. A quote, payment alone, fixture or prepaid-only smoke cannot pass.
