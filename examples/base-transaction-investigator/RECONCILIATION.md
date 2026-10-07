# Owner-requested outcome reconciliation

An open investigator holds its existing runtime lease. The owner may call
`runtime.reconcile({ investigationId, attemptId })` for one existing journal
attempt. It returns `{ report, journal, session }`: a factual partial report from
validated local artifacts, the durable journal snapshot, and this session's
checks/tool count and stopping reason. It never resumes the investigation,
initializes an authorizing factory, acquires delivery, signs, proves or replays.
`close()` and other investigator operations are excluded during the session.

Execution-data status uses the configured `provider.reconcile(request)` only when
`provider.reconciliation` has `{ nonauthorizing: true, documentation: 'https://…' }`.
The adapter must implement the documented read-only status/receipt operation.
Its request contains existing `attemptId`, accepted `terms`, original execution-data
`request`, and an abort `signal`. The result is
`{ settlementObservation: { attemptId, terms, outcome: 'confirmed' | 'failed' } }`.
Identity and complete accepted terms must match. Unknown, absent, malformed or
mismatched status leaves the purchase hold unchanged. Delivery remains independent.

Optional `inferenceStatus` uses the same documented adapter contract, supplied
separately from `inferenceFactory`. Its request and observation bind `attemptId`,
`requestDigest`, accepted `terms`, and existing `reservationId` when recorded.
Only a bound observation of a retired attempt changes confirmed consumption or
records definitive failure. Local retirement is permanent. This interface does
not assert that the prepaid client supplies a claim-status API; without an
actually documented configured operation, inference status remains unavailable.
No facilitator operator credentials are accepted or borrowed.

Each explicit session allows three checks, eight external tool invocations and
120 seconds. These are separate from earlier task/check counts. Every check is
durable before dispatch; validated outcomes are durable before reporting. Status
calls receive cancellation signals; timeout/abort never establishes termination.
Definitive outcomes are monotone and do not trigger further status checks.
Provider response prose is excluded from the journal. Failed journal replacement
rejects the session and does not expose an uncommitted accounting change.

Offline cases run with `npm test --prefix examples/base-transaction-investigator`.
The status doubles are explicit simulated documented interfaces, not live API
availability or live outcome evidence.
