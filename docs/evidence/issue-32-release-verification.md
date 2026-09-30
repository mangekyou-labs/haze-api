# Release candidate verification

Checked 2026-09-30 UTC for [Prepare reviewed release candidate and verify launch checks](https://github.com/mangekyou-labs/haze-api/issues/32).

Status: publication confirmed; remaining release checks need reconciliation. No packages were published, hosted settings changed, pilot
slots consumed, or invitations sent. This report is the founder review handoff,
not authorization to release. The ticket remains open because its hosted-readiness and full-suite checks have not passed in this verification
run. The completed onboarding tickets remain valid technical acceptance.

## Candidate and integrity

The prepared `zk-credits@0.2.10` tarball SHA-256 verifies against its existing
`SHA256SUMS`: `4ffb8a0e49d48656d56015b02c98039d3adb8e3d7b54175fc37825e28f173e85`.
Its manifest pins shared and adapter dependencies to exactly `0.1.0`.
Launch instructions, the operator wizard, and new activation evidence now pin
the sidecar to `0.2.10`, matching the prepared candidate.

A fresh installation outside the checkout installed the candidate tarball and
both leaf dependencies from the public registry without local package links.
The CLI help command passed. The lockfile contains registry URLs and these
published integrity pins:

- Shared: `sha512-AT8r/ekeMGJh9BHy2561FJeyNZurOWxFyTAhz9cqmrnFk82lswOr4sMXs60Dsb1vS6fR5XgQjS+IANyIhutNqw==`.
- Adapter: `sha512-fNRPARYlz3uSkn3UdZf+19UnizE2eiSEFrauMTkxSGeT3YkmEYjSl7CX7mw5JhVh5hBMGduRN6+WSc9ujIChfA==`.

The installed proving archive matches the manifest SHA-256
`dc60b3109b3d907e2b9e8c4253fb52e77400d763eb443968e8de3af6b7e0b709`.
All three extracted proving files match their individual manifest hashes. The
bundle pins Base Sepolia chain 84532 and the development v2 deployment.

The initial registry lookup returned E404, but that result was stale or
transient: an explicit public-registry recheck confirms `zk-credits@0.2.10`,
published at 2026-09-30T12:56:55.202Z, before the initial lookup. Its integrity
exactly matches the prepared tarball:
`sha512-NawqvZHncroGKPIU9i9/P5g+gWn9xBxjldvYM+Q+aIbteViegwzi/+X5P9+zvMF7Pg+Of2V0SEcsIZHnhO1Xdw==`.
Publication is not a blocker. Full first-use validation from
this same prepared tarball is recorded in [Codex technical acceptance](issue-29-live-browser-onboarding.md);
the previous x402 rehearsal is in [x402 technical acceptance](issue-30-x402-passwordless-validation.md).
A subsequent fresh installation of all three exact versions directly from the
public registry passes. The lockfile resolves all three from registry tarballs
without local links; the published sidecar CLI help check passes.

Both tickets are closed and their successful real calls remain valid. The
current readiness failure and local test timeout do not invalidate those runs.

Rebuilding the current shared and adapter packages produces contents different
from published `0.1.0`, not merely different tarball metadata. Shared differs in
`src/base.ts` and its JS/declarations. Adapter differs in claim lifecycle,
claim types, index exports, their JS/declarations, and README. Existing immutable
versions must not be republished. Reconcile these changes into new leaf versions
and regenerate/review the sidecar candidate with exact dependencies before
publication. Recheck bundled code against the registry leaves as part of that
candidate review; the fresh install alone does not establish parity.

## Launch gates

`scripts/launch-pilot.sh --check` passes: 32 required environment values satisfy
the final-stage shape checks. This is local configuration validation, not a
hosted secret-injection or provider spend-limit attestation.

`scripts/launch-pilot.sh --trial-gate` fails: local preflight passes, but hosted
readiness, v2 compatibility, authenticated admin status, and Base scan are
unavailable. Provider and launch control are unknown. No response body, token,
RPC endpoint, credential, request, proof, or spend identifier is recorded here.

Readiness, hosted secret injection, production pause/resume, and isolated
staging cap exhaustion remain unverified. The launch plan requires readiness
caps of 40000000 daily and 200000000 rolling micro-USD. Local tests verify the
control logic; they do not prove hosted configuration or live cap exhaustion.
The release worktree contains preexisting owner edits and this verification
change is not pushed; the clean/pushed/reviewed publish gate is not passed.

## Validation

- Gateway typecheck and focused release/CLI/activation tests: 103 passed.
- Gateway full suite after pin changes: 401 passed, 29 skipped, one failed.
  The pinned-real-proof rejection-boundary test times out at 120 seconds.
- Sidecar build and full suite: 108 passed.
- Adapter build and full suite: 22 passed.
- Shared build and active full suite: 16 passed. Retired Stellar tests are now
  excluded consistently with the gateway configuration and Base-only package.
- Web full suite: 74 passed; typecheck passed. The onboarding copy assertion
  now checks the prepared release and owner publication boundary.
- Shell guardrails: 69 passed; operator evidence: 12 passed.

## Owner handoff

Before authorizing invitations: reconcile the leaf-source/runtime differences,
resolve the local real-proof regression, establish current hosted readiness,
and complete the hosted secret and spend-cap checks. The sidecar is already
published with the exact reviewed tarball integrity. Record the fresh registry
install result and reconcile remaining gates without discarding the completed
Codex and x402 technical acceptance. Human setup
time and independent external adoption remain unmeasured by these checks.
