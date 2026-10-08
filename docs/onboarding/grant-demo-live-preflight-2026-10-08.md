# Grant demo live preflight — 2026-10-08

Hosted prerequisites passed later on 2026-10-08; see the [rollout acceptance report](grant-demo-rollout-readiness-2026-10-08.md#hosted-acceptance-passed--0854-utc). The table below preserves the initial audit. Recording, review and submission remain separate work.

## Initial external checks (superseded by hosted acceptance)

| Prerequisite | Result | Evidence and implication |
| --- | --- | --- |
| Gateway readiness | Passed | `https://zk-credits-gateway.onrender.com/ready` returned HTTP 200 and `ready: true`, including database, RPC, assets, provider configuration and compatibility checks. This does not establish sandbox onboarding acceptance. |
| Stripe test authentication | Passed | The configured secret authenticated to Stripe balance API; response had `livemode: false`. No secret values retained. |
| Public sandbox web routes | Blocked | `https://hazecredits.vercel.app/api/sandbox/balance`, `/api/sandbox/checkout`, and `/api/sandbox/webhook` returned 404 using their appropriate GET/POST methods. |
| Hosted sandbox gateway route | Blocked | An authenticated empty-object POST to `/v1/sandbox/topups` returned 404. No account or top-up was created. |
| Stripe webhook configuration | Incomplete | The enabled test endpoint points to `/api/webhooks/stripe`, not the new `/api/sandbox/webhook` route. No real test Checkout completion or webhook delivery was verified. |
| Vercel access | Blocked | The configured token returned 403 for account, projects and project environment reads. Deployment configuration could not be verified. |
| Public npm feature parity | Failed | Registry latest is `zk-credits@0.2.11`. The cached research tarball exactly matches registry SHA-512 integrity; its CLI has no investigator or `--task-evidence` command, and no task-evidence module. The reviewed local candidates remain required. |
| Investigator paid acceptance | Saved pass | Issue 57 documents two fresh paid invocations with one challenge, successful delivery and one confirmed consumed credit each. These are prior executions, not newly paid requests during this preflight. |
| Coding task acceptance | Passed with local candidate | After correcting the rehearsal invocation, Codex exited 0, changed only `indexer.mjs`, and passed all four unchanged tests. Same-task evidence recorded one challenge, five verified proofs, five prepared payments, five committed claims, five successful responses and zero failures. |
| Investigator recovery now | Partial | Both validated hashes recovered stopped-task evidence and accounting with zero new consumed credits and zero unknown outcomes. They returned `partial (recovered_stopped)` with exit 1, rather than regenerating the full saved model diagnosis. Use the reviewed prior reports for a saved-evidence segment; do not promise that repeating the command produces a fresh complete report. |

## Local compatibility verification

The installed Codex CLI sent a `text.verbosity` hint that the Responses bridge
rejected. Added validation for the three known verbosity values and omitted the
display hint from the fixed upstream request. Structured output controls remain
rejected before payment. The regression failed before the fix and passed after
it; all 142 sidecar tests and the sidecar build passed.

The noninteractive rehearsal's `--ignore-user-config` option prevented the
expected profile settings from taking effect. A no-payment loopback probe
observed reasoning effort `low` with unsupported `context: all_turns`. Removing
that option and explicitly selecting the bounded model and reasoning effort
produced a request accepted by the current translator, with actual coding tools.
The subsequent real task completed the code fix and paid delivery. Its diff
introduces a `Set` keyed by chain ID, lowercase transaction hash, and log index,
filters duplicates, and retains the original bigint conversion. The unchanged
tests verify duplicates, distinct transfers in one transaction, distinct chains,
and hash casing. Before: two passed and two failed. After: four passed.

The verified invocation, run in a fresh copy of `examples/base-usdc-indexer`, was:

```sh
node /absolute/path/to/packages/zk-credits-sidecar/dist/zk-credits.js codex --task-evidence \
  -c 'model="openai/gpt-4o-mini"' -c 'model_reasoning_effort="none"' \
  exec --ephemeral --sandbox workspace-write --json \
  'Fix the duplicate-log bug in indexer.mjs; preserve distinct transfers and chains, normalize transaction hash casing, and run npm test without changing tests.'
```

The displayed prompt is abbreviated; the actual task also explicitly required
reading both sample files and completing the edit. Do not add
`--ignore-user-config` to this verified invocation.

## Initial acceptance gates and final disposition

1. Completed: exact reviewed web/gateway candidate deployed, migration and runtime configured.
2. Completed: real Stripe TEST Checkout, verified webhook/balance, Base Sepolia funding, duplicate delivery/activation checks and reload recovery passed. Details and operational limits are in the rollout report.
3. Repeat the now-verified paid indexer repair during recording, using a fresh
   broken sample and the invocation above; review the filmed run's own evidence.
4. Use the reviewed local candidate for filming, or publish and verify equivalent
   registry content before using a public install command.
5. Record and review the clips, then check current grant submission requirements.

Raw rehearsal logs and credential state stay outside this report. Stripe sandbox
balance is simulated and does not fund onchain USDC. Base Sepolia bundle funding
and offchain credit consumption are separate from the Base mainnet evidence used
by the investigator.
