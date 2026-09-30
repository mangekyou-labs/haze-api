# Release candidate verification

Checked 2026-09-30 UTC for [Prepare reviewed release candidate and verify launch checks](https://github.com/mangekyou-labs/haze-api/issues/32).

Status: published candidate and current read-only launch checks pass. The gateway
real-proof test regression is fixed. No packages were published, hosted settings
changed, pilot slots consumed, or invitations sent during this verification.
This is the founder review handoff, not invitation or deployment authorization.

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

Both tickets are closed and their successful real calls remain valid. Today’s verification preserves those completed onboarding runs.

Current leaf sources differ from published `0.1.0`: shared adds passwordless
credential formats, and adapter splits out gateway claim lifecycle modules.
This does not require replacing the already-published candidate. Its three
public entry points (`zk-credits`, `zk-credits/x402`, and `zk-credits/codex`)
intentionally bundle the matching shared credential implementation; none imports
the older shared package at runtime. Both library exports import successfully
from the fresh registry install. The published adapter passes all 21 current
wire-contract and lifecycle tests when the test import is directed to its
registry-installed entry point. No source links substitute for that adapter.

Distinguish reviewing this immutable published candidate from repacking current
leaf sources: a future leaf publication must use new versions. Do not republish
any existing version or treat a current-source repack as identical to registry
artifacts. The exact published integrity pins above define this candidate.

## Launch gates

`scripts/launch-pilot.sh --check` passes: 32 required environment values satisfy
the final-stage shape checks. This is local configuration validation, not a
hosted secret-injection or provider spend-limit attestation.

`scripts/launch-pilot.sh --trial-gate` passes on 2026-09-30 at 13:16:03 UTC:
readiness, v2 compatibility, provider, authenticated admin status, enabled
launch control, and current Base scan all pass (16 blocks of lag). A subsequent
`/ready` check returns HTTP 200 with every check ok. Authenticated aggregate
status confirms caps of 40000000 daily and 200000000 rolling micro-USD,
with positive headroom and no held debits. Tokens and secret values were read
in memory and never copied into this report.

The existing founder wizard checkpoint records successful secret preparation,
Neon, Render, Vercel, OAuth, and migrations on 2026-09-22; readiness at
16:46:48 UTC, production pause/resume at 16:48:15 UTC, and isolated staging
cap exhaustion at 17:25:30 UTC. These are historical wizard acknowledgements,
not new live control exercises. Current authenticated readiness and completed
onboarding independently establish that the active services function. No
production control was toggled or cap deliberately exhausted in this ticket.

The saved release checkpoint describes `zk-credits@0.2.0`, so it cannot attest
the current candidate. The registry hashes, fresh installs, pinned bundle, and
completed first-use evidence above supply current candidate checks. The
worktree has preexisting owner edits; the clean/pushed current-source release
preflight cannot pass here. No owner edits were included in these commits.

## Validation

- Gateway typecheck and focused release/CLI/activation tests: 103 passed.
- Gateway full suite: 402 passed, 29 skipped; typecheck passed. The pinned
  real-proof rejection test now uses the production subprocess boundary.
  Its former in-process snarkjs override hung; the focused regression now
  passes in about two seconds without changing its rejection assertions.
  Both worker entry points are compiled into a temporary dependency-local
  directory, so this check works without a prebuilt sidecar and cleans up afterward.
- Registry-installed adapter wire-contract and lifecycle checks: 21 passed.
  Registry sidecar CLI and both public library imports passed.
- Sidecar build and full suite: 108 passed.
- Adapter build and full suite: 22 passed.
- Shared build and active full suite: 16 passed. Retired Stellar tests are now
  excluded consistently with the gateway configuration and Base-only package.
- Web full suite: 74 passed; typecheck passed. The onboarding copy assertion
  now checks the prepared release and owner publication boundary.
- Shell guardrails: 69 passed; operator evidence: 12 passed.

## Owner handoff

The published package candidate, exact registry dependencies, immutable proving
bundle, prior successful first-use calls, current readiness, and expected spend
caps are verified. The local regression is resolved. Founder wizard hosting and
control checkpoints succeeded historically; their timestamps are recorded above.

Remaining acceptance limitation: the current-source release preflight requires
a clean, reviewed, pushed commit, and the saved release checkpoint belongs to
an older candidate. This checkout includes owner changes outside this ticket.
The published candidate must be assessed by its immutable hashes rather than
silently rerunning publish steps or repacking changed leaf sources. Founder
release authorization and invitations remain separate actions. Human setup
time and independent external adoption remain unmeasured by these checks.
