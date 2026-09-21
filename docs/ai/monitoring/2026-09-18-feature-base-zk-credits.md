---
phase: monitoring
title: Base private API credits monitoring
description: Privacy-preserving reliability, proving-SLO, and continuation signals
---

# Base private API credits monitoring

Date: 2026-09-20  
Status: approved 2026-09-20 on
[Review the reconciled pilot design and implementation plan](../../wayfinder/base-zk-credits-pilot/tickets/05-reconcile-pilot-docs.md).

## Safe metrics

Track aggregate counts and latency only. Do not tag metrics with accounts,
orders, wallets, commitments, nullifiers, signals, prompts, or responses.

Gateway and facilitator:

- 402 challenges, proof-validation categories, reservation outcomes
  (reserved, committed, cancelled, replayed, conflict).
- OpenRouter dispatch outcomes, provider-cost totals toward the $40/UTC
  day and $200/30d caps.
- Verify/reserve internal duration (internal budget, not partner-facing).
- Webhook retries, sponsorship/release/refund/dispute queues.
- Base RPC latency, reorg depth, finalized-root lag, slash-event lag.
- Claim-store size, replay-cache bytes, first-transcript vault occupancy
  (count per bundle, never contents).
- Reconciliation drift.

Sidecar-local (not joined to Stripe identity):

- Hot prove time p50/p95.
- Proof-failure count (prove miss, 10s abort, hash mismatch, self-verify
  mismatch). Proof failures are not claims and are not cancellations.
- Exact retries, replay bytes, real-call count, founder-assistance events,
  week-1 return.

Weekly sidecar export is the continuation evidence channel. The control
plane must not join that export to nullifiers, request signals, remaining
credit, or per-credential history.

Streaming interruption is not a metric: streaming is not a product path.

### Implemented surface

Three endpoints carry this section, all described in the
[implementation notes](../implementation/2026-09-18-feature-base-zk-credits.md#monitoring-surface-b22):

| Endpoint | Auth | Reports |
| --- | --- | --- |
| `GET /health` | none | Liveness only. Never depends on a downstream dependency, so a dependency outage cannot cause a restart loop |
| `GET /ready` | none | Postgres, Base root freshness and lag, verifier assets, provider configuration, and launch state. `503` when any check fails; each detail is a fixed, privacy-safe string |
| `GET /v1/admin/status` | `BILLING_INTERNAL_TOKEN` | Bounded aggregate counters, conservative spend and headroom for both cap windows, durable claim-state counts, Base lag, and launch state |

Proving happens only inside an operator's sidecar, so the gateway reports
`provingLatency: { source: 'participant-reported', value: null }`. Aggregate
hot-prove time arrives through the weekly sidecar export and is never derived
or inferred by the gateway.

The kill switch and the provider-spend caps are durable state, so a restart
cannot clear a pause or reset spend. An operator pages themselves by watching
`/ready`; the cap-exhaustion pause is discoverable from `/v1/admin/status`,
which reports the exhausted window in the launch reason.

## Alerts

Page on:

- contract/RPC chain mismatch (not `84532`);
- verifier failure spike;
- stuck mature bundles;
- sponsor balance below configured runway;
- refund SLA breach;
- duplicate terminal transitions;
- unexplained claim-store divergence;
- provider-spend cap hit;
- finalized-root or slash-event lag beyond the configured confirmation
  depth;
- OpenRouter unavailability or ceiling miss (pause checkout).

Warn on:

- 402/settle latency;
- provider timeout rate;
- replay-cache pressure;
- first-transcript vault approaching 250 per bundle;
- webhook retry growth;
- sidecar proof-failure rate;
- hot prove p95 approaching the partner's accepted proving latency.

## Proving SLO operations

Partner-facing contract is hot prove time only: p50 ≤ 1.5s, p95 ≤ 3.0s,
and not looser than that partner's written accepted proving latency.
Gateway verify and reserve are internal. Soak p95 above the written number
fails the continuation line; it is not paging by itself during unpaid
dry-run.

## Continuation ledger

Map owner reviews weekly exports against:

- three activated design partners;
- two with ≥1,000 real calls;
- two with two-agent deployment;
- two with dated written renewal intent at live SKU;
- soak p95 ≤ each partner's accepted proving latency;
- zero manual recoveries.

Missed destination or two-agent line stops production continuation.
Sepolia R&D may continue.

## Operations

Workers use durable leases, bounded exponential retry, idempotency keys,
and a dead-letter/reconciliation queue. Contract events are replayed from
a recorded block and a reorg-safe confirmation depth. `BondSlashed`
rebuilds remaining slot nullifiers for the 250-slot tier before the
finalized cursor advances.

Stripe refund state is reconciled against the control plane. A chargeback
blocks future purchases but does not revoke an active credential and does
not join to spend identifiers.

## Incident response

First disable new funding and sponsorship if accounting is uncertain,
retain all rows and chain evidence, rotate compromised operational keys,
and preserve privacy boundaries. Recovery drills cover RPC loss, worker
crash between reserve and commit, worker crash between commit and client
return, Stripe webhook duplication, reorg, slashing, proof-failure storms,
and refund retry.

Postmortems contain no prompts, responses, secrets, proofs, or joinable
spend identifiers. Manual recovery (founder access to secret, password,
decrypted export, or replacement credential after backup failure) is a
continuation failure. Founder assistance that is only install/config help
is not manual recovery.
