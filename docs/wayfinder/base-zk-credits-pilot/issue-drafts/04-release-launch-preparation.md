Title: Prepare reviewed release candidate and verify launch checks

Map story: [Codex developer's first call](https://github.com/mangekyou-labs/haze-api/issues/25#codex-developers-first-call) and [x402 operator's own agent loop](https://github.com/mangekyou-labs/haze-api/issues/25#x402-operators-own-agent-loop)  
Sources: [B9 onboarding #12](https://github.com/mangekyou-labs/haze-api/issues/12), [B8 integration #11](https://github.com/mangekyou-labs/haze-api/issues/11)  
Blocked by: [#29](https://github.com/mangekyou-labs/haze-api/issues/29), [#30](https://github.com/mangekyou-labs/haze-api/issues/30), [#31](https://github.com/mangekyou-labs/haze-api/issues/31)

## Deliverable

Produce a reviewed, version-matched package candidate for the Codex sidecar,
`zk-prepaid` adapter, and shared package. Verify clean registry installs and
run the launch and onboarding gates before the founder sends invitations.

## Acceptance

- Package versions and bundle manifest agree and are immutable/hash-pinned.
- Fresh registry installs resolve the exact published dependency versions and
  run the first-use checks without repository-local package links.
- The existing founder launch wizard's secret, hosted-service, readiness,
  release, and spend-cap checks pass.
- Document the release and launch result for founder authorization. This ticket
  does not publish or launch the hosted pilot on its own.
