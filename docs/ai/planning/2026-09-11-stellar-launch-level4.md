---
phase: planning
title: Stellar Launch — Level 4 delivery plan
description: TDD task plan for the additive consent-based evaluation milestone
---

# Stellar Launch — Level 4 delivery plan

Date: 2026-09-11  
Feature slug: `stellar-launch`  
Branch: `feature-stellar-launch-level4`  
Base: `1c17e14`  
Status: local implementation verified; hosted restore and synthetic verification complete; hosted product/evidence gates pending

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
| T8.A | Reconcile lifecycle docs, evidence index, and PR description | complete | lockstep docs and updated PR #2 description |
| T8.B | Hosted product path: OAuth, Freighter proof, retried `$1` test checkout, explorer confirmation, feedback, logout reset | todo | direct live participant evidence |
| T8.C | Scrubbed Sentry and consented PostHog evidence | todo | dashboard captures with no sensitive data |
| T8.D | Ten-person distinct consenting cohort and redacted export | blocked (0 / 10) | ten unique wallets/deposits/transactions required |
| T8.E | Fresh screenshots, 4–6 minute demo, final review, and publication | todo | depends on T8.B–D |

## Per-task workflow

For every task: inspect the current target, add a focused failing test, make
the minimum implementation change, refactor, run the narrow and affected
checks, then update requirements/design/planning/implementation/testing and
the evidence index with facts only. Existing launch behavior is a regression
gate at every integration task.

## Dependencies and external gates

T1–T7 are local and can proceed without provider credentials. T2's live SQL
cases require a disposable Postgres instance. Hosted restore and three
cold/warm synthetic passes are complete on the current Level 4 deployment.
GitHub OAuth/Freighter/Stripe ingress, Sentry/PostHog screenshots, fresh
deployed screenshots, the ten-person cohort, and the demonstration remain
explicit external gates for T8.B–E; local verification does not substitute for
those artifacts.

The Phase 7 remediations close local design gaps found during Check
Implementation. They do not convert hosted gates into local passes.
