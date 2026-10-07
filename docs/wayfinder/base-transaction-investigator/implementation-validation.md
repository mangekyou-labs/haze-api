# Foundation implementation validation

Implemented issues #46–48 on `integration/base-investigator-46-48`, in the isolated `/private/tmp/haze-investigator-integration` worktree. The original dirty checkout and index are preserved. Baseline snapshot `7aa1ff1` contains pre-existing local work; implementation review compares against that snapshot. The integration branch has not been published.

## Delivered behavior

- #46: exclusive credential runtime ownership before ledger access across local launchers; one canonical local state directory; recovery only after verifying owner PID death; closed clients refuse new requests. This does not coordinate another machine using the same credential.
- #47: awaited authorization for each fresh proof using actual request bytes and terms; attempt-scoped nonsecret accounting events; durable failures stop dispatch; conservative settlement validation and exact-request replay.
- #48: runnable standalone public-evidence investigator with an authentic recording, bounded RPC/evidence, reproducible revert decoding, canonical block recheck, evidence-linked partial reports, and owner-local journal/artifact retention. No model, payment or credential is required.

## Review

| Review axis | Findings and resolution |
| --- | --- |
| Standards | Formatted investigator and extracted request validation, bounded RPC, and journal persistence helpers. Removed trailing whitespace. |
| Spec | Corrected authorization forwarding during runtime integration. Always recheck canonical binding after optional replay failures; invalidate facts when revalidation fails. Reject contradictory replay identities and incomplete hex bytes. |

Persistence repairs distinguish local storage failures from RPC failures, stage journal updates before atomic replacement, and retain accepted history on write failure. Tests also verify invalid input privacy and the authentic fixture manifest digest.

## Validation

- Sidecar TypeScript and executable bundle build passed.
- Sidecar suite: 129 tests passed; 3 skipped (29 files passed, 1 skipped).
- Investigator offline suite: 28 tests passed.
- Offline CLI fixture command returned a partial `insufficient_evidence` report using five bounded RPC operations.
- Baseline diff whitespace check passed.

The first combined validation ran build and tests concurrently, causing the existing child-process test to time out while its generated executable was being replaced. The full sidecar suite was rerun after build completion.

These checks do not establish live prepaid inference, paid execution-data delivery, or later investigator tickets. Those remain separate acceptance gates.

## Investigator implementation #49–55

Integration branch `integration/base-investigator-49-55` preserves the original
checkout; review baseline is `ab8cfaa` (foundations excluded). #49 implements
request-bound prepaid interpretation; #50 simulated trace acquisition and
validated citations; #51 conservative exposed-purchase handling; #52 bounded
sequential tools/clarification; #53 guarded durable recovery; #54 explicit
nonauthorizing reconciliation; #55 current-use documentation and unified checks.
Implementation is local and unpublished. At the initial validation checkpoint,
#50/#55 acceptance remained partial; the follow-up below closes the recorded
authentic-fixture gap.

The exercised unified command is `npm test --prefix examples/base-transaction-investigator`:
133 controller tests passed, including default smoke SKIP; 24 actual lower-level
injected transport/investigator integration/runtime ownership tests passed;
35 real service-class admission tests passed. The 13-case
[manifest](../../../examples/base-transaction-investigator/acceptance-manifest.json)
maps exercised public assertions; subprocess crash stages and live-owner
exclusion are included. All are offline; synthetic faults, simulated purchases
and authentic recordings remain distinct. The sidecar full suite after #53–54
passed 131 tests, with 3 skipped; source TypeScript/executable build passed.

The exact README coding sample failed duplicate-log as expected (distinct-log
passed); the documented fix plus casing/different-chain assertions passed all
four. The fresh-state fixture CLI produced five tools, a factual partial
`insufficient_evidence` report, historical replay citations, zero purchase and
zero inference accounting. The three documented simulated trace/skipped
purchase/held-outcome tests passed. Shared/x402 builds and example locked install
were exercised in the isolated checkout; sidecar/ts dependencies reused installed
checkout packages. No clean-install registry parity is claimed. Diff whitespace
check passed. The local sidecar build used an ignored inert RPC URL, not owner
secrets; it does not validate a live endpoint.

Authentic mainnet and four owner-authorized Sepolia read-only recordings establish
failed receipt/block identities and historical replay. RPC trace methods were
unavailable; primary explorer endpoints refused access. At that checkpoint, original nested failure,
original execution-error and primary contract verification recordings were
missing. Full gas consumption plus secondary explorer interpretation is not
original out-of-gas proof; unavailable verification metadata does not establish
an unverified contract. Synthetic trees cannot satisfy these recording criteria.

Configured prepaid smoke was **SKIP**, before configuration/credential/network
access. Native activation, live proving/inference, package parity, receipt capture,
model quality and paid provider delivery were not verified. The transport
observer exposes validated commit observations, not raw receipt bytes. Real exact
signing, live execution-data payments, deployment and package publication remain
disabled/unperformed. A permitted Base Sepolia route and explicit spend approval
plus actual bound settlement/delivery/report evidence are required for the
separate future live gate; prepaid smoke alone cannot pass it.

Final review against the foundation fixed point found zero hard Standards
violations and two maintainability findings; both are resolved by shared
execution-evidence binding validation and shared nonauthorizing status-check
mechanics. Live collection, model tools, recovery, and canonical rechecks accept
equivalent hexadecimal casing while preserving transaction identity and caller
stopping behavior. Active-task and explicit owner-session budgets remain separate.

The Spec review found two P2 defects, both resolved: unsupported pending,
successful, and invalid requests retain unsupported coverage after restart, and
legacy journals without coverage conservatively recover as unsupported. Definitive
failed inference settlement remains failed through later unknown or contradictory
confirmed observations, while the slot remains permanently retired. Public
request/report, durable recovery, and injected transport regressions verify these
behaviors; recovery makes no new authorization. The final unified offline run
passed 133 controller, 24 injected transport/runtime, and 35 service-class tests.
Diff whitespace check passed. At that checkpoint one external authentic-fixture
acceptance gap remained; no original trace, execution-error, or contract
verification recording had been fabricated. Sidecar production code was unchanged by review fixes.


## Authentic-fixture follow-up

The follow-up on `integration/base-investigator-49-55`, starting at `662d612`,
closes the recorded-evidence acceptance gaps for
[Buy one simulated trace to answer a recorded diagnostic gap](https://github.com/mangekyou-labs/haze-api/issues/50)
and [Ship the exercised investigator walkthrough and acceptance handoff](https://github.com/mangekyou-labs/haze-api/issues/55).

Read-only Tenderly public API recordings now preserve the original nested failed
calls and `Error(string): p address!` for the existing Base mainnet transaction,
an original root `out of gas` error for a second failed mainnet transaction,
and explicit provider-local `unverified_contract` metadata for the deepest
callee. Raw response bytes, source URLs, SHA-256 digests, expected facts and
transaction/block identities are retained in the
[execution manifest](../../../examples/base-transaction-investigator/fixtures/execution-manifest.json).
The normalized call trees retain the original recorded fields and paths; no
missing inputs, outputs, errors or causal explanations are invented. Verification
status describes that provider at collection time, not every registry or the
historical execution date.

Five new checks verify artifact digests and lossless normalization, then exercise
four authentic cases through the public investigation/report interface: nested
failure, execution error, unverified contract, and unavailable original trace.
They assert validated citations, durable journal outcomes, duplicate reuse,
simulated purchase accounting, zero live spend, no signatures, and no inference
runtime allocation. Simulated quotes and settlement observations remain synthetic,
separately labelled from the recorded execution evidence. The missing-trace case
remains partial and authorizes nothing.

The unified command passed **138 controller tests, 24 injected transport/runtime
tests and 35 service-class tests (197 total)**; authentic fixture acceptance is
**PASS**. Sidecar TypeScript checking passed. The updated walkthrough documents
these exercised cases. Configured prepaid smoke remains **SKIP**; live exact
signing and paid delivery remain disabled. No deployment, package publication,
owner credential access or live inference/payment was performed. The original
dirty checkout is preserved and the integration branch remains unpublished.


Follow-up review compared `662d612...091d9e9`. Standards found one documentation
consistency issue spanning stale entry README and fixture wording; both were
corrected and independently verified, leaving zero findings. Spec found zero
substantive gaps or scope creep. Both reviewers independently exercised the five
new fixture checks. Final diff whitespace checks passed.

Resolution comments:
[Buy one simulated trace to answer a recorded diagnostic gap](https://github.com/mangekyou-labs/haze-api/issues/50#issuecomment-6039165676)
and [Ship the exercised investigator walkthrough and acceptance handoff](https://github.com/mangekyou-labs/haze-api/issues/55#issuecomment-6039168342).
