# B22 issue comment

Posted to [issue #26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5870180031)
on 2026-09-28. The redacted comment below contains no credentials, proof
artifacts, request or response bodies, raw payment headers, account identifiers,
wallet identifiers, or spend-plane identifiers.

---

B22 internal trial update — 2026-09-28

- The earlier Codex attempt reached the gateway but failed payment
  verification after six locally generated and self-verified proofs. The
  sidecar submitted 11 payment payloads; the gateway recorded 12 challenges
  and 11 aggregate invalid-proof rejections, with no accepted proof,
  reservation, claim, or provider dispatch. An offline replay reproduced
  `invalid_payload_fields` when SnarkJS proof metadata exceeded the frozen
  payment schema; the sidecar now emits only the accepted proof fields. The
  exact historical rejection category remains unknown.
- In the later one-proof Codex rerun, one 402 challenge was issued and
  received; the local proof self-check passed and the gateway accepted the
  payment (`proof_valid +1`, `reservation_new +1`). The request then failed
  after dispatch began; the gateway cancelled the claim (`dispatch_error +1`,
  `claim_cancelled +1`). No facilitator settlement confirmation, committed
  response, or `PAYMENT-RESPONSE` was recorded. The local ledger has seven
  committed slots out of 250.
- An offline HTTP characterization confirms that synthetic provider failures
  before claim readiness cancel the reservation, while a successful synthetic
  response is encrypted for replay, committed, and returned with
  `PAYMENT-RESPONSE`. The retained live artifacts do not identify whether the
  dispatch failure came from provider response handling, replay encryption, or
  claim staging; its historical subcause remains unknown.

The Codex exchange is unsuccessful and the separately registered
`zk-prepaid` adapter exchange remains unattempted. Issue #26 remains open; the
adapter attempt and its independently reconciled outcome are outstanding.
