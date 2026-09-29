# B22 Codex dispatch failure: historical subcause

Research date: 2026-09-28. This is a read-only examination of the retained
trial record and the gateway source at fixed point `7c9e040`.

## Finding

The historical subcause remains unknown. The retained record establishes that
the one-proof Codex request passed payment verification, was reserved, entered
provider dispatch, and ended with a cancelled claim before settlement or a
committed response. It contains aggregate counter deltas and final claim
counts, but no provider response or body, request body, per-request gateway
log, or claim-store error. [Trial record: offline boundary](../evidence/base-sepolia-internal-trial.md#L10-L24), [trial record: live reconciliation](../evidence/base-sepolia-internal-trial.md#L109-L134)

The synthetic `/v1/chat/completions` characterization verifies cancellation
for selected provider failures and success through replay staging, commit, and
`PAYMENT-RESPONSE`; it did not reproduce or identify the live failure.
[Characterization record](../evidence/base-sepolia-internal-trial.md#L25-L35), [gateway test](../../ts/zk-prepaid-gateway.test.ts#L565-L593)

## What the source narrows

In `createClaimCompletion`, `dispatch_error` is incremented for an error after
the provider call has returned a promise, except for the separately counted
timeout. The handler then increments `claim_cancelled` only if readiness has
not been recorded and `cancelIfReserved` successfully finds and cancels the
still-reserved claim. `readyStaged` becomes true only after `stageReady`
returns; commit happens afterward. Therefore, if the paired `+1` deltas refer
to this single request as the trial record indicates, they narrow the failure
to after dispatch began and before `stageReady` returned successfully. A
commit failure is inconsistent with the recorded successful cancellation
counter. [Dispatch and error path](../../ts/claim-completion.ts#L118-L185), [cancel-if-reserved lifecycle](../../packages/x402-zk-prepaid/src/claim-lifecycle.ts#L158-L181)

That interval still contains several possible failures: provider transport or
non-2xx status; response buffering or JSON-shape validation; replay encryption
or envelope bounds; and claim-store staging. [Provider response handling and staging](../../ts/claim-completion.ts#L78-L110), [replay encryption](../../ts/response-replay.ts#L21-L64), [claim staging and commit](../../ts/claim-store.ts#L151-L195)

The `dispatch_error` metric's comment says it covers non-2xx and transport
errors, while the implementation increments it for any caught post-dispatch
failure except timeout. It is consequently not a diagnostic subcause. The
gateway maps typed completion errors to status/code, but no first-request
response code or body was retained for this run. [Metric declaration](../../ts/metrics.ts#L44-L57), [gateway error mapping](../../ts/zk-prepaid-gateway.ts#L415-L417), [completion response handling](../../ts/zk-prepaid-gateway.ts#L951-L972)

**Conclusion:** primary retained evidence and the fixed-point source narrow the
phase but cannot establish which operation failed. Do not attribute the event
to a provider, encryption, or claim-store defect without new per-request
evidence.
