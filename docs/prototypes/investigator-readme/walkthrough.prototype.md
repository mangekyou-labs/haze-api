# First investigation · throwaway reader walkthrough

Owner review asset for [Choose a concise README and first-investigation walkthrough](https://github.com/mangekyou-labs/haze-api/issues/44).
This is a proposed terminal experience, not an implemented command or a real run.
Every transaction, evidence item, receipt, duration, and usage count below is
illustrative. Transaction execution evidence is synthetic; payments are simulated.
No provider delivered this trace, no inference request ran, and no credits were spent.
Acceptance will require recorded authentic evidence as well as controlled fault cases.

## Input and limits

The owner supplies `network=Base Sepolia` and a mined failed transaction hash.
For this illustration, `TX` means `0x` followed by `ab` repeated 32 times;
`BLOCK` means `0x` followed by `cd` repeated 32 times. Neither is a real lookup.
Investigation network and payment network are separate policy fields.
Rehearsal payment mode is simulated; live execution-data purchases are disabled.

```text
ILLUSTRATIVE — proposed terminal interaction, no runnable investigator CLI
input: Base Sepolia / TX
limits: 1 trace / 3 inference requests / 8 tool calls / 120 active seconds
purchase budget: 0.010000 simulated USDC; maximum 0.005000 per purchase
inference allocation: 5 prepaid credit slots; reserve final slot for reporting
destinations: configured execution endpoint/method/network/asset/payee only
inference: configured Haze gateway and service class only
```

## Collect public evidence before purchasing

```text
[E1 transaction] TX; chain 84532; block 12345678 / BLOCK
[E2 receipt]     TX; same block; status=0; no useful event logs
check           transaction, block identity, and failed receipt agree
unanswered      Which nested call failed, and what revert data did it return?
decision        Public evidence establishes failure, but cannot locate it.
                A trace can answer that specific question; request one trace.
```

This is where x402 would supply paid execution data: a provider challenges the
resource request with a quote; the controller checks its accepted terms before
any payment authorization. The custom inference proof does not purchase the trace.

## Rehearse one necessary purchase

```text
[Q1 simulated quote] exact / configured test payment network / USDC / configured payee
                     price 0.004000 simulated USDC
check                Endpoint and terms match policy; price fits both limits.
[P1 simulation]      Accept quote; no signature or token transfer performed.
[R1 mock receipt]    simulated-settled; simulated amount 0.004000 USDC
[E3 fixture trace]   delivered; transaction and block match E1/E2
                     frame 0 CALL -> frame 1 CALL transferFrom -> REVERT
                     frame 1 revert data decodes as Error("ERC20: insufficient allowance")
check                Decode is reproducible; failed child propagates to frame 0.
```

The fixture is synthetic and is not a provider response. The receipt is a mock
receipt and has no settlement transaction. Alchemy remains a provisional trace
candidate; a quote does not verify delivery or a Base Sepolia payment route.

## Bounded interpretation through prepaid inference

```text
[I1 illustrative] Interpret E1/E2; identify the unanswered trace question.
[I2 illustrative] Interpret E3; distinguish its decoded error from possible causes.
[I3 illustrative] Produce a report from the checked evidence and uncertainty.
check              Validate factual references and decoding deterministically.
totals             1 trace; 3 inference requests; 6 tool calls; 46 active seconds
```

These inference exchanges would use the existing request-bound `zk-prepaid`
adapter, with local slot retirement and committed consumption recorded separately.
The numbers here illustrate the presentation only. None demonstrate runtime behavior.

## Outcome a developer can act on

```text
ILLUSTRATIVE REPORT — SYNTHETIC EVIDENCE / SIMULATED PURCHASE
Transaction: Base Sepolia / TX / block 12345678 / BLOCK
Observed facts:
  The mined transaction failed. [E1, E2]
  A nested transferFrom call reverted; its error text reports
  "ERC20: insufficient allowance" and the failure propagates outward. [E3]
Supported diagnosis:
  Execution failed at the nested transferFrom call with that decoded error. [E3]
LLM hypothesis:
  The allowance may have been below the attempted transfer amount.
  Missing: pre-call allowance and amount validation; verified contract source.
Suggested developer check:
  Identify owner/spender from the trace and inspect allowance at the execution
  pre-state; compare with the transfer amount. [E3 + labelled hypothesis]
Uncertainty:
  Error text alone does not prove the token's implementation or the underlying
  allowance state. No source-level claim is supported without verified source.
```

The report provides a failure location and a concrete check. It does not promise
that changing allowance fixes the transaction or perform a remediation transaction.

## Separate budgets and receipt summary

| Item | Illustrative outcome | Limit |
| --- | --- | --- |
| Execution purchase P1 | 0.004000 simulated USDC, mock receipt R1, fixture delivered | 0.005000 per purchase |
| Purchase budget | 0.004000 simulated spent; 0 held; 0.006000 remaining | 0.010000 simulated USDC |
| Inference allocation | 3 slots retired; 2 unallocated slots remain available | 5 credit slots |
| Confirmed inference consumption | 3 committed credits, illustrative only | Separate from USDC |
| Inference requests | 3 | 3 |
| Tool calls / active time | 6 / 46 seconds | 8 / 120 seconds |

The intended owner-local record includes policy, evidence references, purchase
rationale, accepted terms, attempt outcomes, settlement references, retired slots,
and committed consumption. It excludes secrets, proofs, raw prompts/responses,
and credential files. Nothing uploads automatically.

## Same presentation when evidence or payment is uncertain

- Public evidence suffices: skip Q1/P1 and show `purchase=0; reason=not needed`.
- Trace unavailable: return narrower supported findings or `insufficient evidence`.
- Payment outcome ambiguous: retain its budget hold, reconcile the same attempt
  at most three times within the tool/time limits, and do not authorize a duplicate.
- Settlement confirmed but evidence missing: show settled cost and missing delivery
  separately; settlement does not establish delivery. Return a partial report.
- Inference uncertain: show retired slots separately from confirmed consumption;
  no new request using a retired slot. Use only supported exact-request replay.
- Limits reached: return a partial report with stop reason, missing evidence,
  confirmed costs, and held costs. No automatic top-up or larger allocation.
- Inference unavailable: return an owner-local factual summary without inventing
  a diagnosis or spending beyond the remaining allocation to produce a report.
- Block identity changes: invalidate the evidence and stop for a fresh run.
- Pending/dropped, pre-submission, or cross-chain inputs: explicit unsupported result.

## Reader-facing verification criteria for owner review

1. The short README lets a reader distinguish today's coding transport from the
   proposed investigator before installing anything, and names actual prerequisites.
2. Its example runs locally, initially fails for a known duplicate-count bug, and
   a coding run can produce a reviewable diff and passing preserved assertions.
3. A reader can explain why the trace purchase is necessary in this walkthrough,
   when it is skipped, and how its USDC budget differs from inference credits.
4. Every factual report claim points to an evidence item; hypotheses state missing
   evidence and a distinguishing check. Synthetic evidence remains labelled.
5. A partial report visibly distinguishes delivery, settlement, held budget,
   retired slots, and committed consumption without exposing credential data.
6. Later implementation acceptance uses authentic transaction fixtures and controlled
   failures; verified live paid delivery is required before advertising that capability.

These are proposed reader-facing criteria, pending the owner's reaction. This
asset does not settle the separate implementation-boundary decision.
