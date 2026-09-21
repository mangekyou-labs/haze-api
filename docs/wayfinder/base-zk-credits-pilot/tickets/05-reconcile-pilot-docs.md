# Review the reconciled pilot design and implementation plan

Type: prototype  
Status: resolved  
Assignee: grok  
Claimed: 2026-09-20  
Resolved: 2026-09-20  
Blocked by: tickets 03 (closed), 04 (closed), and 06 (closed)

## Question

After the prerequisite decisions close, do the requirements, design, testing,
and planning documents describe one coherent, testable, economically bounded,
and implementable Base Sepolia pilot?

## Prototype

Apply the closed prerequisite decisions to the lifecycle documents, then
review the resulting diff with the user before treating the design as
approved.

The reconciliation must at least:

- replace the unsafe proof statement and explicitly version the public-signal
  ABI;
- add freshness, real-verifier, independent-review, and artifact-freeze gates;
- make the x402 compatibility boundary and sidecar-first launch explicit;
- define the bounded credit unit and provider-cost controls;
- resolve the design/testing contradiction about streaming versus buffered
  encrypted replay;
- preserve reserve-before-dispatch and commit-only-after-success semantics;
- reconcile task statuses with implementation artifacts already present;
- give every task an outcome, dependencies, validation evidence, and test-plan
  traceability;
- add pilot activation, unit-economics, load, proof-latency, storage-growth,
  claim-store, event-cursor, and slashing-path benchmarks;
- record the prover topology and partner-accepted proving SLOs; and
- keep Base mainnet and ceremony execution behind a later go/no-go decision.

## Completion evidence

- `npx ai-devkit@latest lint --feature base-zk-credits` passes.
- `npx ai-devkit@latest lint` passes.
- Every testing scenario maps to at least one implementation task.
- No material architecture, scope, rollout, validation, or security question is
  silently assumed.
- The user explicitly approves the reconciled document set.

## Comments

### Round 1 (2026-09-20)

User accepted all recommended answers:

1. Approve the reconciled lifecycle set as the pilot plan.
2. Keep today's compiled R1CS/WASM/zkey as negative fixtures until the new
   compile is hash-pinned. Do not ship them.
3. Rewrite in place under current package and file names.
4. Leave the three-tier README SKU table until planning task B21.

## Answer

Yes. After tickets 01–04 and 06, the lifecycle documents describe one
coherent, testable, economically bounded, and implementable Base Sepolia
pilot. The user approved that set on 2026-09-20.

Approved artifacts:

- [requirements](../../../ai/requirements/2026-09-18-feature-base-zk-credits.md)
- [design](../../../ai/design/2026-09-18-feature-base-zk-credits.md)
- [testing](../../../ai/testing/2026-09-18-feature-base-zk-credits.md)
- [planning](../../../ai/planning/2026-09-18-feature-base-zk-credits.md)
- [implementation](../../../ai/implementation/2026-09-18-feature-base-zk-credits.md)
- [deployment](../../../ai/deployment/2026-09-18-feature-base-zk-credits.md)
- [monitoring](../../../ai/monitoring/2026-09-18-feature-base-zk-credits.md)

Evidence recorded with the prototype: `npx ai-devkit@latest lint --feature
base-zk-credits` and `npx ai-devkit@latest lint` passed from the
`feature-base-zk-credits` worktree; testing scenarios S1–S34 each map to at
least one planning task.

Locked with approval:

- Current compiled proving artifacts are negative fixtures, not shippable
  keys, until the restored circuit is compiled and hash-pinned.
- Implementation rewrites in place (`private_credit_spend.circom`,
  `PrivateCreditBond.sol`, `packages/x402-zk-prepaid`, sidecar, claim-store).
- README and dashboard SKU copy stay on planning B21; they are not part of
  this document approval.

This map's destination is the decision-complete plan. Execution starts from
planning B2/B3. Base mainnet and a production ceremony remain a later
go/no-go map.
