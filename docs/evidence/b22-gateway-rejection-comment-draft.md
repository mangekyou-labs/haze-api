# Draft B22 issue comment — approval required

## Sanitized gateway rejection diagnosis (2026-09-28)

- The 08:20–08:21Z attempt recorded 12 gateway challenges and 11 aggregate
  payment-verifier rejections, with no gateway `proof_valid` increment,
  reservation, claim, or dispatch. The sidecar recorded six locally self-
  verified proofs and 11 payment rejections. The exact live rejection category was not retained.
- An offline replay with synthetic credentials and mock settlement reproduced
  `invalid_payload_fields` when the SnarkJS proof object included `protocol`
  and `curve`; the frozen schema accepts only `pi_a`, `pi_b`, and `pi_c`. The
  sidecar now sends only those fields. This is a reproduced candidate, not a
  recovered explanation of the live attempt.
- Fixed aggregate validation counters now classify header, authorization,
  request binding, wire shape, public signals, cryptographic proof, verifier
  unavailable, and other. They are source changes for a future gateway build;
  the historical snapshot cannot be recategorized.

The later dispatch failure and the unattempted registered-adapter exchange
remain separate B22 work. No live request, settlement, or ledger change was
made during this diagnosis. Both internal exchanges remain incomplete; issue
#26 stays open. This draft has not been posted.
