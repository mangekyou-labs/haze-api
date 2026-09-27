# Base Sepolia recovery and exchange handoff

Date: 2026-09-24  
Status: recovery lookup unresolved; internal trial stopped before credential
restore and exchange.

## Goal and constraints

Resolve the operator's `bundle_not_found` recovery result, then complete the
two internal exchange paths already defined in the trial plan. This remains an
internal technical trial: it is not an external operator activation, issue 26
stays open, and the Preview stays unpromoted.

Keep the capsule, password, derived commitment, credential, proof, RPC URL,
and credentials private. Ask the operator only for recovery success or the
visible error phase/status. Do not fund during recovery, consume a trial slot
before all gates pass, or log secret-bearing request data.

## Current evidence

- The operator reported `No funded credential bundle was found for this
  recovery capsule.` and response body `{"error":"bundle_not_found"}`. Their
  report did not include an HTTP status. No capsule material or local
  credential was provided to this process.
- In the current source, the browser decrypts and verifies the capsule locally,
  then sends the derived commitment to `GET /api/pilot/recovery`. The route
  asks the gateway first and runs `findFundedBundleOnBase` only after the exact
  gateway response `404 bundle_not_found`. A null Base result also returns
  `404 bundle_not_found`. Chain/config errors use other error codes.
- The current local UI maps any 404 to the reported “No funded credential
  bundle” message. The extra text `Response was:` does not occur in the
  current local recovery source or browser suite. Deployment/source mismatch
  remains an open hypothesis.
- A synthetic **unfunded** commitment returned `bundle_not_found` through
  authenticated Preview access in the prior checkpoint. That verifies the
  route can answer an expected miss; it does not verify the operator's funded
  bundle.
- Existing behavior coverage is in
  [`route.test.ts`](../../web/src/app/api/pilot/recovery/route.test.ts),
  [`base-recovery.test.ts`](../../web/src/lib/base-recovery.test.ts), and
  [`pilot-recovery.spec.ts`](../../web/e2e/pilot-recovery.spec.ts). It covers
  the gateway-miss/Base-success path, an absent Base bundle, and the browser's
  no-funding error. A duplicate test for the same expected absent-bundle case
  would not diagnose this report.
- The fresh local checks recorded in the
  [trial ledger](base-sepolia-internal-trial.md) passed, but they use generated
  fixtures or mocked lookups and do not establish the operator's on-chain
  bundle state. The latest fresh Vercel inspection returned no metadata; use
  the earlier authenticated `READY` Preview record only as historical
  evidence.

## Next two diagnostic loops

Keep the loops distinct. Do not ask the operator to repeat the same click
before completing the deployment check.

1. **Verify the Preview that served the error.** In the linked Vercel project,
   inspect the exact deployment URL the operator used. Confirm that it is the
   authorized, unpromoted Preview and that its build contains `/recover` and
   `/api/pilot/recovery`. Compare the page's recovery behavior with the current
   source. Inspect environment variable names and scope only; never print or
   export values. If the deployment is stale or the operator used another URL,
   correct the target using the already approved deployment scope, rerun the
   synthetic unfunded check, and then request one operator retry.

2. **Use the retry as the live discriminator.** Once deployment identity and
   route version are confirmed, have the operator open that exact Preview
   `/recover` page, retry locally with the same intended capsule and password,
   and report only success or the visible error phase/status. If recovery
   succeeds, proceed to the trial gates below. If the same 404 returns, stop
   blind retries. Do not request or inspect the capsule, password, commitment,
   browser storage, proof, or credential.

The response has two meaningful interpretations under the current source:

- If the deployed source is stale, align the Preview with the reviewed local
  source under the existing deployment authorization, then repeat the
  synthetic check and one browser check.
- If the deployed source is current and it returns `bundle_not_found`, the
  lookup found no active funded bundle for the locally derived commitment. The
  existing behavior is consistent with the recovery contract; this is not
  evidence of a code defect by itself. Record the trial as stopped. The
  operator may check locally that the selected capsule is the one that was
  re-imported for the funding attempt; they must not send identifying values.
  Continue only after a locally valid recovery attempt succeeds or a concrete
  code/config mismatch is identified.

If a distinct mismatch is reproduced, first name the falsifiable hypothesis
and use the existing approved recovery seams: API route, Base reader, or
browser. Add one failing behavior test at that seam, observe red, make the
smallest fix, observe green, then rerun the original local browser path and the
affected verification suite. Do not add a test that merely restates the
already-covered empty-bundle response.

## Ticket or QA plan?

Do not create another grilling ticket just to repeat recovery attempts. The
approved behavior is already explicit: recovery looks up an existing funded
bundle and never funds one. Create a focused grilling ticket only if the
deployment and lookup evidence exposes a genuine unresolved product decision,
such as conflicting requirements for which authoritative record wins. Keep it
under the existing Wayfinder map rather than opening a duplicate launch issue.

After the recovery cause is fixed or the correct funded capsule is available,
the more useful follow-on artifact is a human QA runbook for the completed
flows. It should make each local-only action, expected phase, stop condition,
and sanitized report explicit. Use the checkpoint list below as its outline.

## Human trial checkpoints after recovery

The operator performs all credential actions locally. The operator reports
only success or the failing phase; they never send credential or proof
material.

1. Open the exact authenticated Preview `/recover` page. Select the local
   recovery capsule, enter its password locally, and restore. Stop at the first
   error. On success, keep the downloaded activated credential local.
2. Configure the pinned local client from that downloaded file and password.
   Confirm the credential export is present, the sidecar is stopped, and the
   durable slot ledger has sufficient capacity.
3. Immediately before the Codex sidecar exchange, collect fresh `/ready`,
   authenticated `/v1/admin/status`, launcher, available-credit, and counter
   snapshots. Proceed only if readiness passes, pilot control is enabled, the
   Base root is current, the bundle is usable, and credits suffice.
4. Run one Codex sidecar exchange. Record whether each phase passed: 402
   challenge, local proof, proof self-check, `PAYMENT-SIGNATURE`, settlement,
   successful response, `PAYMENT-RESPONSE`, and expected counter delta. Stop
   at the first failing phase, record only sanitized phase/status/deltas, and
   stop the sidecar.
5. Immediately before the direct-client exchange, collect a second fresh set
   of the same readiness, admin, launcher, credit, and counter snapshots.
   Require all gates again. Run the separate registered `zk-prepaid` adapter
   path with local proof generation and the same durable slot ledger; record
   the same phases and counter delta. Stop at the first failure.
6. Update the internal evidence ledger with each outcome. Do not treat either
   internal call as an external operator activation. Keep issue 26 open and
   the Preview unpromoted.

## Skills and repo guidance for the next pass

- `$diagnosing-bugs`: use a tight red-capable loop, rank falsifiable
  hypotheses, and stop guessing if no loop can reproduce a distinct bug.
- `$tdd`: add a regression test first only after a real behavior mismatch is
  reproduced at the approved API, Base reader, or browser seam.
- `$implement` (`ai-devkit:dev-implementation`): make the smallest approved
  fix and keep implementation/testing evidence aligned.
- `$build-on-base`: verify Base Sepolia chain ID `84532`, deployment domain,
  contract state, funding event, and confirmation checks without exposing RPC
  settings or broadcasting a transaction.
- `$wayfinder`: continue under the existing
  [`base-zk-credits-pilot` map](../wayfinder/base-zk-credits-pilot/map.md) and
  its domain glossary. The repo map names `wayfinder` guidance; no standalone
  `wayfinder` skill is installed in the current skill catalog.
- `$verify`: use fresh command output before claiming a fix, deployment, or
  trial phase passed.

## Exact Preview follow-up (2026-09-24)

- The operator confirmed the latest recovery report came from
  `https://zk-credits-8xa8g3too-gadillacers-projects.vercel.app`, the same
  immutable Preview URL recorded for deployment
  `dpl_3SVvVaVa1XTofs8FR7itGcJ96J9U`. A fresh `vercel inspect` reported
  `zk-credits-web`, target `preview`, status `Ready`, and that exact URL. The
  Preview remains unpromoted.
- The operator's visible `bundle_not_found` result included no HTTP status.
  The response is consistent with an absent funded bundle under the current
  route, but the report alone does not establish which deployed lookup branch
  responded. The browser page/API build identity has not been independently
  inspected from an authenticated browser session here. Do not ask for a
  second retry unless a concrete stale-page or configuration mismatch is
  found.
- The existing deployment record lists the six runtime setting names and
  deployment-only scope: `GATEWAY_URL`, `BASE_RPC_URL`,
  `BASE_PRIVATE_CREDIT_BOND_ADDRESS`, `BASE_DEPLOYMENT_BLOCK`,
  `BASE_DEPLOYMENT_DOMAIN`, and `BASE_CONFIRMATIONS`. The project-level
  Preview variable listing was empty. No values were read into this record.
- A direct read-only Base Sepolia RPC check from this runner could not connect.
  The earlier authenticated synthetic unfunded lookup on this same immutable
  deployment returned the expected `bundle_not_found`; that established the
  fallback's empty-result path for a synthetic identifier only. No operator
  event, bundle state, event root, or confirmation depth was independently
  checked. The operator's commitment stays local.
- GitHub issue inventory could not be refreshed: `gh auth status` is
  unavailable, and anonymous issue-page fetches returned cache misses. No
  duplicate check or remote ticket creation was completed. Sanitized ticket
  drafts are in
  [`base-sepolia-qa-ticket-drafts-2026-09-24.md`](base-sepolia-qa-ticket-drafts-2026-09-24.md).
- Recovery remains stopped. No fresh `/ready`, authenticated admin status,
  launcher, credit, or counter snapshots were collected; no exchange or slot
  was consumed. Keep issue 26 open and the Preview unpromoted.
