# Base Sepolia recovery and QA ticket drafts

Status: **drafts only; not posted to GitHub**

Before creating either issue, refresh the repository's live issue inventory
and check for equivalent open or closed issues. Attach both as children of the
existing Wayfinder map titled **Wayfinder map: invite-only unpaid x402-agent
pilot on Base Sepolia** and apply `wayfinder:task`. Use the tracker's native
blocking relationship so the QA task is blocked by the recovery task. Keep
the pilot launch issue open. The current issue tracker could not be reached
with the available GitHub authentication, so the parent issue identity and
duplicate check are not yet confirmed.

These drafts contain no capsule, password, commitment, credential, proof, RPC
setting value, or secret-bearing request data.

## Ticket 1

Title: **Verify Preview recovery deployment and funded-bundle lookup**

```markdown
## Purpose

Verify the unpromoted Base Sepolia Preview recovery path and record what the
funded-bundle lookup established. Keep the invite-only pilot launch issue
open.

Current reference: the operator confirmed the latest report came from
`https://zk-credits-8xa8g3too-gadillacers-projects.vercel.app` (deployment
`dpl_3SVvVaVa1XTofs8FR7itGcJ96J9U`), which was inspected as target `preview`,
status `Ready`. The report showed `bundle_not_found` but did not include an
HTTP status. This response alone is not evidence of a code defect.

## Checklist

- [ ] Verify the exact immutable Preview URL and deployment identity. Confirm
  its `/recover` page and `/api/pilot/recovery` build/version correspond to
  the reviewed recovery implementation. Record only URL, deployment identity,
  build/version, and status.
- [ ] Verify the names and deployment scope of the six server-side runtime
  settings: `GATEWAY_URL`, `BASE_RPC_URL`,
  `BASE_PRIVATE_CREDIT_BOND_ADDRESS`, `BASE_DEPLOYMENT_BLOCK`,
  `BASE_DEPLOYMENT_DOMAIN`, and `BASE_CONFIRMATIONS`. Record names and scope
  only; never print or copy values.
- [ ] Use the existing authenticated synthetic unfunded lookup result for
  this immutable build, or repeat that check only if the Preview is corrected.
  The expected `404 bundle_not_found` confirms an empty lookup and is not a
  bug. Do not use an operator identifier for this check and do not fund a
  bundle.
- [ ] If a stale page or wrong deployment is found, align the already
  authorized unpromoted Preview, repeat the synthetic check, then allow one
  operator retry. The operator reports only success or the first visible
  error phase/status.
- [ ] If the verified current path returns `bundle_not_found` again, stop
  retries and record that no active funded bundle was returned for the local
  recovery attempt. Do not ask for the capsule, password, commitment,
  credential, proof, browser storage, or RPC settings.
- [ ] If a distinct mismatch is reproduced, name the falsifiable mismatch and
  add a failing behavior test at the API, Base-reader, or browser seam before
  the smallest fix. Verify the fix and the original local path.

## Completion

Record the deployment identity, configuration names/scope, lookup outcome,
and first visible error phase if any. Do not treat the expected empty-bundle
response as a bug. Keep the Preview unpromoted and the pilot launch issue open.
```

## Ticket 2

Title: **Run Base Sepolia internal recovery and exchange QA**

```markdown
## Purpose

Run the internal Base Sepolia recovery and both `zk-prepaid` exchange paths
after the recovery task is complete. Keep all credential actions local.

## Ordered runbook

- [ ] 1. Open the verified authenticated Preview `/recover`. Restore the
  intended capsule locally and retain the activated credential locally.
  Report success or the first visible error phase/status only. **Stop here if
  recovery fails.** Do not send capsule, password, commitment, or credential
  data.
- [ ] 2. Configure the pinned local client. Confirm the credential export is
  present locally, the sidecar is stopped, and the durable slot ledger has
  sufficient capacity. **Stop if any check fails.**
- [ ] 3. Collect fresh `/ready`, authenticated `/v1/admin/status`, launcher,
  credit, and counter snapshots. Require readiness, enabled pilot control, a
  current Base root, a usable bundle, and sufficient credits.
  **Stop if any gate fails or the snapshots are stale.**
- [ ] 4. Run one Codex sidecar exchange. Record sanitized pass/fail and status
  for the 402 challenge, local proof, proof self-check, `PAYMENT-SIGNATURE`,
  settlement, successful response, `PAYMENT-RESPONSE`, and counter delta.
  **Stop at the first failed phase and stop the sidecar.** Continue only if
  every phase passes.
- [ ] 5. Collect a **second fresh** set of the same gate snapshots and require
  every gate again. Run one direct client exchange through the registered
  `zk-prepaid` adapter using the same durable slot ledger. Record the same
  phases and counter delta. **Stop at the first failed gate or phase.**
- [ ] 6. Update the internal evidence ledger with each outcome and first
  failure, if any. **Stop after recording sanitized outcomes.** Keep the
  Preview unpromoted and the pilot launch issue open.

## Evidence rules

Record only sanitized outcomes, visible phases/statuses, and aggregate counter
deltas. Never add a capsule, password, commitment, credential, proof, RPC URL,
secret, or secret-bearing request data to this issue or logs. These internal
calls do not count as external operator activations.
```

Dependency: create the native issue-tracker blocking edge from **Run Base
Sepolia internal recovery and exchange QA** to **Verify Preview recovery
deployment and funded-bundle lookup** after both issue IDs exist.
