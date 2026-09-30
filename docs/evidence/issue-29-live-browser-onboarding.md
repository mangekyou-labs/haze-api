# Codex operator live browser onboarding

Date: 2026-09-30 UTC. Journey:
[Codex developer first use: invite to first call](https://github.com/mangekyou-labs/haze-api/issues/29).
This is agent-assisted founder technical acceptance, not independent external
adoption, slot A qualification, or a counted call.

## Verified live

The existing GitHub-authenticated browser session at
https://hazecredits.vercel.app was retained. The operator confirmed continuation;
this run did not exercise fresh GitHub authentication.

The initially open dashboard retained stale password-based client code. Recovery
generation failed with a backup-password requirement. Reloading loaded the
deployed passwordless flow. A fresh invite was issued and redeemed; the browser
displayed the bearer-file possession warning with no password inputs.

The browser generated and downloaded the recovery capsule, then reimported the
same file successfully before funding became available. Funding was attempted
through the hosted button. It returned `funding_unavailable`; the provisioning
record was unresolved and recorded a token allowance failure.

Reconciliation through the configured RPC endpoints hit rate limits. An alternate
public Base Sepolia RPC completed reconciliation and found no confirmed funding
for this commitment. The sponsor lacked enough test USDC. The operator completed
Circle's human bot verification and the faucet confirmed sending 20 test USDC.
The agent then verified the configured sponsor and on-chain balance, approved
exactly one tier-0 bundle's allowance, and funded the bundle using the existing
sponsor interface. That interface verified a successful confirmed transaction
and its actual BundleFunded event. The authoritative transaction and expiry were
recorded through the existing provisioning-store completion interface.

Pressing the hosted funding button again returned the authoritative result and
downloaded the activated credential. Local verification validated the activated
export and confirmed its commitment matches the recovery capsule without a
password. Both files are outside the checkout in an owner-only directory with
owner-only file permissions. Browser duplicate JSON downloads were removed.
Secrets, account identifiers, commitments, capabilities, transaction identifiers,
and credential contents are omitted from this evidence.

## Assistance and remaining acceptance

This run required stale-tab recovery, agent-issued invites, RPC substitution,
sponsor token replenishment, a human faucet bot check, a single-bundle approval,
and direct sponsor funding with authoritative provisioning completion. The
hosted funding flow was not independently frictionless. Active human seconds
and unattended timing were not measured; no five-minute claim is made.

The operator takes over at the activated-credential download boundary. Local
RPC configuration, fresh-package Codex setup, OS-store import, restart without
the export, consent, and a self-chosen real Codex task remain to be validated.
No sidecar was started and no gateway model request or counted call was made
in this browser continuation. Package publication was not performed. Keep the
journey issue open until its remaining acceptance requirements are satisfied.

The older deployment status in
[prior operator validation](../onboarding/issue-29-operator-validation.md)
is historical; this run verified the deployed passwordless browser flow.

## Local Codex acceptance continuation

The user authorized the agent to continue as the operator. Fresh tarball setup
imported the activated credential into the OS store without a password. A saved
alternate RPC enabled witness synchronization, pinned-artifact verification, and
gateway root confirmation. Restart and setup without the export succeeded.

An isolated Codex profile completed a warm-up and a throwaway JavaScript clamp
task through the sidecar and live gateway. The task completed in 6.225 seconds;
its returned function passed local checks including rejecting reversed bounds.
Aggregate deltas: two valid proofs, committed claims, successful dispatches and
confirmed settlements; zero proof, exchange or dispatch failures. Metrics access
returned 401 without authorization and 200 with authorization. One hot-proof
sample measured 1.094 seconds; no latency percentile guarantee is claimed.

This is agent-assisted founder acceptance, not independent participant adoption.
Participant consent, self-chosen participant task and active-human-time evidence
remain outstanding. Keep issue 29 open. The subsequent release bakes the launch
RPC; this live acceptance used a saved alternate endpoint and does not validate
the baked endpoint’s availability.

## Launch RPC release acceptance

A fresh install of prepared 0.2.10 completed passwordless Codex setup using the
baked launch RPC, with no BASE_RPC_URL or saved RPC override. Witness and pinned
bundle validation and gateway root confirmation passed. A real clamp task
completed in 16.437 seconds and passed the same functional checks.

This reused an already-spent credential in a new isolated state directory. The
client recovered from four payment rejections; gateway deltas classified them
as four claim conflicts, with five valid proofs total. One new claim committed,
one dispatch succeeded, and one settlement was confirmed. There were no invalid
proofs or dispatch errors. This was successful recovery with retries, not a
zero-friction first-use measurement. Metrics remained authenticated (401/200).
Package publication is still handed to the owner; no publication was performed
by this agent. Registry 0.2.9 already existed, so this RPC revision is 0.2.10.

## Owner-approved acceptance amendment (2026-09-30)

The owner subsequently authorized this agent as the delegated operator and
approved changing acceptance criteria. The completed run satisfies delegated
technical acceptance for issue 29. Historical descriptions above reflect the
criteria at the time of each run. Independent human participation, human consent
interview, self-chosen human task and active-human setup time were not observed
and are no longer closure gates for the implementation ticket. External pilot
activation and market evidence remain outstanding in their dedicated tickets.
No historical run is relabeled independent external adoption. Publication
remains the separate owner handoff for 0.2.10.
