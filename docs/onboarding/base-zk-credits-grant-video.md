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
- [ ] Install the npm package, import the credential with setup, and check readiness.
- [ ] Run the indexer fix through Codex; show the code diff and passing tests.
- [ ] Record: failing test → activation → npm setup → agent fixes and tests →
  x402 evidence from that same task. Confirm committed claims; keep raw payment
  payloads private.
- [ ] Label the prototype Base Sepolia and experimental. Describe the $5,000
  Base Builder Grant as the funding target, and name one concrete next milestone.
- [ ] Review the video for credentials, keys, proofs, nullifiers, request signals,
  private content, and identity-to-spend joins before sharing.
- [ ] Verify the current official grant round and submission requirements before
  applying. Keep a recorded demo separate from any submission or award claim.

## After downloading the activated credential

Requires Node.js 20 or newer and native OS credential storage.

```sh
npm install --global zk-credits
ZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup codex
zk-credits codex
```

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
and passing tests separately. A real paid coding run is still unverified. The [founder demo command](base-zk-credits-founder-demo.md#perform-one-genuine-task)
performs a separate inference request; its summary cannot stand in for this
task's exchange. Show only reviewed evidence from the run being recorded.

## Sandbox activation before recording

Public Stripe sandbox activation is implemented and verified with local tests
and a disposable Postgres database. Live test-mode Checkout, webhook delivery,
and Base Sepolia funding still require external verification against [the approved funding design](../superpowers/specs/2026-10-07-grant-demo-sandbox-design.md)
before it appears in the video:

- [x] Remove invite entry; expose test checkout to signed-in users.
- [x] Show simulated balance and each bundle's funding status.
- [x] For insufficient funder liquidity, show the sponsor wallet and faucet link.
- [x] Deduct the reserved simulated amount once after confirmed funding;
  recover failures and unknown outcomes without duplicate funding or deduction.

Use only the flow actually working at recording time. A faucet supplies test
USDC separately from simulated Stripe payments.

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

A repeated hash can recover the saved report without a new paid call. The
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

Live rehearsal has passed; filming and sharing have not. Stripe Checkout and
webhooks, public onboarding deployment, the paid coding task and registry
publication remain separately unverified. The existing gateway was reconfigured
and redeployed during live validation; that does not establish a public sandbox
launch. The investigator can use the existing funded credential without a new
checkout or funding.
