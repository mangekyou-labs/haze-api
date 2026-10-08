# Base Builder Grant demo video

Aim for 2–3 minutes: activate credits, connect a coding agent, and show a useful
task completed through Haze on Base Sepolia. Treat this as technical evidence.

## x402 use case: fix a Base USDC transfer indexer

Copy [the runnable indexer sample](../../examples/base-usdc-indexer/README.md) into a fresh demo repository. Its indexer double-counts repeated RPC logs.
Include fixtures for a duplicate log and two distinct transfers in the same
transaction. Show the failing test, then give the coding agent this task:

> Fix the Base Sepolia USDC transfer indexer. Deduplicate logs by chain ID,
> transaction hash, and log index; preserve distinct transfers in the same
> transaction. Run the tests and explain the change.

The agent reads files, buys the model calls it needs through Haze, edits the
indexer, and runs the tests. The result is a code diff and passing tests.
Prepaid credits bound its model-call budget without giving it a provider API
key or requiring a wallet signature for each call.

For the **same task run**, show reviewed aggregate evidence of the x402
exchange: HTTP 402 challenge → local spend proof → `PAYMENT-SIGNATURE` →
successful model response with `PAYMENT-RESPONSE`, plus the number of committed
claims. This uses Haze's custom `zk-prepaid` adapter; funding is on Base Sepolia
and individual calls consume offchain credits. Stripe sandbox tops up the
simulated balance separately.

## Recording checklist

- [ ] Prepare the Base USDC indexer sample and show its failing duplicate-log test.
- [ ] Activate a bundle and download the activated credential privately.
- [ ] Use the reviewed local candidate; reuse the existing configured credential and check readiness. Import privately only if setup is needed.
- [ ] Run the indexer fix through Codex; show the code diff and passing tests.
- [ ] Record: failing test → confirmed activation → candidate readiness → agent fixes and tests →
  x402 evidence from that same task. Confirm committed claims; keep raw payment
  payloads private.
- [ ] Label the prototype Base Sepolia and experimental. Describe the $5,000
  Base Builder Grant as the funding target, and name one concrete next milestone.
- [ ] Review the video for credentials, keys, proofs, nullifiers, request signals,
  private content, and identity-to-spend joins before sharing.
- [ ] Verify the current official grant round and submission requirements before
  applying. Keep a recorded demo separate from any submission or award claim.

## After downloading the activated credential

Requires Node.js 20 or newer and native OS credential storage. The recording machine already has a configured credential: reuse it. On a separate device needing setup, use the reviewed local candidate, replacing `/path/to/haze` below; import privately before recording.

```sh
ZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json \
  node /path/to/haze/packages/zk-credits-sidecar/dist/zk-credits.js setup codex
```

For the actual coding run, use the verified model/options in the live preflight report.

Setup handles packaged proving artifacts, the default release RPC, witness
checks, OS credential storage, and Codex configuration. An OS access approval
may appear. Stop if setup fails; use `zk-credits doctor` for diagnostics.
`zk-credits config rpc` is an optional recovery step for RPC problems.

The local sidecar candidate implements `zk-credits codex --task-evidence`.
Build and use that candidate as described in the sample README; the published
npm release does not yet include this flag. It launches a fresh sidecar on a
random loopback port with a private environment token, then prints only counters
from that process after Codex exits. `exchange_verified` means the agent exited
successfully and a settled model response was observed; review the actual diff
and passing tests separately. A [real paid coding rehearsal passed on 2026-10-08](grant-demo-live-preflight-2026-10-08.md):
four unchanged tests passed with five committed claims and five successful
responses. Use that report's verified invocation. [Hosted sandbox acceptance also passed](grant-demo-rollout-readiness-2026-10-08.md#hosted-acceptance-passed--0854-utc), including real Checkout/webhook delivery, funding, duplicate requests and reload recovery. The [founder demo command](base-zk-credits-founder-demo.md#perform-one-genuine-task)
performs a separate inference request; its summary cannot stand in for this
task's exchange. Show only reviewed evidence from the run being recorded.

## Sandbox activation before recording

Public Stripe TEST activation passed hosted acceptance on 2026-10-08 against [the approved funding design](../superpowers/specs/2026-10-07-grant-demo-sandbox-design.md). The [rollout report](grant-demo-rollout-readiness-2026-10-08.md) records real Checkout, webhook crediting, confirmed funding, duplicate delivery/activation and reload recovery:

- [x] Remove invite entry; expose test checkout to signed-in users.
- [x] Show simulated balance and each bundle's funding status.
- [x] For insufficient funder liquidity, show the sponsor wallet and faucet link.
- [x] Deduct the reserved simulated amount once after confirmed funding;
  recover failures and unknown outcomes without duplicate funding or deduction.

The acceptance bundle is funded for 250 calls and expires November 7, 2026. Show its confirmed activation; the sponsor pool is now empty, so another new bundle requires replenishment. A faucet supplies test USDC separately from simulated Stripe payments. No hosted timeout/restart fault was injected; ambiguous-outcome behavior has local test coverage and documented operational limits.

For recording, use the reviewed local sidecar and existing canonical configured credential. Do not import the browser acceptance credential over it or claim the recorded coding spends came from that browser bundle. Keep the onboarding acceptance and task-specific spend evidence distinct. Public npm 0.2.11 lacks the local evidence/investigator features; do not present the generic public install as feature-equivalent.

## Optional investigator segment — live prerequisite passed

Keep the coding demo above. [Package one founder-facing live investigator command](https://github.com/mangekyou-labs/haze-api/issues/56#issuecomment-6040500073)
provides the installed local candidate; [Verify a useful live diagnosis and its own prepaid exchange](https://github.com/mangekyou-labs/haze-api/issues/57#issuecomment-6051600225)
passed with two fresh installed invocations. The [2026-10-08 validation](../wayfinder/base-transaction-investigator/founder-live-validation-2026-10-08.md)
records build identity, separate Base Sepolia funding verification and recovery
checks. It supersedes the earlier failed attempt as the live gate's status;
neither that success nor closed fixture tickets establish a recorded clip.

Use a 30–45 second second segment only if the coding task and onboarding leave
room within 2–3 minutes. Otherwise keep the coding video at 2–3 minutes and
make a separate 60–90 second investigator clip. Close Codex before starting the
investigator with the same credential. An already configured credential needs
no repeated activation or setup. Use the reviewed local build identified in
the validation, rather than assuming an npm version contains the same code;
coordinate publication through [the release gate](https://github.com/mangekyou-labs/haze-api/issues/36).

The validated example command is:

```sh
zk-credits investigate --chain base 0xc4744cb2714fa9238da819c4299f091302c0dc170acb0886bb975234ac10c69b
```

A repeated hash can recover prior evidence and accounting without a new paid call.
The current preflight returned `partial (recovered_stopped)` for both hashes;
it did not regenerate the complete model report. The
[successful invocation report](../wayfinder/base-transaction-investigator/founder-live-report-2026-10-08.txt)
and [fresh rehearsal report](../wayfinder/base-transaction-investigator/founder-live-rehearsal-2026-10-08.txt)
each show one 402 challenge, validated model delivery, one confirmed consumed
credit and zero failed or unknown outcomes. If presenting these saved outputs,
label them as the validated run, not a new exchange during recording. A recovered
invocation's zero new credits cannot stand in for fresh payment evidence.

Suggested sequence: show the failed Base mainnet transaction, the installed
command and cited returned error, then its invocation-specific payment summary.
The primary example returned `AerodromeV3: insufficient received`; slippage is
a hypothesis, and inspecting swap calldata/minimum output is the next check.
Keep missing-evidence notices visible. Do not claim the underlying cause or
deepest failing call is established. In the balance-error rehearsal, identify
the token and transfer account before applying suggested balance checks.

Suggested narration:

> This transaction failed on Base mainnet. The investigator fetched public
> execution evidence and used Haze for the model call. Haze asks for a local
> proof when it returns 402, then confirms the response and one spent credit.
> This is our custom zk-prepaid adapter: test USDC funded the bundle on Base
> Sepolia, while model calls use its credits offchain. It does not pay for an
> external trace or work with every unmodified x402 client.

Recording work remains unchecked:

- [ ] Install the reviewed candidate; privately import/setup only if needed.
- [ ] Show a real failed transaction and label its investigated chain.
- [ ] Show the cited diagnosis and next check; label saved versus freshly fetched
  evidence and distinguish observed facts from hypotheses and missing evidence.
- [ ] Show the presented invocation's 402, validated zk-prepaid settlement, model
  delivery and confirmed consumed credits; hide raw proofs/payment headers.
- [ ] Explain separately verified Base Sepolia test-USDC funding and offchain
  consumption without displaying funding identifiers joined to spend evidence.
- [ ] Record the segment within the time budget or as a separate clip; retain the
  coding demo and review the final video before sharing.
- [ ] Review the clip for credentials, proofs, nullifiers, private content and
  identity-to-spend joins; label experimental/testnet payment. Exact execution-data
  purchases stay disabled.

Prior paid investigator and coding rehearsals passed. Public onboarding, genuine Stripe TEST Checkout/webhooks, and Base Sepolia bundle funding also passed the later hosted acceptance. Filming, sharing and equivalent registry publication have not occurred. The investigator can use the existing configured credential without another checkout or funding, but repeated validated hashes currently recover partial prior evidence rather than a fresh paid report.

## Prepared recording sequence — 2026-10-08

1. Open the fresh broken fixture at `/var/folders/f3/vyr34p2x2hb0239kv43c2dc40000gn/T/haze-founder-recording-2026-10-08-iri0l9ef`. Run `npm test`: two tests fail and two pass. The repository sample and prior successful rehearsal remain unchanged.
2. Show the public dashboard's confirmed 250-call Base Sepolia activation and its explorer transaction. Label Stripe dollars simulated; keep account identifiers and credential files off camera. This is the completed acceptance activation, not a new payment during filming.
3. Return to the fixture and run the verified local-candidate invocation in the live preflight report, using the existing configured credential. Review `git diff` and four passing unchanged tests, then show only that run's aggregate x402 counters. Preserve canonical accounting; do not reset state or run the investigator concurrently.
4. Close with the experimental Base Sepolia scope and one concrete next milestone. Keep the coding segment; optionally show the saved investigator report separately, explicitly labeled as its prior validated run. Review the clip for private data before sharing.

Hosted prework is complete; recording and submission boxes remain unchecked until those actions occur. Recheck official grant requirements before submission.
