Title: Codex developer first use: invite to first call

Map story: [Codex developer's first call](https://github.com/mangekyou-labs/haze-api/issues/25#codex-developers-first-call)  
Source: [B9 onboarding #12](https://github.com/mangekyou-labs/haze-api/issues/12)

## Deliverable

Prepare one invite-to-first-call guide for a Web2 developer. The founder
pregrants access to the private proving-bundle repository and sends the
single-use pilot invite. The operator gives Codex one instruction; Codex checks
`gh auth status`, installs the pinned registry release, downloads the
hash-pinned release bundle, verifies the release and file digests, then runs
local setup.

The human's tasks are GitHub sign-in, entering the recovery password locally,
consent, and choosing/running their own coding task. Passwords never enter the
Codex prompt or evidence. State that the provider receives the model request,
valid spends aim for payer/credential unlinkability, the circuit is
experimental, and generic unmodified x402 clients are unsupported.

Measure active human action time through the first counted call, excluding
unattended downloads, install, proof, and provider waits. Record help given.
Five minutes is the target; a longer duration is a friction finding, not a
protocol failure.

## Acceptance

- Run the guide from a fresh local setup with the pinned registry package and
  private bundle access.
- Confirm Codex fails clearly when `gh` is unauthenticated or a digest differs.
- Confirm the human can recover locally and complete the first task without
  founder access to their credential or password.
- The resulting activation evidence is redacted and does not join identity to
  spend data.
