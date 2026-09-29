# B22 resolution comment

Posted to [B22 — Internal Base Sepolia x402 integration trial](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5873130210)
on 2026-09-28. The issue was closed as completed, and the parent Wayfinder map
now points to this resolution.

---

B22 internal Base Sepolia trial resolved (2026-09-28).

Both required paths completed as separate guarded exchanges:

- **Codex sidecar:** a fresh machine-readable gate passed provider readiness, enabled launch control, V2 compatibility, authenticated admin, and current Base roots. One ephemeral Codex command through the one-proof sidecar exited 0 and returned the exact expected answer. The sidecar recorded one 402 challenge, one local proof and self-check success, one prepared `PAYMENT-SIGNATURE`, one settlement confirmation from `PAYMENT-RESPONSE`, and one successful exchange, with no local failures. Gateway deltas were `challenge_issued +1`, `proof_valid +1`, `reservation_new +1`, `claim_committed +1`, and `dispatch_ok +1`; cancellation, dispatch error, and rejection counters did not increase. The durable local ledger moved from 10 to 11 committed slots of 250.
- **Separately registered `zk-prepaid` adapter:** its own fresh gate passed. The adapter received a 402 challenge, completed local proof and self-check, sent `PAYMENT-SIGNATURE`, received a 200 committed response with `PAYMENT-RESPONSE`, and confirmed settlement. Gateway deltas were one each for challenge, valid proof, new reservation, committed claim, and successful dispatch, with no failure delta. The local ledger moved from 8 to 9 committed slots of 250 in that separate result.

The Codex path required fixes for the live gateway's older diagnostic-counter schema, an optional provider parameter, and the provider's `refusal: null` response. The adapter request body no longer sends an unsupported `stream` field. Regression tests, TypeScript checks, and the sidecar build passed; the final live Codex command and post-run launcher gate passed. The stopped one-proof listener has no active claim.

The redacted local record is `docs/evidence/base-sepolia-internal-trial.md`; the Wayfinder map is `docs/wayfinder/base-zk-credits-pilot/map.md`. No credentials, proofs, raw payment headers, request/response bodies, account identifiers, wallet identifiers, or spend-plane identifiers are included here. These are internal technical trials only; they do not count as external operator activations or start the external pilot clock.
