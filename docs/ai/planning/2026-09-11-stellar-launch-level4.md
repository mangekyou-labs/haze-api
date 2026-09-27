---
phase: planning
title: Stellar Launch — Level 4 delivery plan
description: TDD task plan for the additive consent-based evaluation milestone
---

# Stellar Launch — Level 4 delivery plan

Date: 2026-09-13
Feature slug: `stellar-launch`  
Branch: `feature-stellar-launch-level4`  
Base: `1c17e14`  
Status: wallet-optional scope approved; repository documentation reconciled; T8.G, T8.H, and T8.I complete locally; PR #2 wording reconciled; hosted restore and synthetic verification complete; hosted product/evidence gates pending

## Worktree and source boundary

Implementation is isolated at
`/Users/kyler/repos/feature-zk-api-credits/.worktrees/feature-stellar-launch-level4`.
The donor `feature-zk-api-credits` worktree is read-only reference material;
its full diff and lockfiles are not applied.

## Task sequence

| Task | Scope | Status | Required evidence |
|---|---|---|---|
| T1 | Domain invariants, memory store, migration contract | complete | failing/passing unit tests; `0009` checks |
| T2 | Postgres adapter and injected pool/migration lifecycle | complete | disposable Postgres tests; migration twice |
| T3 | Authenticated gateway evaluation router | complete | route auth/validation/status tests |
| T4 | Checkout receipts, retryable billing, existing staged deposit integration | complete | duplicate/concurrent webhook/deposit tests |
| T5 | Web server proxies, consent-gated checkout, receipt/status APIs | complete | route/unit tests; existing checkout tests |
| T6 | Dashboard evaluation flow and privacy telemetry | complete | web unit/E2E; PostHog/Sentry scrub tests |
| T7 | Fee-sponsor Sentry, synthetic CI, locks, operations/evidence docs | complete locally; hosted package CI green | service typecheck; workflow/script checks; docs audit; Actions CI `de394b3` success |
| T8 | Full verification and final review reconciliation | complete locally | fresh command matrix and requirement audit |
| T8 follow-up | Phase 7 remediations: fingerprint, monotonic checkout, 405 mutations, transactional challenge limit, `$1`/test-mode gates, crash-window honesty | complete locally | this-session matrix; hosted package CI green on `de394b3`; hosted product/evidence gates still pending |
| T8 hosted restore/synthetic | Restricted database, gateway/fee-sponsor/web restore, and three cold/warm synthetic passes | complete | hosted URLs, restricted store, and Deploy Smoke `level4-synthetic` evidence |
| T8.A | Reconcile lifecycle docs, evidence index, and PR description | complete | lockstep docs and evidence index reconciled; PR #2 description updated with wallet-optional and conservative hosted-status wording |
| T8.F | Reconcile wallet-optional requirements, design, planning, implementation, testing, deployment, monitoring, evidence, and PR wording | complete for repository docs | approved Web2 design and lockstep repository docs; PR wording remains tracked in T8.A |
| T8.G | Remove wallet proof from gateway deposit/feedback/completion/evidence gates while preserving optional wallet APIs | complete locally | red/green memory, Postgres, route, and webhook tests; gateway typecheck |
| T8.H | Remove Freighter from the primary dashboard journey and update browser/E2E coverage | complete locally | failing-first web tests; no-provider E2E; typecheck/lint/build; desktop/mobile CLI walk |
| T8.I | Re-run the full local matrix and reconcile hosted acceptance artifacts | complete locally | fresh package-wide verification record; external blockers recorded, not inferred; PR #2 description reconciled |
| T8.B | Hosted product path: OAuth, browser identity, retried `$1` test checkout, explorer confirmation, feedback, logout reset | todo | direct live participant evidence; Freighter is not required |
| T8.C | Scrubbed Sentry and consented PostHog evidence | todo | dashboard captures with no sensitive data |
| T8.D | Ten-person distinct consenting cohort and redacted export | blocked (0 / 10) | ten unique authenticated participants/deposits/transactions required |
| T8.E | Fresh screenshots, 4–6 minute demo, final review, and publication | todo | depends on T8.B–D |

## Current planning handoff

On 2026-09-13 the operator approved the Web2/agentic-user path: Freighter is
not required for the primary evaluation journey, while the gateway continues
to fund and submit the real Stellar testnet deposit. Wallet proof remains an
optional compatibility capability rather than a deposit, feedback, completion,
or evidence prerequisite.

The repository-side scope reconciliation is complete in commit `f38ebb4`.
The follow-up gateway and walletless dashboard implementations are complete
locally. T8.H's no-provider E2E and desktop/mobile CLI walk confirm the primary
card uses Consent, `$1` checkout/deposit, and Feedback while launch onboarding
and the playground remain available. T8.I's package-wide matrix is complete,
and PR #2 now describes the wallet-optional path and the remaining hosted
gates conservatively.

No further local implementation task remains. Hosted T8.B–E remain external
evidence gates and are not advanced by this planning update. The task-tracing
probe remains unavailable because `npx ai-devkit@latest task ...` reports
`unknown command 'task'`.
Hosted T8.B–E remain external evidence gates and are not advanced by this
planning update.

## Per-task workflow

For every product-code task: inspect the current target, add a focused failing
test, make the minimum implementation change, refactor, run the narrow and
affected checks, then update requirements/design/planning/implementation/
testing and the evidence index with facts only. Documentation-only
reconciliation may skip TDD but must pass `git diff --check`. Existing launch
behavior is a regression gate at every integration task. Wallet proof remains
covered as an optional compatibility capability; it must not re-enter the
primary flow or completion predicate.

## Dependencies and external gates

T1–T7 are local and can proceed without provider credentials. T2's live SQL
cases require a disposable Postgres instance. Hosted restore and three
cold/warm synthetic passes are complete on the current Level 4 deployment.
GitHub OAuth/Stripe ingress, Sentry/PostHog screenshots, fresh deployed
screenshots, the ten-person cohort, and the demonstration remain explicit
external gates for T8.B–E; Freighter is no longer an external prerequisite.
Local verification does not substitute for those artifacts.

The Phase 7 remediations close local design gaps found during Check
Implementation. The approved wallet-optional design adds a follow-up behavior
change: wallet proof remains optional, while deposit, feedback, completion, and
evidence use the gateway-funded deposit path without wallet gating. This scope
change does not convert hosted gates into local passes.
