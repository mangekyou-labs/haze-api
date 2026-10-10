## Deliverable

Record and review the founder coding demo and the x402 transaction-investigator segment, then prepare truthful private materials for the **$5,000 Base Builder Grant target**. Aim for a 2–3 minute main clip; use a separate 60–90 second investigator clip if both do not fit. These are uncounted technical demos, not external adoption evidence.

**Next action: verify the installed `zk-credits@0.2.12` commands, then record.** Registry version and artifact integrity were verified on 2026-10-10. Publication is an owner action authorized separately from hosted pilot launch; this ticket does not authorize cohort launch or grant submission.

## Package preparation — complete; recording still pending

- [x] Prepare version 0.2.12 with automatic supported Codex model/reasoning defaults, coding-task evidence and investigator commands.
- [x] Build and pack the release; pass 142 sidecar tests and 144 investigator controller tests.
- [x] Install the exact tarball outside the checkout, check its commands/exports/proving archive, and pass npm publication dry-run. Version 0.2.12 is now published with the expected registry integrity.

The new installed tarball's paid rehearsal fixed the sample and passed all four unchanged tests, but encountered an upstream 502 and exceeded the 240-second harness limit before printing its final summary. It is **not** a passing complete payment-evidence rehearsal. Canonical accounting was retained and the sidecar is stopped. The earlier successful rehearsal remains separate evidence; the filmed run must pass the checks below.

## 1. Verify the published package — off camera

Version 0.2.12 is published. Before recording, verify the registry integrity and
installed commands against the [release handover](../releases/zk-credits-0.2.12.md).

- [ ] Verify and install the published version:

  ```sh
  npm view zk-credits@0.2.12 version dist.integrity --registry https://registry.npmjs.org
  npm install --global zk-credits@0.2.12 --registry https://registry.npmjs.org
  npm ls --global zk-credits --depth=0
  zk-credits --help
  ```

  **Pass:** installed version is 0.2.12, integrity matches the release handover,
  and help lists `codex --task-evidence` and `investigate`. Resolve any mismatch
  before recording. Keep npm authentication output private.
- [ ] Run `zk-credits doctor` and `zk-credits status` privately. Reuse the existing configured credential and its canonical accounting. A stopped default sidecar is acceptable: both demo commands open their own runtime. Missing setup, invalid RPC, credential expiry, exhausted credits or an unresolved payment outcome must be resolved before filming. Only on a genuinely unconfigured device, import privately with `ZK_CREDITS_CREDENTIAL_PATH=/absolute/path/to/activated-credential.json zk-credits setup codex`; do not replace the existing coding credential with the browser acceptance credential.
- [ ] Close any Codex/investigator session and run `zk-credits stop` if the managed background sidecar is running. Never reset, delete or copy the slot ledger, investigation journals, or credential home to force a fresh call. Keep the same canonical `ZK_CREDITS_HOME` throughout.

## 2. Prepare the screen and broken sample — off camera

- [ ] Enable Do Not Disturb, enlarge terminal text, and capture only the demo windows. Close `.env`, credential/recovery files, password managers, raw proof/payment logs and personal tabs. Check audio and a short screen-capture test.
- [ ] Open `https://hazecredits.vercel.app` at the completed **250-call Base Sepolia activation**. Keep account identifiers and credential download controls off camera. Show the existing confirmation; the sponsor pool was depleted by acceptance, so another activation requires replenishment. Stripe dollars are simulated and do not fund onchain USDC.
- [ ] Create a fresh broken sample from the checkout; do not reuse a repaired rehearsal:

  ```sh
  cd /Users/kyler/repos/feature-zk-api-credits
  DEMO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/haze-founder-recording.XXXXXX")"
  cp examples/base-usdc-indexer/indexer.mjs examples/base-usdc-indexer/indexer.test.mjs examples/base-usdc-indexer/package.json "$DEMO_DIR/"
  cd "$DEMO_DIR"
  git init -q
  git add indexer.mjs indexer.test.mjs package.json
  git -c user.name='Founder demo' -c user.email='demo@example.invalid' commit -qm 'Broken indexer baseline'
  npm test
  ```

  **Pass:** exactly two tests fail (duplicate logs and hash casing), two pass (distinct transfers and distinct chains). **Stop:** all tests already pass, missing files, or a different failure. Keep this terminal open for recording.
- [ ] Keep the exact task text ready to paste: “Read indexer.mjs and indexer.test.mjs. Fix the duplicate-log bug in indexer.mjs; deduplicate by chain ID, lowercase transaction hash and log index, preserve distinct transfers and chains, complete the edit and run npm test without changing tests.”

## 3. Record the coding demo

- [ ] Start recording. Run `npm test` in the fresh sample and show the expected two failures. Say: “This Base USDC transfer indexer double-counts repeated RPC logs.”
- [ ] Switch to the dashboard and show the existing confirmed activation. Say: “This is a completed Base Sepolia test activation. Stripe dollars are simulated.” Do not imply a fresh checkout happened during filming or that this browser bundle funds the coding credential's spends.
- [ ] Return to the sample terminal and launch:

  ```sh
  zk-credits codex --task-evidence
  ```

  Paste the prepared task. The package supplies the supported model and reasoning defaults; no `node` checkout path, model flags or `--ignore-user-config` are needed. Approve the sample edit/test actions if Codex requests them.
- [ ] Let the agent finish. Review its change, then exit Codex with `/exit` so the wrapper prints this session's aggregate evidence. Run:

  ```sh
  git diff -- indexer.mjs
  git diff --exit-code -- indexer.test.mjs package.json
  npm test
  ```

  **Pass:** only the implementation changes, all four unchanged tests pass, and the fix keeps distinct transfers and chains while normalizing hash casing. **Stop:** tests edited, unrelated changes, incomplete fix or failing tests.
- [ ] Show only this run's redacted summary. **Pass:** `agentExitCode: 0`, `status: exchange_verified`, `challengesReceived >= 1`, `localProofsVerified >= 1`, `paymentsPrepared >= 1`, `committedClaims >= 1`, `successfulResponses >= 1`, and `failures: 0`. Exact counts can vary; do not require the prior rehearsal's five calls. Explain 402 challenge → local proof and `PAYMENT-SIGNATURE` → settlement and model delivery with `PAYMENT-RESPONSE`; do not expose raw headers. **Stop:** incomplete summary, zero committed claims, any failure, or evidence copied from another run.

## 4. Record the x402 transaction investigator

This segment demonstrates public Base transaction evidence plus **prepaid model analysis**. It does not buy an external trace. The investigated transaction is on Base mainnet; bundle funding is Base Sepolia test USDC and inference credits are consumed offchain through the custom `zk-prepaid` adapter.

- [ ] Confirm Codex has exited before opening the investigator. Keep its credential and journals in place. Open the failed transaction in BaseScan: `https://basescan.org/tx/0xc4744cb2714fa9238da819c4299f091302c0dc170acb0886bb975234ac10c69b`. Show the failure and investigated chain without joining funding identifiers to spend evidence.
- [ ] Choose the evidence path before filming. **Prepared path:** use the saved successful report below, visibly labeled “Prior validated run — 2026-10-08”. Both previously validated hashes currently recover partial stopped-task evidence; repeating them is not a guaranteed fresh paid diagnosis. **Fresh path:** first have a different real failed Base transaction checked for available public evidence, absent prior local task, and no unresolved payment outcomes; do not fabricate a new task by deleting journals. A rehearsal on that hash makes the later recording a recovery, so capture the first paid invocation if a live exchange is the goal.
- [ ] For the prepared path, show the installed command as the command used in the prior run, without claiming to execute a new paid request:

  ```sh
  zk-credits investigate --chain base 0xc4744cb2714fa9238da819c4299f091302c0dc170acb0886bb975234ac10c69b
  ```

  Display local `docs/wayfinder/base-transaction-investigator/founder-live-report-2026-10-08.txt` with the prior-run label. If you also execute the command today, keep its current output separately labeled; `partial (recovered_stopped)` / zero new credits is recovery evidence, not a new exchange or complete diagnosis.
- [ ] For the fresh path, run `zk-credits investigate --chain base <fresh-transaction-hash>` while recording. **Pass:** a useful report cites original public execution evidence, retains missing-evidence notices, observes at least one 402 challenge and model delivery, confirms consumed credit(s), and reports zero failed/unknown outcomes. **Stop:** unavailable evidence, partial report, no paid model delivery, failure or unknown outcome. Preserve state and reconcile ambiguity; do not keep retrying for a cleaner recording. Switch to the labeled prior-run path if needed.
- [ ] Show the diagnosis and one concrete next check. In the saved example, the observed returned error is `AerodromeV3: insufficient received`; slippage protection is a hypothesis. The next check is swap calldata/minimum output. Do not claim that the underlying cause or deepest failing call is established.
- [ ] Show payment evidence belonging to the report being presented. The saved successful report has **one 402 challenge, model delivery observed, one confirmed consumed credit, zero failed outcomes and zero unknown outcomes**. A fresh report must use its own counters. Never attach the coding session's summary or gateway-wide totals to this investigation.
- [ ] Narrate: “The investigator fetched public evidence for a failed Base mainnet transaction and used Haze for the model call. [In this prior validated run / In this run], x402 requested a local payment proof and prepaid credit consumption was confirmed. Funding is on Base Sepolia; individual calls consume credits offchain.” State that this is the custom `zk-prepaid` adapter, not compatibility with every unmodified x402 client.

## 5. Close and review the recordings

- [ ] Close with experimental/testnet/unaudited scope and one concrete next milestone you intend to deliver. If stating $5,000, call it the grant **target**, not an award or verified entitlement. Keep the coding clip at 2–3 minutes; split the investigator into a 60–90 second companion clip if needed.
- [ ] Watch the exported clips from start to finish, including audio, window transitions, menus and thumbnails. Remove credentials, recovery files, keys, endpoint secrets, raw payment/proof data, nullifiers, request signals, private content and identity-to-spend joins.
- [ ] Check that the filmed code fix and payment summary belong to the same coding run, investigator evidence belongs to the presented investigation, and saved outputs remain labeled throughout. Keep incomplete/recovered results separate from successful paid evidence.
- [ ] Save reviewed clips privately and record their duration, review date and access-controlled location. Test playback and access. Do not post an unrestricted video URL or raw logs into this issue.

## 6. Prepare funding materials and resolve this ticket

- [ ] Prepare a short factual project summary: developer problem, working coding/investigator flows, Base Sepolia funding versus offchain consumption, experimental/unaudited limitations, one next milestone and proposed use of the $5,000 target. Founder demos establish technical evidence, not external adoption, product revenue or willingness to pay.
- [ ] Check the current official [Builder Grant application](https://docs.google.com/forms/d/e/1FAIpQLSeEFi9BLm5XCm7KrFzRZC-rxcAqCNZPzWZ9He4aZkxsKuRXjw/viewform). Record the date, official URL, round status, amount, eligibility and submission route. The historical 2026-09-30 check found Round 1 closed; do not reuse it as a current check. If inaccessible, record “unverified” and keep this item open.
- [ ] Add a resolution comment with reviewed private clip/material pointers, coding outcome and aggregate counters, investigator fresh/prior-run designation and its own counters, package version/integrity, review date and current grant-route check. Omit secrets and funding-to-spend mappings.
- [ ] Close only after recording, review and private funding preparation are complete. Package publication, grant submission, award and external pilot activation must each be reported only when actually completed; submission and pilot launch are separate actions.

## References

- Local package publication handover: `docs/releases/zk-credits-0.2.12.md`.
- Local recording guide: `docs/onboarding/base-zk-credits-grant-video.md`.
- Prior paid coding acceptance: `docs/onboarding/grant-demo-live-preflight-2026-10-08.md`.
- Investigator evidence and limitations: `docs/wayfinder/base-transaction-investigator/founder-live-validation-2026-10-08.md` and `founder-live-report-2026-10-08.txt` in that directory.
- [Completed preparation, hosted acceptance evidence and archived history](https://github.com/mangekyou-labs/haze-api/issues/35#issuecomment-6056524223).
