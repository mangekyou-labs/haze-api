# Internal Base Sepolia x402 trial

Status: **both internal paths completed their separate guarded Base Sepolia exchanges; issue #26 acceptance is met**
Checkpoint: 2026-09-28 15:23Z

This is an internal technical trial using one locally held credential. It is
separate from the invite-only external operator pilot. It does not count as an
operator activation. The external pilot and Preview promotion remain separate.

## Guarded Codex sidecar exchange succeeded (2026-09-28 15:22–15:23Z)

- After the owner restarted the one-proof listener and entered the credential
  password locally, a fresh machine-readable launcher gate at
  `15:22:26.711Z` passed local preflight, gateway readiness, V2 compatibility,
  provider readiness, authenticated admin, enabled launch control, and the
  current Base root scan (two known roots, block `47420317`, lag 12). The
  listener's authenticated proof and exchange counters were zero before the
  command. The aggregate gateway baseline had four challenges, three valid
  proofs, three new reservations, two committed claims, and two successful
  dispatches; it had no active claims.
- One ephemeral Codex command used the installed `zk-credits` profile, read-only
  sandbox, and the internal one-proof listener. It exited 0 and its final
  client-visible answer was exactly `B22-CODEX-OK`. The process runner closed
  stdin so Codex would begin the request immediately. No raw prompt or
  response body, proof, payment header, account identifier, or spend
  identifier was retained.
- The sidecar recorded one 402 challenge, one local proof attempt and
  self-check success, one prepared payment, one settlement confirmation from
  `PAYMENT-RESPONSE`, and one successful exchange; all failure counters stayed
  zero. The payment path sent `PAYMENT-SIGNATURE`. The post-run gate at
  `15:23:09.283Z` passed, and gateway deltas were `challenge_issued +1`,
  `proof_valid +1`, `reservation_new +1`, `claim_committed +1`, and
  `dispatch_ok +1`, with no new cancellation, dispatch error, or rejection.
  Claims ended at three committed in aggregate, with none reserved or ready.
  The durable local ledger moved from 10 to 11 committed slots of 250, with
  zero provisional slots. The spent listener was stopped.
- This result is distinct from the separately registered adapter result
  below. Both internal paths now satisfy the issue's protocol acceptance
  phases. Neither is an external operator activation or evidence for the
  external pilot.

## Interrupted Codex startup made no request (2026-09-28 15:17–15:22Z)

- A Codex subprocess survived a tool interruption while its stdin pipe
  remained open. The owner restarted the sidecar, and the surviving subprocess
  was terminated before another attempt. A second bounded launch also waited
  for stdin EOF; it timed out before reaching the sidecar. Both checks left
  the new listener's proof and exchange counters at zero, gateway aggregate
  counters unchanged, and the ledger at 10/250. The process runner then used
  a closed stdin for the successful exchange above.

## Codex payment succeeded; response conversion failed (2026-09-28 15:10–15:16Z)

- A fresh launcher gate at `15:10:51Z` passed readiness, V2 compatibility,
  provider, authenticated admin, launch control, and the current Base root
  scan. One guarded, ephemeral Codex command used the managed sidecar profile
  and read-only sandbox. The command exited 1 without the expected
  `B22-CODEX-OK` answer. Its raw output was not retained, so the exact CLI
  error from this attempt is unknown.
- The listener's authenticated metrics recorded one 402 challenge, one proof
  attempt and self-check success, one payment prepared, one settlement
  confirmation, and one successful exchange, with no local failure. Relative
  to the preflight gateway baseline, `challenge_issued`, `proof_valid`,
  `reservation_new`, `claim_committed`, and `dispatch_ok` each increased by one;
  dispatch errors and cancellations did not increase. The post-run gate passed
  and showed two committed claims in total with no active claims. The durable
  local ledger moved from 9 to 10 committed slots of 250. These observations
  establish that this Codex attempt settled and committed a gateway response,
  while the client-visible completion remained unsuccessful.
- A direct synthetic request to the pinned provider returned HTTP 200 with
  `choices[0].message.refusal: null`. Feeding that provider reply to the
  current Responses bridge reproduced `invalid_refusal`. The existing public
  bridge test was changed to use `refusal: null`; it failed with HTTP 502,
  then passed after the bridge accepted absent, null, or string refusal values
  and continued to reject other types. The three focused suites passed 18
  tests, TypeScript check passed, and the package rebuilt. The spent listener
  was stopped. A fresh guarded Codex retry remains necessary to prove the
  client-visible response.

## Codex dispatch diagnosis and local correction (2026-09-28 15:02–15:08Z)

- The pinned OpenRouter endpoint metadata advertised `max_completion_tokens`
  on one eligible endpoint, but did not advertise `parallel_tool_calls` on
  that endpoint. With the gateway's price ceilings, `allow_fallbacks: false`,
  and `require_parameters: true`, a short direct synthetic provider request
  returned HTTP 404 when `parallel_tool_calls: true` was included and HTTP 200
  when it was omitted. A separate synthetic request with a function tool and
  `tool_choice: auto`, but no parallel hint, returned HTTP 200. These provider
  probes were outside x402 and did not change the local slot ledger.
- A disposable Codex home and local fake Responses endpoint captured field
  presence only, without retaining any prompt or request body. Codex selected
  the managed model, provider, and reasoning effort and sent one request with
  nine tool declarations and `parallel_tool_calls: true`. Serving a catalog
  with `supports_parallel_tool_calls: false` still led this installed Codex
  CLI to send that field. This reproduces the parameter combination that the
  pinned provider rejects; the historical gateway did not retain its exact
  provider response, so the old dispatch subcause remains an inference.
- The sidecar Responses bridge now validates but omits the optional parallel
  hint from its Chat Completions request; its Codex model catalog no longer
  advertises parallel tool calls. An existing public `/v1/responses` bridge
  test first failed because it observed the forwarded field, then passed after
  the change. A separate catalog test failed then passed. The focused sidecar,
  Codex profile, and adapter suites passed 18 tests; the package TypeScript
  check and build passed. No live Codex request used this rebuilt bridge yet.
- A fresh launcher gate at `15:08:30.105Z` passed readiness, V2 pins,
  provider, authenticated admin, launch control, and the current Base root
  scan (two known roots, block `47419897`, lag 14). The gateway aggregate
  baseline was one committed and two cancelled claims, with no active claims.
  The Codex retry still requires a fresh gate at the moment of execution.

## Separately registered adapter succeeded (2026-09-28 14:55–15:01Z)

- The owner ran the separately registered adapter CLI after a fresh passing
  gate. The sidecar was stopped and authenticated admin snapshots before and
  after returned 200. The first request returned HTTP 400 before a challenge:
  `request_rejected +1`, with no proof attempt, payment, settlement, or slot
  change. The ledger stayed at 8/250. The CLI's sanitized result reported
  `failurePhase: challenge_status`, `challengeReceived: false`, and zero
  gateway deltas except `request_rejected +1`.
- Source inspection found the CLI included `stream: false` in the request body,
  while the gateway's fixed service class rejects the presence of any
  `stream` field. A regression test against the actual gateway normalizer
  failed on that body. The CLI now builds its request through the tested
  direct-trial body function without `stream`; the focused adapter suite passed
  4 tests, its TypeScript check and build passed.
- A fresh launcher gate at `14:58:05.833Z` passed. An unpaid POST using the
  rebuilt request body returned HTTP 402 with `PAYMENT-REQUIRED`, proving the
  corrected body reaches the challenge boundary. No payment header or proof
  was sent in this probe.
- The owner then ran the rebuilt, separately registered adapter CLI after its
  fresh gate and entered the credential password locally. Its sanitized JSON
  result reported passing readiness, admin status 200 before and after, and a
  stopped Codex sidecar. The challenge returned 402; local proof and self-check
  passed; `PAYMENT-SIGNATURE` was sent; payment returned 200 with a confirmed
  `PAYMENT-RESPONSE`; the response returned 200. One slot committed, moving
  the local ledger from 8 to 9 of 250 (available 242 to 241). The local
  counters each increased by one for proof attempt, proof success, challenge,
  payment preparation, settlement confirmation, successful exchange, and
  committed slot; failure counters stayed zero. Gateway deltas were
  `challenge_issued +1`, `proof_valid +1`, `reservation_new +1`,
  `claim_committed +1`, and `dispatch_ok +1`, with zero cancellations, dispatch
  errors, and rejections. Claim counts ended at one committed and zero
  reserved or ready. The credential, proof, request body, raw payment headers,
  and spend identifiers were not recorded.
- A post-run launcher gate at `15:01:00Z` passed. Aggregate gateway counters
  included the earlier failed Codex request and unpaid adapter probe; the
  per-exchange deltas above come from the adapter CLI's before/after snapshots.

## Latest guarded Codex rerun (2026-09-28 14:45–14:52Z)

- The owner started the worktree sidecar on `127.0.0.1:3210` with
  `--internal-trial-one-proof`. Process inspection confirmed PID `64115` and
  the expected command. Authenticated local metrics began with zero proof and
  exchange counters; the durable ledger held 7 committed slots of 250.
- The first fresh launcher gate at `14:48:09.477Z` could not reach the gateway,
  so no spend request was started. The gateway responded again, and a fresh
  gate at `14:49:50.395Z` passed local preflight, readiness, V2 pins, provider,
  authenticated admin status, launch control, and the current Base root scan.
  It reported two known roots, block `47419320`, lag 31, zero gateway exchange
  counters, and one historical cancelled claim. The eight newer diagnostic
  counters were absent from the live deploy and reported as `null`.
- A read-only Base Sepolia snapshot at block `47419374` showed sponsor ETH
  `0.099982616129848536`, sponsor USDC and allowance zero, and bond USDC
  `20.000000`. No chain transaction was sent.
- One ephemeral Codex command through the worktree wrapper used the installed
  managed profile and read-only sandbox. It exited `1` without the expected
  response. Filtered output contained HTTP 409 during the CLI's automatic
  reconnects, consistent with the one-request guard; no second command ran.
  No request or response body, proof, payment header, or identifier was kept.
- Local deltas were one 402 challenge received, one proof attempt and local
  self-check success, one payment prepared, zero settlement confirmations or
  successful exchanges, and one `settlement_failed` event. The ledger moved
  from 7 to 8 committed slots.
- The post-run gate at `14:51:54.836Z` passed. Relative to the zeroed gateway
  baseline, `challenge_issued`, `proof_valid`, `reservation_new`,
  `dispatch_error`, and `claim_cancelled` each increased by one; `dispatch_ok`
  and `claim_committed` remained zero. The current claim counts were zero
  reserved, ready, or committed and two cancelled in total. Thus the gateway
  accepted `PAYMENT-SIGNATURE` and reserved the claim, then cancelled it before
  settlement, response commit, or `PAYMENT-RESPONSE`. The aggregate counters
  still do not identify the dispatch subcause.
- The spent one-proof listener was stopped after reconciliation. The adapter
  result above is separate from this failed Codex request.

## Compatible live gate and provider preflight (2026-09-28 13:09–13:20Z)

- A fresh read-only launcher gate initially failed only because the live gateway
  deploy at `cbcdc49` exposes the 16 original aggregate counters, while the
  local launcher at `7c9e040` also expected eight newer payment-validation
  category counters. The Render deploy metadata identified the live commit;
  the newer counters were absent from that commit. The gateway readiness,
  provider, V2 compatibility, launch control, and current Base root checks all
  passed. This was a version mismatch in the observation schema, not evidence
  of a failed payment check.
- The launcher gate now requires all 16 original counters and all claim counts.
  It reports absent newer category counters as `null`; a present malformed
  counter still invalidates admin status. A test first reproduced the live
  schema failure through the launcher's JSON output, then passed after the
  change. A separate check keeps a missing original counter fail-closed. The
  focused launcher and gate suite passed 56 tests, and TypeScript typecheck
  passed.
- The fresh gate at `2026-09-28T13:15:28.961Z` passed: local preflight,
  readiness, V2 compatibility, provider, authenticated admin status, and
  launch control were all passing; the current Base scan had two known roots,
  last scanned block `47416506`, and 14 blocks of lag. The 16 original gateway
  counters were zero, the eight unavailable category counters were `null`, and
  claim counts were zero except one historical cancelled claim. A passing gate
  does not prove a completed exchange.
- [OpenRouter's endpoint list](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash/endpoints)
  showed 15 endpoints for the pinned model and one that advertised
  `max_completion_tokens` within the gateway's price ceilings. One short
  synthetic request using the gateway's model, price, fallback, and parameter
  constraints returned HTTP 200 with a choice. This checks upstream routing
  at this time; it does not classify the earlier gateway dispatch error and is
  not an x402 exchange.
- A read-only Base Sepolia snapshot at block `47416662` showed sponsor native
  balance `0.099982616129848536 ETH`, zero sponsor USDC and allowance, and
  `20.000000` USDC at the bond. No Base transaction was sent. The encrypted
  credential export is readable locally, the worktree CLI contains the
  one-proof guard, the managed Codex profile is installed, and the sidecar is
  stopped pending the owner's hidden password entry. No new proof, payment,
  gateway dispatch, settlement, claim commit, or credit spend occurred in this
  checkpoint. The Codex and registered-adapter outcomes remain separate and
  incomplete.

## Offline characterization of the dispatch cancellation (2026-09-28 12:35Z)

- The retained live record has no provider response, response body, request
  body, per-request gateway log, or claim-store error. The historical dispatch
  subcause remains unknown.
- Source tracing narrows the observed phase. Dispatch starts immediately before
  the provider request. A dispatch error can follow provider transport/status
  handling, response buffering and validation, replay encryption, or a
  pre-ready claim-store staging failure. The gateway only increments
  `claim_cancelled` when `cancelIfReserved` succeeds before `stageReady` has
  returned. A later commit error does not take that cancellation path; the
  claim would remain ready or could already be committed if the commit result
  were ambiguous. That does not match the recorded cancelled outcome. This
  narrows the phase but does not identify which pre-ready operation failed
  live.
- The agreed HTTP `/v1/chat/completions` seam already has a fast offline
  characterization with a synthetic provider, locally generated response key,
  in-memory claim store, and stubbed proof verification. Command:
  `npm test -- --run zk-prepaid-gateway.test.ts -t 'buffers a valid provider|cancels reserved claims on provider'`
  in `ts/`. Result: 5 selected cases passed. Four pre-ready provider failures
  (timeout, non-2xx, malformed JSON, and oversized response) return HTTP 502
  and cancel the reservation. The successful response is encrypted for replay,
  staged, committed, and returned with `PAYMENT-RESPONSE`. This is a synthetic
  behavior check, not a reproduction or classification of the historical
  provider/claim-store event.
- The offline characterization did not reproduce a gateway dispatch defect;
  the historical subcause remains unknown. A separate review found that the
  registered-adapter preflight accepted stale status and could pass without a
  provider readiness check. Its gate now requires a fresh readiness response,
  all six named checks, and a fresh authenticated admin snapshot. Focused tests
  cover missing checks, stale timestamps, and excessive future skew. This
  guard correction does not classify the historical dispatch failure.
- The gateway TypeScript check passed. The sidecar suite covered 24 files (23
  passed, 1 skipped; 91 tests passed, 3 skipped) and its build; the adapter
  suite passed 3 files / 22 tests and its build. No gateway, provider, Base,
  or payment request was made, and no ledger or slot changed. The Codex result
  remains unsuccessful, the registered adapter remains unattempted, and issue
  #26 stays open.

## Gateway rejection classification and version provenance (2026-09-28 11:27Z)

- This review used the local trial record, checked-in source, package manifests,
  and read-only GitHub metadata. No gateway, Base, provider, or payment request
  was made, and no ledger was changed.
- The 08:20–08:21Z run is bounded to gateway payment verification: the fresh
  snapshots show 12 challenges, 11 aggregate invalid-proof rejections, and no
  accepted proof, reservation, claim, or dispatch. The sidecar recorded six
  locally self-verified proofs and 11 payment rejections. The legacy
  `proof_invalid` counter covers all facilitator verification rejections; it
  does not identify a cryptographic-proof category. The exact per-request live
  category remains unknown.
- The listener record identifies PID `54844` and
  `packages/zk-credits-sidecar/dist/zk-credits.js serve`. The worktree package
  manifest for that rebuilt CLI is `zk-credits@0.2.5`, which was unpublished at
  the time. No executable hash was retained. Same-day first-party records name
  Codex CLI `0.157.1`, but the 08:20 record did not independently capture its
  version banner, so the exact invocation binary version is unverified.
- The passing compatibility gate and local manifest pin the Base Sepolia V2
  proving bundle release `v2.0.0` and verifying-key metadata. The protocol
  package source at fixed point `cbcdc49` is
  `@zk-credits/x402-zk-prepaid@0.1.0`, with requirements version
  `zk-prepaid-v1`; its frozen proof schema permits only `pi_a`, `pi_b`, and
  `pi_c`. The local evidence does not identify the gateway container digest or
  Fly release ID. Read-only Fly release inspection was unavailable because
  this environment has no Fly authentication, so the exact deployed gateway
  build remains unknown.
- A synthetic offline replay reproduced `invalid_payload_fields` when a real
  SnarkJS proof included extra `protocol` and `curve` properties. This remains
  a candidate for the live rejection, not a historical classification. The
  sidecar now emits only the three schema fields; the corrected proof passes
  offline verification and mock settlement. Rejected replay cases create no
  reservation and do not dispatch to the provider.
- Added fixed aggregate counters for `header`, `authorization`,
  `request_binding`, `wire_shape`, `public_signals`, `cryptographic_proof`,
  `verifier_unavailable`, and `other`. The authenticated metrics endpoint and
  machine-readable trial gate expose the fixed names. These source changes do
  not alter payment wire fields or rejection responses and are not present in
  the historical snapshot; the old 11-count cannot be split across them.
- The 09:22Z replay and this classification are separate from the later
  dispatch failure and the unattempted adapter exchange. Both exchanges remain
  incomplete, and B22 remains open.

## One-proof Codex rerun passed verification but failed before commit (2026-09-28 10:38–10:45Z)

- The restarted listener was PID `95002`, running the worktree
  `packages/zk-credits-sidecar/dist/zk-credits.js serve --port 3210
  --internal-trial-one-proof` on `127.0.0.1:3210`. It started at
  `2026-09-28 17:38:06 ICT`. The worktree Codex profile was installed and
  authenticated `/metrics` returned HTTP 200. The listener was stopped after
  post-run reconciliation.
- The fresh machine-readable gate passed at `2026-09-28T10:41:50.656Z` with
  readiness, V2 compatibility, provider, authenticated admin, launch control,
  and current Base root checks passing. Gateway counters and claims were all
  zero. Authenticated local proof and lifecycle metrics were zero; the durable
  ledger had capacity 250 and six committed slots.
- A read-only Base Sepolia snapshot at block `47411933` (chain `84532`) found
  sponsor native balance `0.099982616129848536 ETH`, sponsor USDC balance
  `0.000000`, sponsor-to-bond USDC allowance `0.000000`, and bond USDC balance
  `20.000000`. No transaction was sent.
- One ephemeral, read-only worktree Codex CLI command exited `1`. The filtered
  combined CLI output observed HTTP 409, consistent with the one-request guard
  blocking a later retry; no second Codex command was run. No request body,
  response body, proof, payment header, or spend identifier was retained.
- Local aggregate deltas were one proof attempt and self-check success, zero
  proof failures, one challenge received, one payment prepared, zero settlement
  confirmations, zero successful exchanges, and one `settlement_failed` event.
  The local slot ledger increased by one committed slot, from six to seven
  committed slots out of 250.
- Protocol-phase reconciliation: one 402 challenge was issued and received;
  one local proof and self-check succeeded; one payment was prepared and the
  `PAYMENT-SIGNATURE` was accepted (one `proof_valid` and one new reservation);
  no facilitator settlement confirmation followed; no response was committed;
  and no `PAYMENT-RESPONSE` was recorded. The gateway failed after dispatch
  began and cancelled its reservation.
- The post-run gate passed at `2026-09-28T10:45:00.388Z`. Relative to the
  zeroed baseline, gateway deltas were `challenge_issued +1`, `proof_valid +1`,
  `reservation_new +1`, `claim_cancelled +1`, and `dispatch_error +1`; all
  other gateway metrics remained zero. Claims ended at zero reserved, ready,
  and committed, with one cancelled. Thus the payment passed gateway
  verification and was reserved; the prior payment-verification failure was
  not reproduced. The request failed after dispatch began and before
  `stageReady` returned. The aggregate `dispatch_error` does not identify
  whether the subcause was provider transport/status handling, response
  buffering or validation, replay encryption, or claim-store staging. The
  successful cancellation counter makes a later commit failure inconsistent
  with this run. No facilitator settlement confirmation, committed response,
  or `PAYMENT-RESPONSE` was recorded.
- A read-only Base snapshot at block `47412006` showed the same sponsor native
  balance, zero sponsor USDC and allowance, and `20.000000` USDC at the bond.
  No Base transaction was observed. The listener is stopped, the registered
  adapter path was not attempted, and issue #26 remains open. The requested
  handoff condition was specifically a repeat of the old verification error;
  this run reached a later failure phase, so no handoff document was created.

## Earlier follow-up gate passed; listener lacked trial cap (2026-09-28 09:54–09:57Z)

- The user authorized one more Codex test after restarting the listener. Process
  inspection found PID `88226` running the worktree
  `packages/zk-credits-sidecar/dist/zk-credits.js` on port 3210, started at
  `2026-09-28 16:54:51 ICT`. Its arguments were `serve --port 3210
  --credential-password-stdin`; `--internal-trial-one-proof` was absent, so no
  request was sent through this process.
- A fresh machine-readable `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-28T09:57:33.309Z`. Gateway admin was authenticated; launch control,
  provider, V2 compatibility, and readiness passed. Base scanning was current
  at block `47410573` with nine blocks of lag. All gateway metrics and claim
  counts were zero.
- Authenticated local metrics showed zero proof attempts, local self-checks,
  proof failures, challenges, payment preparations, settlements, exchange
  successes, and exchange failures (`updatedAt` `09:54:51.698Z`). The durable
  ledger remains at capacity 250 with six committed slots.
- A read-only Base Sepolia snapshot at block `47410734` (chain `84532`) found
  sponsor native balance `0.099982616129848536 ETH`, sponsor USDC balance
  `0.000000`, sponsor-to-bond USDC allowance `0.000000`, and bond USDC balance
  `20.000000`. No transaction was sent. No additional Codex command, proof,
  payment, or adapter exchange ran. After a trial-mode listener is started,
  take a new gate and the full read-only baselines before the separately
  authorized follow-up Codex command. That listener was restarted later with
  the trial flag as recorded above. The registered-adapter path remains
  unattempted.

## One-proof trial guard and failed fresh gate (2026-09-28 09:48–09:50Z)

- Added opt-in `serve --internal-trial-one-proof` mode. It accepts one
  authenticated, valid loopback spend request, then returns HTTP 409 with
  `internal_trial_limit_reached` for a later valid spend request before another
  prepaid call. The shared proof factory also refuses a second proof attempt
  after a refreshed challenge and releases its provisional slot without
  committing it. Ordinary sidecar behavior remains unchanged when the flag is
  absent.
- Verification passed: all 23 sidecar test files (90 tests), standalone
  TypeScript `--noEmit` check, sidecar package build, and the existing offline
  gateway replay with pinned real proof artifacts and a mock provider. The
  focused replay passed gateway rejection classification, verification,
  settlement, and response checks. These local results do not count as a live
  exchange.
- Before shutdown, the stale listener was PID `54844`, running the worktree
  `packages/zk-credits-sidecar/dist/zk-credits.js serve` without the new trial
  flag; process inspection showed a start time of `2026-09-28 15:13:54 ICT`.
  The Codex profile was installed. Its authenticated aggregate metrics were 6
  proof attempts, 6 local self-check successes, 0 proof failures, 6 challenges,
  11 payment preparations, 0 settlement confirmations, 0 successful exchanges,
  and 11 exchange failures. It was stopped; port 3210 is no longer listening.
  The durable ledger remains at capacity 250 with six committed slots.
- The fresh machine-readable `scripts/launch-pilot.sh --trial-gate` at
  `2026-09-28T09:48:44.812Z` failed. Local preflight passed, while gateway
  readiness, V2 compatibility, authenticated admin status, and the Base scan
  were unavailable; provider and launch-control state were unknown, and
  gateway counters were unavailable. No fresh Base balance or allowance
  snapshot was taken. At that point, no replacement trial-mode sidecar or
  Codex command was started. The later restart and one-proof Codex outcome are
  recorded above; the registered-adapter path remains unattempted.
  No new proof, payment, settlement, gateway counter delta, or slot consumption
  occurred. Keep both path outcomes separate and issue #26 open.

## Worktree release preflight stopped on process provenance (2026-09-28 07:53Z)

- Before a live retry, listener inspection found port 3210 owned by PID 24135,
  running the globally installed `zk-credits serve` executable. Its global
  package is `0.2.4`; the process started at 14:19 local time, before the
  managed profile fix and rebuilt worktree CLI. It does not satisfy the
  required worktree process provenance, so no funded Codex command was run.
- The worktree package source and compiled output contain the managed profile
  effort value `none` and the validated `apply_patch` bridge handling. The
  worktree CLI has not replaced the running listener. A user-entered backup
  password is required to start that CLI; no password or credential material
  was read or recorded.
- No new trial gate, Base Sepolia snapshot, exchange, or adapter command was
  run in this checkpoint. Older passing gates remain historical and cannot
  authorize a later attempt. No x402 challenge, proof, signature, settlement,
  committed response, gateway claim, counter delta, or slot spend is claimed.
- Registry lookup returned 404 for `zk-credits@0.2.5`, confirming the patch
  version remains unpublished and available for the release candidate. The
  Codex retry remains unspent; the adapter path remains gated on its success.

## Authorized Codex trial rejected by gateway verification (2026-09-28 08:20–08:21Z)

- The operator completed setup and started the listener from the rebuilt
  worktree CLI. Process inspection confirmed that PID `54844` was running
  `packages/zk-credits-sidecar/dist/zk-credits.js serve`; the managed profile
  was mode `0600`, selected the loopback Responses provider, and set
  `model_reasoning_effort = "none"`. The source and compiled CLI both included
  the validated local `apply_patch` declaration handling.
- A fresh `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-28T08:20:42.151Z`. The gate reported the required local and gateway
  readiness, compatibility, provider, admin-status, launch-control, and
  current-root checks as passing. Before the command, local proof and exchange
  counters, gateway exchange and claim counters, and committed slots were zero.
  The read-only Base Sepolia snapshot confirmed chain `84532`, the pinned bond
  and USDC contracts, Tier 0 capacity 250 and bond `20,000,000` base units,
  one funded leaf, zero sponsor USDC and allowance, and `20,000,000` base units
  at the bond. No transaction was sent.
- The single authorized command was run through the worktree CLI in read-only
  sandbox mode. It exited `1` after Codex's initial request and five automatic
  reconnect retries, all receiving HTTP 402 from loopback `/v1/responses`.
  The expected `B22-CODEX-OK` response was not observed. No second Codex
  command was started.
- Immediate local reconciliation recorded 6 proof attempts, 6 local proof
  self-verifications, 0 proof failures, 11 payment-prepared events, 6
  received challenges, 11 `payment_rejected` events, 0 settlement
  confirmations, and 0 successful exchanges. The durable slot ledger had 6
  committed slots out of 250. The extra prepared payloads correspond to the
  CLI's automatic retries reusing cached payments before refreshing each
  challenge; there were 6 distinct locally generated proofs and 11
  `PAYMENT-SIGNATURE` submissions, not 11 Codex commands.
- The fresh post-run gate at `2026-09-28T08:21:36.540Z` still passed its
  readiness checks and reported 12 issued challenges, 11 invalid proofs, 0
  valid proofs, 0 reservations, 0 claims, and 0 dispatches. Together with the
  sidecar's 11 payment rejections, this locates the first failed boundary at
  gateway payment verification, before accepted-proof handling, reservation,
  or settlement. The gateway aggregate counters do not retain the verifier's
  failure reason, so this evidence cannot distinguish a structural payload or
  request-binding rejection from Groth16 verification failure. No
  `PAYMENT-RESPONSE`, committed response, claim, or settlement was observed.
- Stop condition met: no further funded Codex attempt and no registered-adapter
  command. Do not infer a live exchange from the passing gate, the local proof
  self-checks, or the offline bridge replay. Keep this result in this internal
  trial record; it is not external operator evidence, and issue #26 remains
  open.

## Offline diagnosis of the gateway rejection (2026-09-28 09:22Z)

- No retained gateway log or challenge metadata contained a per-request
  verifier category for the 08:20–08:21 live attempt. Its exact historical
  rejection reason therefore remains unknown.
- A deterministic HTTP replay with a synthetic credential, controlled clock
  and root, the pinned V2 proving artifacts, and the verification key whose
  SHA-256 matches both the manifest and readiness pin reproduced a structural
  rejection before the fix: `invalid_payload_fields`. SnarkJS's real proof
  object included `protocol` and `curve`, while the frozen payment wire schema
  permits only `pi_a`, `pi_b`, and `pi_c` in the proof object.
- Fixed the sidecar payment factory to emit only those three proof fields.
  The replay then classified a changed raw request body as
  `request_signal_mismatch`, a shortened public-signal vector as
  `invalid_public_signals`, and a tampered proof as `proof_invalid`. An
  unchanged real proof passed gateway verification and mock-provider
  settlement, returned HTTP 200 with `PAYMENT-RESPONSE`, and committed its
  synthetic claim. Each rejected variant produced no claim and no provider
  dispatch.
- These offline results establish the reproduced cause and the fix for the
  current sidecar path; they do not establish the exact category of the earlier
  live rejection or count as either authorized live exchange. No paid request
  or registered-adapter request was made. B22 and issue #26 remain open.

## Fresh gate and chain snapshot; new attempt deferred to handoff (2026-09-28 07:29–07:32Z)

- The operator authorized one new funded Codex attempt after a fresh gate and
  snapshots. The first gate at `07:29:13.844Z` failed because gateway
  readiness, compatibility, and authenticated status were unavailable; no
  exchange command ran. Read-only `/ready` and authenticated admin probes then
  returned 200, and a new `--trial-gate` passed at `07:30:10.880Z` with
  provider and V2 compatibility passing, launch control enabled, two known
  roots, block `47406148`, lag 13, and zero gateway counters and claims.
- A read-only Base Sepolia snapshot at `07:31:23.665Z` confirmed chain ID
  84532, code at the pinned V2 bond and USDC, matching bond token and sponsor,
  Tier 0 allowance 250 and bond `20,000,000` base units, one funded leaf, a
  known current root, zero sponsor USDC and bond allowance, and `20,000,000`
  base units at the bond. No chain transaction was sent.
- The local sidecar returned health and authenticated metrics 200. Proof and
  exchange counters remained zero; the durable slot ledger was absent, hence
  zero committed slots. The managed Codex profile remained mode 0600 and
  pinned the loopback provider and `model_reasoning_effort = "none"`.
- Before the guarded funded command was run, the operator requested a handoff
  focused on completing diagnosis, package versioning, and the remaining
  unknowns. **No new funded Codex attempt or registered-adapter exchange ran.**
  The passing gate and snapshots are historical observations; obtain new ones
  immediately before any later live attempt.

## Codex reasoning override diagnosed and repaired offline (2026-09-28 07:26Z)

- The operator recovered the original Codex CLI diagnostic from terminal
  scrollback. It showed Codex 0.157.1 selecting model `openai/gpt-4o-mini`,
  provider `zk_credits`, and reasoning effort `medium`, followed by
  `unsupported_reasoning_controls`. The provider was selected correctly.
- A metadata-only local configuration check found `model_reasoning_effort =
  "medium"` in the user Codex config and no reasoning-effort setting in the
  installed managed profile. No project Codex config was present in the repo or
  sidecar package. The managed profile was inheriting the user default.
- A temporary Codex home, synthetic token, and loopback-only fake Responses
  endpoint reproduced the exact failure through the globally installed
  `zk-credits codex exec --ephemeral` wrapper: profile effort `medium`, or a
  user default of `medium` with profile effort unset, reached `/v1/responses`
  and received 400 `unsupported_reasoning_controls`. Profile effort `none`
  returned 200 and a synthetic response with the same wrapper and user
  default. The fake recorded only endpoint/status and request field names; it
  did not retain request bodies, prompts, tokens, or payment data. No sidecar,
  gateway, chain, or upstream provider request was made.
- The new focused profile-output regression failed before the change and
  passed afterward. The managed profile generator now writes
  `model_reasoning_effort = "none"`. The installed `~/.codex/zk-credits.config.toml`
  was updated atomically after an exact generated-template match and verified;
  the ordinary user Codex default remains `medium`. A post-change offline
  replay passed for both raw Codex and the `zk-credits` wrapper. It also
  confirmed that effort `none` still sends a `reasoning` object, which the
  current bridge accepts. The globally installed `zk-credits@0.2.4` still has
  the old profile generator; running its setup command again before an updated
  package is installed would replace this local profile override.
- This repairs the identified local stop but does not count as a funded Codex
  exchange. No paid retry or registered-adapter exchange was made. Before any
  later live exchange, obtain a new gate and chain snapshot, then reconcile
  proof, payment, gateway claim, and slot deltas independently for both paths.
- Posted the sanitized [diagnosis update to the internal trial issue](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5865397680).

## Codex attempt stopped before x402; reconciled (2026-09-28 06:59–07:00Z)

- The operator started the patched worktree sidecar on `127.0.0.1:3210` through
  its hidden credential-password prompt. Process inspection confirms the
  listener is running the worktree build. The isolated Codex profile is
  installed with `model_provider = "zk_credits"`, model alias
  `openai/gpt-4o-mini`, `wire_api = "responses"`, and base URL
  `http://127.0.0.1:3210/v1`. Its authenticated `/v1/models` response is 200
  and advertises that alias with the expected local tool declarations. No
  OpenRouter or subscription API key was added to this Codex profile; upstream
  access remains the gateway provider's responsibility.
- A final `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-28T06:59:26.592Z`. Gateway counters and claims were all zero. The
  immediate Base Sepolia read at `06:59:27.858Z` confirmed chain ID `84532`,
  code at the pinned USDC and V2 bond, matching bond sponsor/token bindings,
  zero sponsor USDC and sponsor-to-bond allowance, `20,000,000` USDC base
  units held by the bond, Tier 0 allowance 250 and bond `20,000,000`, and one
  funded leaf. No transaction was sent.
- The same preflight snapshot reported zero local proof and x402 lifecycle
  counters and a durable ledger of 0 committed and 0 provisional slots out of
  250. The one intended `zk-credits codex exec --ephemeral` command then
  launched but exited `1`; stdout was empty and the expected response was not
  observed. Its captured diagnostic was not retained. Do not infer a more
  specific local error from this result.
- Immediate reconciliation at `2026-09-28T07:00:18.680Z` found zero local
  proof attempts, challenges, prepared payments, settlements, successes, or
  failures, and the durable ledger remained 0 of 250. The fresh gateway gate
  at `07:00:19.184Z` still passed with every exchange counter and claim count
  at zero. Therefore no x402 challenge reached the sidecar client and no
  proof, `PAYMENT-SIGNATURE`, facilitator settlement, committed response,
  `PAYMENT-RESPONSE`, gateway claim, or slot spend was observed. The Codex
  failure stopped before the first x402 phase; its exact local cause remains
  unknown because the CLI diagnostic was not retained.
- A separate read-only call to the profile's `zk-credits token` auth command
  returned a token successfully without any exchange activity. The Codex
  attempt was not retried. Since the Codex path did not pass, the separately
  registered `zk-prepaid` adapter exchange was not started. Issue #26 remains
  open; Vercel token status and launcher database credential rotation remain
  deferred.
- After that stop, a separate nonbillable diagnostic ran Codex CLI against a
  loopback-only mock using a temporary `CODEX_HOME` and the compiled worktree
  Responses translator. Codex exited `0`, made one mock `/v1/responses` request,
  the translator reported no error, and the expected response was observed.
  The request included the 17,119-byte instructions block and nine tools. This
  confirms the current bridge accepts that synthetic request shape; it does
  not reproduce the stopped live command or identify its cause. The temporary
  profile was removed, and this check did not call the sidecar, gateway, Base,
  or an upstream model. Its nonempty CLI stderr did not indicate failure.
- Posted sanitized progress notes to [issue #26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5865081788) and [the follow-up mock diagnostic](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5865161533).

## Reproduced local bridge failure and refreshed preflight (2026-09-28 06:36–06:48Z)

- Reproduced the previous Codex stop against a loopback fake gateway using the
  globally installed `zk-credits@0.2.4` bridge. The Codex CLI exited `1` after
  its model probes and one synthetic Responses request; the local adapter
  rejected an advertised `custom` tool as `unsupported_tool`. The fake upstream
  received no request. The retained diagnostic contains only the fixed error
  category; it excludes request bodies, credentials, proofs, and payment data.
- The current worktree's focused public HTTP regression passes, and the
  compiled worktree bridge completes the same synthetic Codex CLI request
  through one fake upstream call. No x402 request was used for either check.
  No additional behavior test was added; the focused bridge regression already
  covers this boundary.
- A fresh `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-28T06:45:19.675Z`: local preflight, gateway readiness, V2
  compatibility, provider, authenticated admin status, enabled launch control,
  and current Base scan all passed. The scan reported two known roots at block
  `47404803` with 13 blocks of lag. Gateway exchange counters and claim counts
  were zero.
- Read-only Base Sepolia calls at `2026-09-28T06:47:42.165Z` confirmed chain
  `84532`, code at the pinned V2 bond, and the expected Circle Base Sepolia
  USDC token. Sponsor balance and sponsor-to-bond allowance were both zero;
  the bond held `20,000,000` USDC base units. Tier 0 allows 250 credits with a
  `20,000,000`-unit bond, and the contract had one funded leaf. No transaction
  or funding action was sent.
- At `2026-09-28T06:47:42Z`, the authenticated loopback metrics endpoint
  reported zero proof attempts, challenges, prepared payments, settlements,
  successes, and failures. The durable ledger snapshot was 0 committed and 0
  provisional of 250 slots. These values reconcile with the gate's zero
  gateway counters.
- The operator reports the sidecar is listening on `127.0.0.1:3210`. Process
  inspection shows it was launched from the globally installed executable,
  whose bridge predates the worktree fix. It was not used for a paid request.
  A patched worktree build must be started through its hidden credential
  password prompt before the intended Codex exchange. The encrypted export,
  password, RPC URL, and loopback bearer were not printed into this record.
- No Codex x402 exchange or registered-adapter exchange has run in this
  continuation. No provider API key needs to be added to the Codex profile for
  the `zk-credits` route: Codex speaks to the loopback Responses bridge, and
  the gateway's existing provider configuration handles upstream model access.
  The local subscription profile remains the default outside that isolated
  profile. Issue #26 remains open; Vercel token status and launcher database
  credential rotation remain deferred until after both exchanges.

## Latest Codex stop and reconciliation (2026-09-28 04:53–04:58Z)

- Two gate samples were transiently unavailable at `04:28:36Z` and
  `04:52:11Z`. Read-only probes at `04:53:04Z` found `/ready` and authenticated
  admin status returning 200 with all readiness checks passing; `/health`
  timed out on that sample. The fresh machine-readable gate then passed at
  `04:53:17Z`, including V2 compatibility, provider, authenticated admin,
  enabled launch control, and a current Base scan. No hosted service or
  configuration was changed during diagnosis.
- Immediately after the passing gate, Base Sepolia reads confirmed chain ID
  `84532`, zero sponsor USDC balance, zero sponsor-to-V2 allowance, and
  20,000,000 USDC base units held by the V2 bond. The bond's sponsor and USDC
  matched the configured addresses; Tier 0 has allowance 250 and a
  20,000,000-unit bond, one funded leaf exists, and the current root is known.
  The existing funded credential had capacity for this one request, so no
  funding action was needed or sent. The sponsor has no headroom to fund a
  replacement credential.
- The local sidecar was healthy before the attempt. Its aggregate baseline was
  zero proof attempts, challenges, prepared payments, settlements, successes,
  and failures; the durable ledger was absent, equivalent to 0 committed of
  250 slots. The gateway aggregate counters and claim counts were also zero.
- The predefined Codex command, `zk-credits codex exec --ephemeral` with the
  internal-trial text prompt, exited `1`; the expected response was not
  observed. The exact local CLI diagnostic was not retained. Reconciliation at
  `04:55:29Z` still showed zero local proof attempts, zero challenges,
  payments, or settlements; every gateway metric and claim count remained
  zero, and the durable ledger remained at 0 of 250. No x402 phase or spend
  was observed.
- The credential token command and installed Codex profile passed local
  read-only checks. The verified sidecar was stopped, and `zk-credits status`
  at `04:58Z` reports it stopped; the slot ledger remains absent with zero
  committed slots. No retry or registered-adapter request was started after
  the Codex command failure. Keep issue #26 open; obtain a new passing gate and
  chain snapshot before any later exchange. A sanitized issue comment could
  not be posted because `gh auth status` reports the configured GitHub token
  is invalid and no GitHub connector is available. Vercel token status and
  launcher database credential rotation remain deferred.

## Post-correction sidecar status (2026-09-28 04:27Z)

- A read-only `zk-credits status` check after the credential-path correction
  reports the export configured and the Codex profile installed, but
  `Sidecar: stopped`. The operator still needs to start it through the local
  hidden prompt. No request or exchange has started.

## Credential export selected and configuration corrected (2026-09-28 04:24Z)

- A metadata-only check found that the configured file was a V2 recovery
  capsule. The `zk-credits@0.2.4` sidecar requires an activated V2 export or
  legacy V1 export, explaining the earlier `Unsupported credential export`
  error without implicating the password.
- Two activated V2 exports were found locally. Their public activation metadata
  was compared in memory with finalized Base Sepolia `BundleFunded` events and
  the pinned deployment. Exactly one matched the funded leaf, tier, expiry,
  transaction, and deployment metadata. No commitment, transaction hash,
  filename, or path was written to this record.
- Only the `ZK_CREDITS_CREDENTIAL_PATH` assignment in the owner-only local
  `sidecar.env` was changed to select that matching activated export. The
  recovery capsule and encrypted payloads were not modified or decrypted; the
  password was not retained. The operator must restart the sidecar through
  the existing hidden prompt. No exchange has started.

## Credential startup stop (2026-09-28 04:16Z)

- The operator sourced the local sidecar environment and ran `zk-credits
  serve`. After the hidden credential-backup prompt, the CLI printed
  `Unsupported credential export` and exited. The sidecar is not listening.
- The installed CLI is `zk-credits@0.2.4`. Its reader accepts activated V2
  credential exports and legacy V1 encrypted credential exports; a recovery
  capsule or other unsupported wrapper is rejected before a spend request.
  At the time of this stop, the configured file's wrapper metadata had not yet
  been checked. This message did not indicate a password failure; invalid
  password/ciphertext has a separate parser error. The later section records
  the shape diagnosis and correction.
- This stopped before any Codex or adapter request. No proof, payment header,
  settlement, committed response, counter delta, or slot change occurred. Do
  not count this as an exchange attempt; the later section records the
  metadata check and configuration correction.

## Passing entry gate and chain state; exchanges still pending (2026-09-28 04:08Z)

- The fresh read-only `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-28T04:08:22.175Z`. Local preflight, gateway readiness, V2
  compatibility, provider, authenticated admin status, enabled launch control,
  and current Base scan passed. The scan reported two known roots at block
  `47400089` with 18 blocks of lag. All aggregate gateway metrics and claim
  counts were zero.
- Immediately afterward, read-only Base Sepolia calls confirmed chain ID
  `84532`, zero sponsor USDC balance, zero V2 bond allowance, 20,000,000 USDC
  base units held by the bond, a Tier 0 bond of 20,000,000 base units, a Tier 0
  allowance of 250, one funded leaf, and a known current root. The deployed
  bond token matches configured USDC. No funding or other transaction was
  sent. The credential-specific bundle mapping had not yet been inspected at
  this gate snapshot; the later metadata check uniquely matched an activated
  export to the funded leaf.
- The local credential export is configured, the Codex profile is installed,
  and the sidecar is stopped. The durable slot ledger remains absent with zero
  committed and provisional slots. Codex `exec --ephemeral` is supported by
  the installed CLI; the predefined request is `Reply with exactly: internal
  trial complete.` It has not been sent. Starting the sidecar requires the
  encrypted credential's local no-echo prompt; no password was read or
  recorded.
- Neither internal exchange has started. No 402 challenge, proof/self-check,
  `PAYMENT-SIGNATURE`, facilitator settlement, committed response,
  `PAYMENT-RESPONSE`, counter delta, or slot delta exists for either path. The
  registered adapter path still requires its own fresh gate, chain read, and
  interactive confirmation after Codex reconciliation.
- Issue #26 remains open. A sanitized issue comment could not be posted:
  `gh auth status` reports the local GitHub token is invalid, and the
  documented browser wrapper could not start because `npx` did not resolve the
  CLI in this network-restricted environment. No ticket content was changed.
  Vercel token-rotation status and launcher database credential rotation have
  not been checked or changed; those checks remain after both exchanges.

This checkpoint is an internal operational status only. It does not count as
external operator activation or market-validation evidence.

## Codex bridge fix and failed entry gate (2026-09-28 02:46Z)

- A content-free local Codex CLI 0.157.1 request (`Reply with exactly OK.`)
  reproduced `unsupported_tool` at the loopback `/v1/responses` boundary before
  the fake gateway was called. Inspection of the tool declarations identified
  the sole rejected declaration as Codex's local `apply_patch` custom tool:
  `type=custom`, `format.type=grammar`, `format.syntax=lark`. The declaration
  contains a local grammar that the hosted chat route cannot execute.
- The bridge now validates only this known `apply_patch` declaration shape and
  omits it from the translated provider request. Unknown custom tools and
  unsupported grammar shapes remain rejected. The red HTTP regression returned
  400 before the change; after the change the HTTP test passed, and the same
  local Codex check reached the fake gateway once and returned the synthetic
  `OK` response. Ordinary function tools remained in the translated request.
  This was a local fake-gateway diagnostic only: it did not invoke x402,
  generate a proof, contact a hosted provider, or spend credits.
- Verification passed: sidecar suite, 23 files and 87 tests; TypeScript build.
  The existing bounded service class and x402 behavior were not changed by this
  bridge compatibility fix.
- Local state immediately before the gate: the encrypted credential export
  path was configured and readable to the CLI after using the existing secure
  local configuration flow; the installed Codex profile was present; the
  sidecar was stopped. The durable slot ledger was absent, with zero committed
  slots.
- The fresh `scripts/launch-pilot.sh --trial-gate` at
  `2026-09-28T02:46:24.434Z` failed. Local preflight passed, while gateway
  readiness, V2 compatibility, admin authentication/status, and BaseScan
  readiness were unavailable; provider and launch control were unknown. Per
  the gate, no sponsor balance, V2 allowance, or bond read was made, and no
  exchange was started.

| Path | Result at this checkpoint |
| --- | --- |
| Codex sidecar exchange | Not attempted; stopped before the 402 challenge. The local fake-gateway diagnostic above is not an exchange. No proof/self-check, `PAYMENT-SIGNATURE`, facilitator settlement, committed response, `PAYMENT-RESPONSE`, or exchange counter delta exists. |
| Registered `zk-credits trial-registered-adapter` exchange | Not attempted; its own fresh gate and read-only chain checks were not run because the Codex entry gate failed. No protocol phase or counter delta exists. |

No live exchange counters were available because authenticated admin status was
unavailable. The local sidecar remained stopped and its slot ledger remained
absent. Issue [#26](https://github.com/mangekyou-labs/haze-api/issues/26)
remains open. Vercel token-rotation status and launcher database credential
rotation remain outstanding until the post-exchange checkpoint; no exposed
token or credential value was read or recorded here. Internal results remain
separate from external operator evidence.

## Codex bridge and current entry-gate checkpoint (2026-09-27 18:46Z)

- The installed Codex profile is configured with model label
  `openai/gpt-4o-mini` and provider `zk_credits` at the local loopback sidecar.
  It obtains loopback authentication from `zk-credits token`; the profile does
  not contain the user's OpenAI subscription credentials or an OpenRouter key.
  The gateway's bounded service class replaces the client model field with
  `deepseek/deepseek-v4-flash` and its provider adapter uses OpenRouter. No
  provider dispatch occurred in this checkpoint.
- The corrected predefined Codex request returned `unsupported_tool` twice
  from the local Responses bridge and exited unsuccessfully. It was rejected
  before the gateway's x402 route, so no 402 challenge, local proof or
  self-check, `PAYMENT-SIGNATURE`, facilitator settlement, committed response,
  or `PAYMENT-RESPONSE` occurred. The reconciled sidecar counters remained at
  zero attempts, proofs, challenges, prepared payments, settlements,
  successes, and failures. The sidecar was stopped and the durable slot ledger
  is absent, with zero slots consumed.
- The current secure local unlock attempt was canceled without capturing a
  password; the sidecar remains stopped. A fresh machine-readable gate at
  `2026-09-27T18:46:23.274Z` failed: local preflight passed, but gateway
  readiness and V2 compatibility were unavailable, and provider status was
  unknown. A direct liveness request also timed out. No sponsor allowance read
  or exchange retry was made after this failed gate.
- OpenRouter documents the gateway's pinned alias
  `deepseek/deepseek-v4-flash` as the April 23 revision and lists the newer
  [July 31 revision](https://openrouter.ai/deepseek/deepseek-v4-flash-0731).
  That model change is not applied as part of this checkpoint; the existing
  service-class and deployed gateway remain the trial target. The Codex bridge
  rejection happened before any model request and does not show whether either
  model would answer the prompt.
- This is an internal technical attempt, not external operator evidence. The
  Codex exchange is incomplete, the registered-adapter exchange is unattempted,
  and issue 26 remains open.

## Published setup fix and Codex invocation stop (2026-09-27 18:21Z)

- The canonical npm registry now reports `zk-credits@0.2.4` as `latest`. A
  global install of that exact version succeeded, and the installed CLI help
  reports the public root-check setup flow. The package candidate had already
  passed the sidecar and gateway test suites, type checks, build, and a clean
  packed install before publication.
- A fresh machine-readable trial gate passed at
  `2026-09-27T18:21:01.939Z`: local preflight, gateway readiness, V2
  compatibility, provider, authenticated admin status, launch control, and
  current Base scan passed. The scan reported two known roots at block
  `47382483` with three blocks of lag. Aggregate metrics and claim counts were
  zero.
- A read-only Base Sepolia allowance check at `2026-09-27T18:21:03.373Z`
  found zero sponsor USDC, zero sponsor-to-V2-bond allowance, and 20.000000
  USDC in the V2 bond. No funding transaction was sent.
- The first retry wrapper call placed Codex `exec` options before the `exec`
  subcommand. The Codex CLI rejected `--ephemeral` before making a request.
  No 402 challenge, proof, self-check, `PAYMENT-SIGNATURE`, facilitator
  settlement, committed response, or `PAYMENT-RESPONSE` occurred. The
  authenticated local sidecar snapshot remained at zero proof attempts,
  zero challenges, zero prepared payments, zero settlements, zero successes,
  and zero failures. The sidecar was stopped afterward; the durable slot
  ledger is absent and records zero consumed slots.
- Restarting the sidecar requires the password for the local encrypted V2
  credential export. A hidden local prompt remained unanswered and was closed;
  no password was captured. The sidecar is stopped, so neither exchange was
  attempted and issue 26 remains open. For a later retry, enter the password
  only at the local no-echo prompt, then obtain a new passing trial gate and
  allowance read immediately before the Codex request.
- A post-stop check confirmed the corrected Codex option order with `--help`
  only. The saved encrypted-export path is readable, but its assignment in
  `sidecar.env` is not exported by a plain `source`; a local terminal should
  source it with `set -a` before starting the sidecar. No request was sent by
  this syntax or environment check.
- Vercel token rotation remains unverified: the authenticated account token
  metadata did not identify which token is the launcher token, and the exposed
  token itself was neither read nor reused. Rotate the launcher database
  credential only after both internal exchanges complete.

## Codex bridge implementation checkpoint (2026-09-27)

- Added a loopback-only `/v1/responses` bridge for the supported Codex text and
  function-call request subset. It translates to the existing bounded
  `/v1/chat/completions` x402 route and returns Responses SSE events after the
  committed chat response. Unsupported request fields, media, and controls
  are rejected before the prepaid client is called. The gateway route and x402
  wire format are unchanged.
- Raised the fixed service-class input ceiling to 128,000 UTF-8 byte units and
  the worst-case dispatch debit to 130,000 micro-USD. The 4,000 output-token
  limit and existing $40 daily / $200 rolling-30-day spend caps remain intact.
  At both input/output ceilings, listed usage is $0.1224 and usage including
  the 5.5% OpenRouter fee is $0.129132 per dispatch.
- A disposable installed Codex CLI run against a local fake gateway captured
  one Responses request in memory. The bridge translated it, and the gateway
  service-class normalizer accepted it at 36,762 input units, below the
  128,000 limit. The HTTP request body was 49,206 bytes. The check recorded
  only these aggregate values; it did not save or print request content. The
  fake gateway returned a local 422 before any prepaid client, proof, or
  payment path was involved, so this was not an exchange.
- Verification: sidecar suite — 19 files passed, 1 skipped; 68 tests passed,
  3 skipped. Service-class tests — 35 passed. Sidecar TypeScript build and
  `git diff --check` passed.
- The built local CLI status reports `Credential export: missing`,
  `Codex profile: installed`, and `Sidecar: stopped`. No current allowance
  read or fresh `--trial-gate` was run because no exchange is being launched.
  The historical 07:08Z gate and allowance checkpoint below must not be used
  for a later exchange.
- Neither internal exchange has been attempted. No protocol phase or counter
  delta is recorded for either path, and no slot was consumed. Before each
  exchange, re-read sponsor allowance and obtain a fresh passing
  `--trial-gate`; run the Codex exchange first, stop the sidecar, then run the
  separately registered adapter path with the same durable slot ledger.

## Historic launcher and compatibility checkpoint (2026-09-27 07:08Z)

- The local launcher preflight passes. `scripts/launch-pilot.sh --check`
  reports 32 satisfied values and `preflight: ready`. The checkpointed launch
  plan currently contains 29 steps.
- Builder Code attribution was configured through the targeted launcher mode.
  The resulting Render deploy reached `live` before the following readiness
  check. No unrelated launch step was resumed.
- A fresh read-only `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-27T07:08:19.333Z`. The report showed passing local preflight and
  gateway readiness, an authenticated admin status, enabled launch control,
  a current Base Sepolia scan with one known root, block lag 6, and zero
  aggregate counters and claim counts. The machine-readable output contains
  only the gate's allowlisted fields; no root value or credential was recorded.
  The exact report was:

  ```json
  {
    "schemaVersion": "base-sepolia-internal-trial-gate/v1",
    "checkedAt": "2026-09-27T07:08:19.333Z",
    "result": "pass",
    "localPreflight": "pass",
    "gatewayReadiness": "pass",
    "provider": "pass",
    "adminAuthentication": "authenticated",
    "adminStatus": "pass",
    "launchControl": "enabled",
    "baseScan": {
      "status": "current",
      "hasCurrentRoot": true,
      "knownRootCount": 1,
      "lastScannedBlock": "47362299",
      "lagBlocks": "6"
    },
    "counters": {
      "metrics": {
        "challenge_issued": 0,
        "proof_valid": 0,
        "proof_invalid": 0,
        "reservation_new": 0,
        "reservation_existing": 0,
        "claim_committed": 0,
        "claim_cancelled": 0,
        "claim_replayed": 0,
        "claim_conflict": 0,
        "dispatch_ok": 0,
        "dispatch_error": 0,
        "dispatch_timeout": 0,
        "cap_exhausted_utc_day": 0,
        "cap_exhausted_rolling_30d": 0,
        "paused_rejected": 0,
        "request_rejected": 0
      },
      "claims": {
        "reserved": 0,
        "ready": 0,
        "committed": 0,
        "cancelled": 0
      }
    }
  }
  ```
- The allowance checkpoint was reconciled against Base Sepolia before any
  sponsor funding: the sponsor had 20.000000 test USDC and zero allowance.
  Exactly 20.000000 was approved to the bond, and the confirmed receipt was
  followed by an observed 20.000000 allowance. This used the initial 20 test
  USDC approval within the 80 USDC pilot bound. No bundle was funded and no
  credential activation or exchange followed from the approval.
- The pinned local CLI still reports `Credential export: missing`,
  `Codex profile: installed`, and `Sidecar: stopped`. No credential export,
  password, proof, or request content was read or received by this process.
- A disposable local protocol check with Codex CLI 0.157.1 confirmed that the
  installed profile's `wire_api = "responses"` sends `POST /v1/responses` with
  `stream: true`. The sidecar currently rejects that path with 404 before it
  invokes the prepaid client; its existing test pins this behavior. The same
  local request carried an instructions block of 17,119 UTF-8 bytes and
  13,245 characters of input text, already beyond the gateway service class's
  16,000-byte input ceiling before function-tool schemas are included. The
  trial did not weaken that limit, remove Codex policy context, or send a
  request through the paid sidecar. This is a reproducible compatibility
  blocker for the Codex path, not an exchange or spend result.
- No exchange was attempted. There is no 402 challenge, proof/self-check,
  `PAYMENT-SIGNATURE`, settlement, committed response, `PAYMENT-RESPONSE`,
  failure phase, counter delta, or consumed slot for either path. Keep issue
  26 open and stop before both exchanges until the local credential is
  activated and the Codex path is made compatible with the bounded service
  class.

## Recovery and local preparation

- The operator opened `https://hazecredits.vercel.app/recover`, selected the
  version-2 recovery capsule, entered the stated correct password, and saw
  `Unsupported credential export`. The operator clarified that pressing
  “Restore credential” made no HTTP request; the error occurred in the page
  before any recovery lookup, so the password was not checked.
- Inspection of the public page bundle on that hostname found the older import
  flow, which accepts activated version-2 credentials and legacy version-1
  exports but does not handle `kind: "recovery-capsule"` or call
  `/api/pilot/recovery`. Its local validator rejects the capsule before a
  request. This matches the reported error and identifies a stale-page/schema
  mismatch, rather than evidence of a bad password or failed funded-bundle
  lookup. No capsule contents or password were collected.
- The recorded capsule-aware Vercel preview is
  `https://zk-credits-quoubld5z-gadillacers-projects.vercel.app` (deployment
  `dpl_DVq1mdaYZY8uu1WtzA4AtEMxC2Wx`). A fresh read-only Vercel inspection on
  2026-09-23 reports it `READY` and lists the built `api/pilot/recovery`
  route. An unauthenticated page fetch from this environment returned the
  Vercel login page, so the preview’s rendered page still needs to be checked
  in a browser session with project access. The preview remains unpromoted.
- On the operator’s retry at the capsule-aware preview, Restore did make an
  HTTP request and displayed `{"error":"gateway_unreachable"}`. This response
  is generated when the server-side gateway fetch throws; it does not identify
  the underlying network error and does not indicate a password or bundle
  mismatch. A read-only Vercel environment metadata check found `GATEWAY_URL`
  and `BILLING_INTERNAL_TOKEN` configured only for Production. The recovery
  lookup route defaults a missing `GATEWAY_URL` to `http://localhost:3001`,
  and the gateway’s bundle lookup is public, so it needs no billing token.
- A fresh public gateway `GET /ready` initially timed out after 30 seconds
  (HTTP `000`), then a retry returned HTTP 200 with `ready: true`. The timing
  suggests a transient wake-up delay as well, but the preview’s missing
  `GATEWAY_URL` was the configuration gap. A new, still-unpromoted preview was
  created with only the public gateway URL as a deployment-scoped runtime
  variable: `https://zk-credits-nu6god3ul-gadillacers-projects.vercel.app`
  (`dpl_hrNJ9DaNEq9htKVn5BCjsLEa94DS`). Vercel inspection reports it `READY`
  and lists both `recover` and `api/pilot/recovery`. No project-wide or
  Production environment variable was changed, and no billing token was
  added to Preview.
- The operator retried on that new preview. Restore displayed `No funded
  credential bundle was found for this recovery capsule.` The operator reports
  the request returned HTTP 404 with `{"error":"bundle_not_found"}`. In the
  local flow, this lookup occurs only after the browser decrypts the capsule
  and derives its commitment; the API forwards the gateway's 404. The gateway
  returns `bundle_not_found` when it has no matching record in the funded state
  with complete bundle metadata. This confirms the capsule decrypted and the
  request reached the configured gateway, but that gateway has no recoverable
  funded bundle for the derived commitment. It does not distinguish a capsule
  that differs from the one used for funding from a missing/non-funded record
  in this gateway's store. The recovery path never invokes funding. No capsule,
  password, commitment, or credential contents were collected; no credential
  was downloaded.
- The configured hosted gateway is
  `https://zk-credits-gateway.onrender.com`. The first sandboxed `GET /ready`
  timed out after 15 seconds (HTTP `000`). A read-only retry with network
  access at `2026-09-23T09:29:41Z` returned HTTP 200 and `ready: true`; launch
  control, database, Base root synchronization, Base RPC lag, verifier assets,
  and provider checks all passed.
- Authenticated `/v1/admin/status` returned HTTP 200 at
  `2026-09-23T09:30:41Z`: launch control was `enabled`, network was Base
  Sepolia, one root was known, the scan position was present, and root lag was
  15 blocks. Spend remained zero against the fixed `40000000` /
  `200000000` micro-USD caps. All challenge, proof, reservation, claim,
  dispatch, pause-rejection, and request-rejection counters were zero. This
  records the gate state at that time; it is not a fresh pre-exchange snapshot.
  The subsequent browser recovery lookup returned `bundle_not_found`.
- The pinned worktree CLI reports `Credential export: missing`,
  `Codex profile: installed`, and `Sidecar: stopped`. No recovered credential
  is configured for the pinned client yet. A separate global CLI status
  returned an unknown error and was not used as Base trial state.
- The worktree contains `zk-credits` 0.2.0 and its pinned
  `@zk-credits/x402-zk-prepaid` / `@zk-credits/shared` 0.1.0 dependencies.
  SHA-256 checks of all three installed proving artifacts match
  `packages/zk-credits-sidecar/circuits/manifest.json`.
  Rechecked during this continuation: the WASM, zkey, and verification key
  each matched their manifest digest.
- A fresh pinned CLI status check during this continuation still reports
  `Credential export: missing`, `Codex profile: installed`, and
  `Sidecar: stopped`. No credential file or password is available to this
  process, so no exchange has been attempted.
- The operator supplied only the capsule envelope metadata: top-level format
  `zk-credits-credential`, version `2`, kind `recovery-capsule`, nested version
  `2`, and algorithm `PBKDF2-AES-GCM`. Those values match the current schema.
  The operator also confirmed the encrypted fields were present as strings.
  The first Restore attempt on the stale public page made no request. The first
  capsule-aware preview attempt reached the API but failed with
  `gateway_unreachable`; the latest attempt on the configured preview reached
  the gateway and returned `bundle_not_found` as described above.
- The existing worktree browser suite,
  `npm run test:e2e -- pilot-recovery.spec.ts`, passed all 6 tests, including
  capsule activation, wrong-password rejection, and malformed-capsule
  rejection with generated fixtures and a mocked lookup. This verifies the
  local code path, but does not reproduce the operator’s file or verify the
  protected preview in the hosted browser.

## Exchange evidence

| Path | 402 challenge | Proof and self-check | `PAYMENT-SIGNATURE` | Settlement | Successful response | `PAYMENT-RESPONSE` |
|---|---|---|---|---|---|---|
| Codex sidecar | Not attempted | Not attempted | Not attempted | Not attempted | Not attempted | Not attempted |
| Controlled client registering `zk-prepaid` | Not attempted | Not attempted | Not attempted | Not attempted | Not attempted | Not attempted |

The fresh authenticated status snapshot above is the baseline before recovery,
not an immediate pre-exchange snapshot. Neither exchange ran, and no slot was
consumed. Recovery stopped at the funded-bundle lookup; no challenge, proof,
payment header, settlement, response, or counter delta is inferred.

## Resume gate

Resume only after the intended funded credential can be recovered in the
browser, and a fresh `/ready` plus authenticated `/v1/admin/status` both
succeed, readiness passes, launch control is enabled, the Base root check is
current, and the credential has enough credits. Keep the downloaded file
local. Use one durable slot ledger for both paths, stop the sidecar before
running the direct client, and collect fresh status/counter snapshots
immediately before each exchange.

If either path fails, record its failing phase and redacted status here. Keep
the internal trial separate from external operator evidence. Leave the preview
unpromoted and the issue open until its remaining criteria are met.

## Recovery fallback implementation checkpoint (2026-09-23)

The local Base feature worktree now has a read-only Base Sepolia recovery
fallback for the gateway's exact `404 bundle_not_found` result. Before it
returns activation metadata, it checks chain ID, deployment domain, active
tier-0 state, positive bond, future expiry, one matching `BundleFunded` event,
configured confirmation depth, and the event root against
`rootAt(leafIndex + 1)`. The browser also refuses expired metadata before it
saves or downloads the locally verified credential. The path has no funding
call.

Fresh local checks passed: the full web unit suite passed 66/66, the capsule
recovery browser suite passed 7/7, web typecheck passed, and focused ESLint
and the full lint passed with 0 errors and 8 existing warnings. The production
build passed and includes the dynamic recovery route. The focused API and
chain-reader suites passed 19/19. These checks use generated fixtures and a
mocked browser lookup; they do not verify the operator's capsule or any live
RPC result.

At this earlier checkpoint, the source change was not deployed. The ignored
local launch configuration matched the checkpointed Base Sepolia bond,
deployment block, and domain. An earlier automatic approval review rejected
sending the configured RPC URL and deployment settings because the URL may
contain credentials and the destination was unverified; no values were
uploaded then. The following user-authorized deployment checkpoint records
the later scoped deployment. The operator's capsule, password, commitment,
and credential remain private. No credential was downloaded, no exchange or
slot was consumed, the preview remains unpromoted, and the issue remains open.

## Follow-up deployment checkpoint (2026-09-23)

- Fresh local verification in the Base worktree passed the focused recovery API
  and Base reader suites (19/19), the recovery browser suite (7/7), web
  typecheck, and production build. The first sandboxed browser-suite run could
  not start Turbopack's local process; rerunning with local process permission
  passed all seven cases.
- The linked Vercel project was verified as `zk-credits-web`. Its Preview
  environment had no project or branch variables. Branch-scoped variable
  creation failed because this Vercel project has no connected Git repository;
  that attempt added nothing. The six required server-side runtime settings
  were instead attached only to the new deployment, without printing their
  values. Billing and sponsor credentials were excluded.
- The new deployment
  `https://zk-credits-8xa8g3too-gadillacers-projects.vercel.app`
  (`dpl_3SVvVaVa1XTofs8FR7itGcJ96J9U`) is `READY` with target `preview`. It
  remains unpromoted.
- A real-browser request to the recovery API using a synthetic unfunded
  commitment returned HTTP 200 HTML and redirected away from the API path due
  to Vercel Preview protection. The request did not produce an API response,
  so the deployed recovery route still needs a check from an authenticated
  Preview browser. No operator commitment or capsule data was used.
- The operator retried that same synthetic check in their browser and reported
  that it was redirected or blocked by Preview protection. This confirms the
  recovery route remains inaccessible in both browser sessions. No actual
  capsule was submitted, and no recovery result or gateway/API error phase was
  observed on this deployment.
- The synthetic check was then sent through the linked Vercel CLI's authenticated
  Preview access. It returned HTTP 404 `bundle_not_found`, the expected result
  for an unfunded synthetic commitment. That response means the gateway miss
  triggered the read-only Base Sepolia fallback, whose RPC and contract reads
  completed and found no active bundle for the synthetic commitment. No
  operator commitment or capsule was used.
- No operator recovery result or fresh gateway readiness/admin/launcher
  snapshot has been collected for this deployment. No exchange was attempted
  and no slot was consumed. Keep the issue open and the Preview unpromoted.

## Direct adapter harness and current browser gate (2026-09-23)

- The operator's latest browser result for the synthetic recovery request was
  “Redirected or blocked by Preview protection.” No API status or application
  error phase was visible. The protected `/recover` page has not yet been
  opened for the operator's capsule, and no capsule or operator credential
  entered this environment.
- The sidecar now includes a one-shot maintainer command,
  `zk-credits trial-registered-adapter`, for the second exchange path. It
  registers the official x402 `zk-prepaid` client adapter, shares the same
  request-bound Base proof factory and durable `base-slots.json` ledger as the
  Codex sidecar, and records challenge, proof, `PAYMENT-SIGNATURE`, settlement,
  response, and local/gateway counter deltas. It requires explicit interactive
  approval, checks fresh gateway readiness and authenticated admin status,
  confirms the local Base witness root matches the gateway root, records local
  launcher state and slot capacity, and refuses to run while the sidecar is
  active. Password and admin token prompts are hidden; command output contains
  only fixed phases, HTTP statuses, readiness check names, and aggregate
  deltas.
- Fresh local verification in this continuation passed: sidecar adapter,
  sidecar, and package distribution tests (10/10); recovery API and Base
  reader tests (19/19); recovery Playwright suite (7/7); web typecheck; sidecar
  build; web production build; and `git diff --check`. The first sandboxed
  Playwright run was blocked while binding its local test server; the retry
  with local loopback permission passed all seven cases. These tests use
  generated capsules and mocked chain/gateway exchanges.
- No live Codex sidecar exchange or direct adapter exchange was attempted.
  No fresh exchange-time gateway snapshot exists, no slot was consumed, the
  Preview remains unpromoted, and issue 26 remains open. Resume the operator
  recovery only after Preview access is available; ask for only success or the
  visible error phase.

## Fresh continuation checkpoint (2026-09-24)

- The operator again reported “Redirected or blocked by Preview protection”
  for the synthetic recovery check. No application status or error phase was
  visible, and no capsule was entered.
- Fresh local verification passed: sidecar focused tests (10/10), sidecar
  exchange integration tests (2/2), recovery API and Base reader tests
  (19/19), recovery browser tests (7/7), web typecheck and production build,
  sidecar build and CLI help, and `git diff --check`.
- The linked project configuration still names `zk-credits-web`. A fresh
  deployment inspection returned no metadata; deployment readiness remains
  at the earlier authenticated `READY` Preview check. The Preview has not been
  promoted.
- No successful operator recovery or live exchange was completed. No
  exchange-time gateway snapshot exists, no slot was consumed, and issue 26
  remains open.

## Operator recovery result and next-step handoff (2026-09-24)

- The operator retried capsule recovery and reported the visible error
  `No funded credential bundle was found for this recovery capsule.` with
  response body `{"error":"bundle_not_found"}`. The HTTP status was not
  included in that report. No capsule, password, commitment, credential, or
  proof was shared with this process; no credential was recovered and no
  exchange was attempted.
- In the current source, the browser sends the locally derived commitment to
  `/api/pilot/recovery`; the route falls back to a read-only Base lookup after
  the gateway's exact `404 bundle_not_found`, and returns the same 404 when
  that lookup finds no active bundle. The reported body alone cannot establish
  whether the Preview ran this source or which lookup branch produced the
  response.
- The phrase `Response was:` is absent from the current local recovery UI and
  e2e suite. Confirm the exact Preview deployment and page version before
  changing code. Existing API, Base reader, and browser tests already cover an
  absent bundle; add a new failing test only after a distinct mismatch is
  reproduced.
- See the [recovery and exchange handoff](base-sepolia-recovery-handoff-2026-09-24.md)
  for the bounded diagnosis sequence, stop conditions, and human checkpoints.
- Issue 26 remains open, the Preview remains unpromoted, and no slot has been
  consumed.

## Fresh internal-trial checkpoint (2026-09-26)

- Refreshed the task context against the internal-trial scope. A remote issue
  refresh or update was not possible from this runner: `gh auth status` reports
  no authenticated GitHub account, and anonymous issue-page requests were not
  available. No issue was created, edited, or closed; retain the last recorded
  open state for issue 26 until an authenticated refresh is available.
- The recorded Preview candidate remains
  `https://zk-credits-8xa8g3too-gadillacers-projects.vercel.app`
  (`dpl_3SVvVaVa1XTofs8FR7itGcJ96J9U`), previously identified as an unpromoted
  Preview for `zk-credits-web`. This session could not freshly confirm its
  deployment readiness or route version: Vercel inspection returned no
  metadata, direct API access failed before an HTTP response, and the browser
  runner could not launch Chrome in this sandbox. No deployment setting values
  were read or recorded, and no promotion or deployment mutation was attempted.
- A fresh request to `/api/pilot/recovery` used a newly generated synthetic
  unfunded commitment. The runner failed DNS resolution (`ENOTFOUND`) before
  connecting, so no HTTP response or application phase was observed. The
  earlier authenticated synthetic `404 bundle_not_found` remains the only
  successful live route check in the evidence; no operator commitment was
  used for it.
- The operator's existing capsule, password, commitment, and credential were
  not present in this environment and were not requested, copied, or used.
  The operator's previously reported `bundle_not_found` remains unresolved as
  to which lookup branch ran. No funded-bundle match has been independently
  established, so the trial stopped before readiness, slot, root, credit, or
  counter gates.
- No Codex sidecar or registered `zk-prepaid` exchange was attempted. No
  exchange phase or counter delta exists for this checkpoint, and no durable
  slot was consumed. No distinct defect was reproduced, so no regression test
  or implementation change was made. Keep the internal trial open and the
  Preview unpromoted.

## Authenticated GitHub retry and Preview edge result (2026-09-26)

- Retried GitHub access with network access enabled. The authenticated `gh`
  CLI successfully refreshed issue 26 as the open B22 internal Base Sepolia
  trial. Its live scope requires a fresh machine-readable launcher checkpoint
  proving provider incident resolution, unpaused launch control, passing
  readiness, and a current Base root scan with known roots before either path
  runs. The live scope matches this internal trial; its results must not be
  counted as external operator activations.
- Posted the redacted checkpoint to [issue 26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5844756356).
  The remote issue remains open. The comment records that no fresh launcher
  checkpoint was obtained here, so neither path ran.
- Retried the read-only synthetic recovery request with network access enabled.
  It returned HTTP 200 HTML after redirecting to Vercel `/login`; the deployed
  API route was not reached, so this is not a `bundle_not_found` or route
  success result. No operator capsule or commitment was used.
- No deployment or promotion action was taken. The last recorded Preview
  status remains the historical unpromoted Preview check; this session did not
  freshly verify deployment readiness. No exchange, counter delta, or slot
  consumption was recorded.

## Fresh authenticated stop gate (2026-09-26)

- Refreshed issue 26 with authenticated `gh`; it remains open and its live B22
  scope is the internal Base Sepolia trial. No result is counted as an external
  operator activation. The redacted ticket update is [recorded here](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5844930075).
- The authenticated Vercel CLI inspected the exact recorded deployment
  `dpl_3SVvVaVa1XTofs8FR7itGcJ96J9U`: it is `READY` with target `preview`. The
  project-level Preview variable list is empty. No deployment environment
  values were printed. The recovery route reads `GATEWAY_URL`, `BASE_RPC_URL`,
  `BASE_PRIVATE_CREDIT_BOND_ADDRESS`, `BASE_DEPLOYMENT_BLOCK`,
  `BASE_DEPLOYMENT_DOMAIN`, and `BASE_CONFIRMATIONS`; the prior deployment
  checkpoint records runtime settings scoped to this deployment. The Preview
  remains unpromoted.
- Vercel's authenticated curl reached the deployed recovery route: an invalid
  synthetic commitment returned HTTP 400 `invalid_commitment`. A separate
  valid synthetic unfunded commitment timed out after 18 seconds without an
  HTTP response, so this did not verify the deployed route's expected
  `bundle_not_found` result.
- The public gateway returned HTTP 404 `bundle_not_found` for a separate
  synthetic unfunded commitment. Four fresh `/ready` samples each returned
  HTTP 503 with `ready: false`. Launch control was enabled; database, Base
  root synchronization, verifier assets, and provider readiness passed. The
  `baseRpc` check failed with `behind_head`, so the B22 entry gate did not
  pass. No exchange was started.
- The operator's existing capsule remains local. Its last reported
  `bundle_not_found` came from an earlier Preview attempt; this checkpoint did
  not test that capsule against the exact deployment or confirm a funded Base
  bundle. No capsule, password, commitment, or credential was collected.
- No Codex sidecar or registered `zk-prepaid` exchange was attempted. There is
  no exchange phase, aggregate counter delta, or slot consumption to record.
  No deployment or promotion change was made; keep issue 26 open and the
  Preview unpromoted.

## Fresh continuation checkpoint (2026-09-26)

- Refreshed issue 26; it remains open as B22 with the internal-only scope and
  fresh machine-readable readiness requirements.
- Re-inspected the exact recorded deployment
  `dpl_3SVvVaVa1XTofs8FR7itGcJ96J9U`. Vercel reports it `READY`, target
  `preview`, at `https://zk-credits-8xa8g3too-gadillacers-projects.vercel.app`.
  Authenticated read-only requests returned HTTP 200 for `/recover` and HTTP
  400 `invalid_commitment` for the synthetic `/api/pilot/recovery` validation
  check. This confirms both routes answer on that deployment; no operator
  capsule or commitment was used. No deployment settings were changed, and the
  Preview remains unpromoted.
- Two fresh public `GET /ready` requests to the configured gateway timed out
  after 20 and 30 seconds without an HTTP response. The latest readable samples
  remain the four HTTP 503 responses with `ready: false` and
  `baseRpc: behind_head` recorded above. No current passing machine-readable
  checkpoint is available; the entry gate fails closed.
- The pinned local `zk-credits status` reports `Credential export: missing`,
  `Codex profile: installed`, and `Sidecar: stopped`. This process has no local
  `BILLING_INTERNAL_TOKEN`, so no authenticated `/v1/admin/status`, root,
  scan-position, credit, slot-capacity, or aggregate counter snapshot was
  collected.
- The operator was asked to retry recovery locally on the exact Preview and
  report only success or the visible error phase/status. No capsule, password,
  commitment, credential, or proof was received. No Codex sidecar or registered
  `zk-prepaid` exchange was attempted; no slot was consumed and no exchange
  phase or counter delta is recorded. Keep B22 open and the Preview unpromoted.
  The redacted checkpoint is posted to [issue 26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5845273947).

## Operator recovery result (2026-09-26)

- On the exact Preview recovery route, the operator reported the visible phase
  `bundle_not_found` (no HTTP status was provided). They initially answered
  that onboarding did not show an activated credential after “Fund my pilot
  credential,” then clarified that they are unsure whether the pilot funding
  credit button completed activation.
- The unpaid pilot provisions test credits through the gateway sponsor.
  Activation and a usable credential export therefore remain unverified. The
  reported error alone cannot distinguish an uncompleted sponsor funding
  attempt from restoring a capsule different from the one used for funding. No
  participant USDC top-up or payment was requested or made.
- Stop at the recovery gate. Do not retry funding or start either exchange from
  this result. The latest readiness checkpoint still fails closed because
  fresh `/ready` requests timed out and previous readable samples reported
  `baseRpc: behind_head`; authenticated admin snapshots and a passing launcher
  checkpoint remain unavailable. No exchange phase or counter delta exists.
  Keep B22 open and the Preview unpromoted.

## Fresh activation stop checkpoint (2026-09-27 08:33Z)

- Read-only Vercel inspection still reports the recorded deployment
  `dpl_3SVvVaVa1XTofs8FR7itGcJ96J9U` as `READY` with target `preview` at
  `https://zk-credits-8xa8g3too-gadillacers-projects.vercel.app`.
- The protected `/recover` request redirected and ended at HTTP 200 HTML.
  A synthetic invalid-commitment `GET /api/pilot/recovery` also ended at HTTP
  200 HTML after the protection redirect, so this runner did not observe an
  application response from either route today. No operator capsule,
  commitment, or credential was used. The last operator result remains the
  2026-09-26 `bundle_not_found` report on this Preview, without an HTTP status.
- The pinned local `zk-credits status` again reports
  `Credential export: missing`, `Codex profile: installed`, and
  `Sidecar: stopped`. No activated export is configured. The setup wizard
  therefore did not run, and no out-of-band proving bundle or resolving local
  witness/public tree has been verified for the credential.
- The operator remains unsure whether the sponsor-funded activation completed.
  Do not retry funding or proceed to proving until that is established for
  this capsule. The latest recorded machine readiness gate remains failed
  closed (`baseRpc: behind_head`, followed by readiness timeouts); no new
  `--trial-gate` or sponsor-allowance read was taken because activation is
  unresolved and no exchange is starting.
- Neither path ran. There is no new 402, proof/self-check, payment signature,
  settlement, committed response, payment response, counter delta, or slot
  consumption. Keep issue 26 open and the Preview unpromoted.
- Posted this redacted checkpoint to [issue 26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5854240421).

## Fresh funding-button retry preparation (2026-09-27)

- The operator asked to retry onboarding with a fresh invite and test the pilot
  funding button. A new single-use invite was issued to the authenticated
  account, which matches a configured pilot operator. Its code is delivered
  directly to the operator and is intentionally absent from this ledger and
  the issue.
- A fresh `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-27T08:50:32Z`: readiness, provider, admin authentication/status,
  launch control, and the current Base root all passed. The current root lag
  was 14 blocks; aggregate exchange counters and claims were zero.
- A read-only Base Sepolia check found 20.000000 test USDC in the sponsor and
  20.000000 allowance to the bond. No funding transaction was sent by this
  check.
- Before issuing the new invite, privacy-preserving database aggregates showed
  one `failed` and one `issued` funding capability, with no `funding`, `unknown`,
  or `funded` state. The invite and provisioning planes have no durable join,
  so these counts do not identify or resolve the operator's earlier click.
- The Preview remains `READY` and protected. Opening its `/onboarding` route in
  this runner redirected to Vercel sign-in, so no application page or route
  response was observed here. The operator must use the authenticated browser
  session on the recorded Preview and perform the password, capsule generation,
  download, and re-import locally before clicking “Fund my pilot credential.”
- The quoted “Could not look up the funded credential bundle” text belongs to
  the separate capsule recovery lookup. The funding-button result has not yet
  been observed. The operator should report only success or the visible phase
  and HTTP status; no capsule, password, request content, token, or credential
  was received by this process.
- No funding click, Base transaction, activation, exchange, slot consumption,
  or external operator activation is recorded. Keep issue 26 open and the
  Preview unpromoted.

## Operator activation confirmation (2026-09-27)

- The operator reports that the fresh invite flow completed funding. The
  provided screenshot shows the activated credential verified locally against
  the recovery capsule and downloaded. The credential file, password, capsule,
  contract address, transaction hash, and other joinable values were not
  collected or copied into this record.
- This funding flow is separate from the two internal exchanges required by
  issue 26. This record does not assert an external-pilot slot or activation
  count. No x402 exchange was run, and no 402, proof/self-check, payment
  signature, settlement, committed response, payment response, or counter
  delta is recorded.
- The protected Preview still requires the operator's authenticated browser.
  Next, verify the local export, pinned proving bundle, and a resolving witness
  with the local setup wizard. Stop before proving if any input fails.
- The post-activation page displayed `https://your-gateway.example` and
  `zk-credits setup`. The page falls back to that placeholder when
  `PUBLIC_GATEWAY_URL` is unset; the CLI requires `zk-credits setup codex` and
  can prompt for the password without echo. The canonical public gateway
  `https://zk-credits-gateway.onrender.com` returned HTTP 200 with `ready: true`
  from `/ready` during this checkpoint.
- The screenshot displayed an expiry date in 1970. The funding API and
  credential represent expiry as Unix seconds, while the page formatter treats
  the value as milliseconds; the activation flow's future-expiry check passed
  before showing the success state. This is a display defect, not evidence
  that the downloaded credential expired.
- The fresh readiness and allowance snapshots above predate activation. Read
  both again immediately before each internal exchange; do not reuse those
  snapshots as a trial gate.
- Keep issue 26 open and the Preview unpromoted until both internal paths meet
  every acceptance phase.

## Local setup correction checkpoint (2026-09-27)

- The operator reports that `zk-credits setup codex` did not become ready. The
  local sidecar log was inspected without printing its contents; its recorded
  startup phase was the missing `ZK_CREDITS_ARTIFACT_DIR` configuration. No
  credential, password, bundle contents, witness, prompt, or proof was read
  into this evidence.
- The worktree now makes `zk-credits setup codex` validate the pinned bundle,
  decrypt the local export after a hidden terminal password prompt, resolve
  and validate a local witness for that credential, and only then configure
  Codex. The password is piped to the detached sidecar over stdin and is not
  placed in an environment variable. Setup errors direct the user to obtain
  the bundle and public Base tree file from their pilot contact.
- The onboarding source now gives the npm install command, the three local
  file paths, the current gateway URL, and the supported setup command. The
  expiry formatter also treats credential expiry values as Unix seconds.
- At this checkpoint, registry metadata reported `zk-credits@latest` as
  `0.2.0`, matching the worktree package version at that time. These local
  changes had not been published or deployed; installing the then-current
  version did not include them. No npm publication or deployment was
  attempted.
- Verification: sidecar build passed; all 73 executed sidecar tests passed
  (3 skipped). The focused web copy/date tests passed (37 tests), and scoped
  ESLint passed. The web typecheck remains blocked by stale generated `.next`
  route references and missing `viem` modules in this checkout.
- The activated export, pinned bundle, and resolving witness have not been
  verified together on the operator's machine. No trial exchange was run;
  neither path has a 402, proof/self-check, `PAYMENT-SIGNATURE`, settlement,
  committed response, `PAYMENT-RESPONSE`, or counter delta. Keep issue 26 open
  and the Preview unpromoted.

## Prior candidate package validation checkpoint (2026-09-27)

- Registry metadata identified `0.2.1` as the next unpublished `zk-credits`
  version. The sidecar manifest and lockfile now identify the local candidate
  as `0.2.1`; published pilot pins remain at `0.2.0` until the candidate is
  reviewed and separately authorized for publication.
- The sidecar suite passed (20 files passed, 1 skipped; 73 tests passed,
  3 skipped), the focused web copy/date suite passed (38 tests), and the
  sidecar TypeScript build passed. `npm pack --json` produced a 468,210-byte
  tarball with 49 entries, including the Responses bridge, setup preflight,
  and circuit manifest. Its integrity is
  `sha512-Fz49CwsIbLgr65FCOuGVDI7PkfLNdv8uTslzY3I4geqdwxZt6JxKfk7cCSJbUxsmN4VzzEOIFot4+sg53dRDqQ==`.
- A clean temporary install from that tarball passed; `npm ls --depth=0`
  resolved `zk-credits@0.2.1`, and the installed CLI status command ran from
  an empty temporary home. It reported the credential and Codex profile
  missing and the sidecar stopped. No local credential, proving bundle, or
  witness was available in this environment, so setup and local proving were
  not attempted.
- npm's install audit reported 18 dependency advisories (12 low, 2 moderate,
  4 high). A separate audit of the production dependency graph found high
  advisories in transitive `underscore` and `ws`, and a low advisory in
  `elliptic`. No dependency changes were made; review these before any
  publication.
- No sponsor allowance was reread and no fresh `--trial-gate` was run because
  no live path could start without the operator's local inputs. Neither
  exchange was attempted; there is no 402 challenge, proof/self-check,
  `PAYMENT-SIGNATURE`, settlement, committed response, `PAYMENT-RESPONSE`,
  counter delta, or consumed slot. Keep issue 26 open and the Preview
  unpromoted. No package was published or deployment made.

The later automatic setup checkpoint below supersedes the version and
publication status in this earlier record.

## Automatic setup candidate validation checkpoint (2026-09-27)

- The npm registry reports `zk-credits@0.2.1` as the current published
  version. The local sidecar package and lockfile now identify `0.2.2` as the
  next candidate. It adds local discovery of a hash-pinned proving bundle and
  witness, validates the witness against the activated credential, and saves
  the selected sources in an owner-readable-only config file. It does not save
  the credential password or fetch proving material.
- The sidecar suite passed (20 files passed, 1 skipped; 76 tests passed,
  3 skipped); the TypeScript build passed. `npm pack` created
  `zk-credits-0.2.2.tgz` (475,315 bytes, 49 entries, SHA-512 integrity
  `sha512-xj1gAHPAUbrbTyoGGBygUZh28M9Da9mCwaobEhrlJYdulwD4eVjeBWVfpilCTDjnmqXn1N9UyV1UIFyE+cfTsg==`).
  The tarball contains `dist/setup-config.js` and `circuits/manifest.json`.
  An isolated install from the tarball succeeded, and the installed CLI help
  showed the new discovery instructions.
- `npm audit --omit=dev` reports three high-severity production dependency
  advisories through `snarkjs -> bfj -> jsonpath -> underscore`. These have
  not been resolved or reviewed. Do not publish until the operator reviews
  whether to accept or remediate them.
- The local credential, pinned proving bundle, and resolving witness have not
  been verified together on the operator's machine. No trial exchange was
  run, no allowance or fresh trial gate was checked, and no package was
  published. Keep issue 26 open and the Preview unpromoted.

## V2 recovery and deployment checkpoint (2026-09-27 12:56Z)

- The original v1 proving key and WASM were not recovered. The existing
  activated credential export is structurally valid, but its activation
  metadata identifies the existing v1 bond. The `zk-credits@0.2.2` tarball
  still contains only the circuit manifest; the matching old verification key
  does not replace the missing proving inputs.
- A new development-only proving bundle was generated from the current circuit
  and local `pot14_final.ptau`, under release identifier
  `private-credit-spend-bn254-dev-sepolia-v2`. All three local artifacts are
  mode `600` in a mode `700` directory, and their SHA-256 digests match the
  sidecar manifest:
  - WASM: `64da977cdbf3105a5948a6eb82cac610979e589558ddb1cd0419c460e7735c56`
  - zkey: `7cc83e6df3f0c805d8b49d4063ee56a93123ff19acd49d639ff263588ef7a144`
  - verification key: `4844820509c32722c0c867f028a713df8a1b6478ff7376a80861e7dcbc9c51fc`
- The R1CS ceremony check passed and generated fixture proofs passed local
  self-check. A full powers-of-tau verification did not finish and was
  interrupted, so this development setup is not represented as a completed
  ceremony or production-ready material.
- Six v2 contracts, including the verifier, spend adapter, Poseidon contracts,
  and bond, were deployed to Base Sepolia and independently verified on
  BaseScan. The v2 bond has no funded bundle. The existing v1 bond still holds
  its original 20 test USDC and must be handled only under its original
  contract rules.
- Circle's testnet faucet confirmed a 20 USDC transfer to the sponsor. A fresh
  on-chain read found 20 USDC at the sponsor, 20 USDC at the v1 bond, and zero
  at the v2 bond. Allowance to v1 is zero; allowance to v2 is exactly 20 USDC.
  The v2 launch checkpoint now records the approval as confirmed. No v2 bundle
  funding transaction was sent.
- The hosted gateway is still configured with the v1 verifier key. The v2
  verification key and supporting source changes exist only in this local
  worktree, so changing the hosted key path now would leave the service unable
  to load its verifier asset. The activated export is for v1, and no v2
  activation, resolving witness, or proof using the operator's credential has
  been validated.
- A fresh read-only `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-27T12:56:05.023Z`: gateway readiness, provider, authenticated admin
  status, enabled launch control, and current Base scan passed. The scan knew
  two roots at block `47372726` with lag 12. All exchange metrics and claims
  were zero. This gate does not validate the hosted verifier's version or the
  local credential and witness together.
- No B22 exchange was attempted. No 402 challenge, proof/self-check,
  `PAYMENT-SIGNATURE`, settlement, committed response, `PAYMENT-RESPONSE`,
  failure phase, counter delta, or slot consumption is recorded. The local
  production dependency audit still reports three high advisories through
  transitive dependencies; no package was published. Keep issue 26 open until
  the v2 verifier is actually deployed, a compatible credential and witness
  are validated locally, and both separate exchanges complete their
  acceptance phases.
- Posted this redacted checkpoint to [issue 26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5856086576).

## Base root index fix and fresh readiness (2026-09-27)

- The first post-deploy trial gate failed closed because the gateway had a
  current Base root but reported zero known roots. A direct read of the bond
  confirmed its constructor root equaled its current root and matched the
  gateway's root; the chain scan was current. This isolated the failure to the
  gateway's durable root-index initialization, not contract linkage or RPC
  lag.
- The synchronizer previously skipped constructor-root seeding whenever a
  persisted `currentRoot` was present, even if `knownRoots` was empty. Commit
  `a39cdd4` now indexes the constructor root in that persisted-state case and
  includes a regression test that reproduces it. The focused Base sync tests
  passed (4 tests), TypeScript typecheck passed, and the full gateway suite
  passed (378 tests; 29 skipped).
- Render deploy `dep-dasi3dgjo6nc73bsk12g` is live at commit
  `a39cdd4ae442ec7cd25f251f886efe2f459626e7`. The public circuit and
  verification-key identifiers remain unchanged. The development-only bundle
  identity is recorded above by the WASM, zkey, and key digests. The Base
  Sepolia contracts in this replacement trial are:
  - bond: `0xcc1909dD30485d6D9a46e3d33cf04C1378b586Ab`
  - Groth16 verifier: `0x5870117EA7ACb28B3f36fb64284b77c4eD2B7148`
  - spend verifier: `0x37663bC461AB8EccD3b7D69Bde7eeF13D489723e`
  - Poseidon T2: `0x24eeADf5e1d2adB072F55CDA504F493b031B5f7F`
  - Poseidon T3: `0x05e12A8903ac0Bf2D8fDE9e4595a26c3CB0fb028`
  - Poseidon T4: `0xfd9eCf27fa0D4Ad5096607A9b5c392c88DC1Dbac`
- A fresh read-only `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-27T14:03:18.475Z`. Readiness, provider, admin authentication/status,
  launch control, and Base scan all passed. One root was known at block
  `47374739`, with 16 blocks of lag. All aggregate exchange counters and claim
  counts remained zero.
- A direct Base/gateway linkage check at `2026-09-27T14:07:18.923Z` confirmed
  chain ID 84532, deployed bond bytecode, equality between constructor and
  current roots, equality between the current on-chain and gateway roots, and
  an authenticated admin response. The index contained one root at scan block
  `47374860`, with 15 blocks of lag. Root values were not recorded.
- A sponsor balance/allowance read at `2026-09-27T14:08:19.797Z` found 20 test
  USDC at the sponsor and 20 test USDC approved to the bond (below the fixed
  80 USDC pilot bound). This was read-only; credential funding has not been
  sent. Re-read immediately before each exchange.
- Credential issuance and funding have not started. The local browser reached
  GitHub sign-in but has no authenticated session yet. Continue only through
  the session-bound onboarding flow; do not simulate or bypass GitHub identity.
  No exchange phase, failure phase, counter delta, or slot consumption exists.
  Keep issue 26 open until a compatible local credential is validated and both
  exchanges pass.
- Posted this redacted stop-point to [issue 26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5856617938). The issue remains open.

## Authenticated onboarding and database credential rotation stop (2026-09-27 14:16Z)

- The GitHub sign-in completed and the hosted Pilot onboarding dashboard is
  available. The session has a numeric GitHub account ID accepted by the
  redemption route; the ID itself is not recorded here.
- While inspecting local invite-admin configuration, a local database
  connection string was accidentally included in a tool result. Treat that
  database password as exposed. No invite was issued or redeemed, and no
  database write, credential funding, proof, exchange, or activation-slot use
  occurred after this discovery. The operator directed continuation and will
  handle password rotation later; rotation remains outstanding.
- The prior B22 checkpoint comment records the earlier sign-in wait. No
  exchange result is available yet; issue 26 remains open.

## Browser reauthentication required (2026-09-27 14:26Z)

- The authenticated dashboard session was confirmed, but it was lost when the
  browser automation session was reset to clear stale file-picker state. The
  clean browser is now at GitHub sign-in. No invite was issued or redeemed,
  and no credential funding, proof, or exchange occurred. Continue after the
  operator completes sign-in again; keep issue 26 open.

## V2 artifact release and candidate verification stop (2026-09-27 15:49Z)

- Created the private repository
  `mangekyou-labs/zk-credits-base-sepolia-v2-bundle`. GitHub immutable
  releases are enabled. Published the pinned `v2.0.0` release (ID
  `397705951`) after verifying the draft asset; GitHub reports the published
  release as immutable. The 6,888,916-byte archive digest is
  `dc60b3109b3d907e2b9e8c4253fb52e77400d763eb443968e8de3af6b7e0b709`.
  Its three entries match the manifest hashes. The repository README marks
  these as development-only Base Sepolia artifacts and says not to upload
  credentials, witnesses, or proofs.
- Prepared `zk-credits@0.2.3` as an unpublished npm candidate. `npm pack`
  produced a 483,312-byte tarball (SRI
  `sha512-0dkvFv3uZrecJ/gwHaQfu8VnhKgjsoSX9eUzPstN7rWVmEWG27N5pcuRLEewXZFufHB1gqwL1STrK6ytOxvZkw==`).
  The package includes the release pin and manifest, not the proving files.
  A fresh temporary npm consumer installed the tarball and ran the CLI help
  command. The installed package then used local `gh` authentication to read
  the immutable private release, verified release identity and all hashes,
  and installed the bundle in a temporary home with owner-only permissions.
  That temporary bundle was removed after verification.
- Sidecar verification passed: 22 test files / 85 tests, TypeScript build,
  and `npm audit --omit=dev` with zero production vulnerabilities. The
  focused gateway and trial-gate suites passed (71 tests across 3 files), and
  the gateway TypeScript typecheck passed. No credential or witness was used
  in the temporary install test.
- Fresh Render reads found the public service live at commit
  `a39cdd4ae442ec7cd25f251f886efe2f459626e7`. The public gateway reports
  ready and advertises `zk-prepaid` on `eip155:84532`, but `/ready` does not
  expose the V2 compatibility metadata required by the new gate. The Render
  environment's legacy aliases `BASE_PRIVATE_CREDIT_BOND_ADDRESS` and
  `BASE_DEPLOYMENT_BLOCK`, plus `BASE_DEPLOYMENT_DOMAIN`, match the sidecar
  manifest. `BASE_BOND_ADDRESS`, `BASE_BOND_DEPLOYMENT_BLOCK`, and
  `BASE_SPEND_VERIFIER_ADDRESS` match the recorded local V1 state instead.
  `ZK_PREPAID_CIRCUIT_ID` matches the V2 manifest, but
  `ZK_PREPAID_VERIFYING_KEY_ID` does not; a verification key path is
  configured, while the old readiness response provides no key digest to
  check. Render reports no environment groups linked to this service. The
  live service has not been changed. The Vercel environment read
  returned HTTP 403, so its environment settings could not be verified in
  this pass.
- A fresh read-only Base Sepolia RPC check after the Render comparison
  confirmed chain ID 84532, bytecode at the pinned bond, spend verifier, and
  Groth16 verifier, the bond's spend-verifier and domain links, and the spend
  verifier's Groth16 link all match the V2 manifest.
- The final read-only trial gate at `2026-09-27T15:53:47.993Z` failed closed with
  `v2Compatibility: unavailable`; local preflight, gateway readiness,
  provider, authenticated admin status, launch control, and Base scan passed.
  The scan had one known root at block `47378066`, with 4 blocks of lag.
  Every aggregate exchange metric and claim count was zero. No 402 challenge,
  local proof/self-check, payment header, settlement, committed response,
  failure phase, or slot consumption occurred. No v2 credential was
  re-imported, no witness was validated, and no funding transaction was sent.
- The candidate was not published to npm, and no live gateway change was
  made. Re-read Vercel access and reconcile the live V2 metadata, then obtain
  approval before publishing npm or changing the gateway. Re-read sponsor
  allowance before any later funding or exchange. Issue 26 remains open.
- Posted the redacted setup, gate, and no-exchange checkpoint to
  [issue 26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5857386019).

## Vercel production readback and refreshed no-spend gate (2026-09-27 16:03Z)

- The production environment list for the linked Vercel project is now
  readable through the local authenticated Vercel CLI session. It contains 11
  variables. The V2 bond, deployment block/domain, circuit ID, and verifying
  key ID variables checked against the sidecar manifest are absent. No
  environment values were recorded. Direct requests with the configured
  launch `VERCEL_TOKEN` still return HTTP 403; this readback used the local CLI
  session.
- Fresh machine-readable `scripts/launch-pilot.sh --trial-gate` at
  `2026-09-27T16:02:52.259Z` failed only at `v2Compatibility: unavailable`.
  Local preflight, gateway readiness, provider, authenticated admin status,
  launch control, and Base scan passed. One root was known at block `47378336`
  with 6 blocks of lag. All aggregate exchange metrics and claim counts were
  zero.
- Vercel onboarding metadata is therefore not pinned to V2, and the live
  gateway still does not expose the compatibility report required by the
  gate. No V2 credential was imported, no witness was validated, and no
  funding action, proof, HTTP exchange phase, or slot consumption occurred.
  No Vercel or Render settings were changed, npm was not published, and issue
  26 remains open.
- Posted this readback and gate snapshot to
  [issue 26](https://github.com/mangekyou-labs/haze-api/issues/26#issuecomment-5857496144).

## npm dependency advisory review (2026-09-27)

- Current registry audit of the repository root reports 23 affected package
  entries: 13 low, 4 moderate, and 6 high. With development dependencies
  omitted, it reports 20: 13 low, 2 moderate, and 5 high. The high findings
  include vulnerable `brace-expansion`, `underscore`/`jsonpath`/`bfj`, and
  `ws` paths; the low and moderate findings include the `elliptic` and ethers
  provider dependency tree.
- These root paths include `snarkjs@0.7.6` through `bfj`, `jsonpath`, and
  `underscore`, plus `snarkjs` through `ejs`, `jake`, `minimatch`, and
  `brace-expansion`. The root shared package also resolves
  `circomlibjs@0.1.7` to `ethers@5.8.0`, `@ethersproject/providers`,
  `elliptic`, and `ws@8.18.0`. The gateway dynamically imports `snarkjs` in
  `ts/zk-prepaid-gateway.ts`, so these root findings affect a runtime
  dependency tree and remain relevant to a gateway deployment.
- The separate `packages/zk-credits-sidecar` package reports zero production
  findings. Its full audit has two moderate findings in development-only
  Vitest packages. Its lock resolves `brace-expansion` to 2.1.4,
  `underscore` to 1.13.8, and `ws` to 8.21.0; it has no root ethers package.
- Maintainer advisories list `brace-expansion` 2.1.4, `underscore` 1.13.8,
  and `ws` 8.21.0 as patched releases. The elliptic advisory lists no patched
  version. See the [brace-expansion advisory](https://github.com/advisories/GHSA-rgw5-rvv9-x895),
  [underscore advisory](https://github.com/advisories/GHSA-qpx9-hpmf-5gmw),
  [ws advisory](https://github.com/advisories/GHSA-96hv-2xvq-fx4p), and
  [elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84).
- `npm audit fix --dry-run --omit=dev` indicated that the root brace expansion
  issue can be updated within its allowed range. The root ethers/elliptic and
  `ws` tree was still flagged; npm's suggested forced fix would replace
  `circomlibjs` with 0.0.8, a breaking change. The dry run changed no files.
  No root dependency changes were made. This review records the findings,
  their runtime paths, and the reason an automatic forced fix was not applied.

## V2 live deployment and fresh no-spend gate (2026-09-27 16:56Z)

- The root Vercel production deployment is Ready with the V2 onboarding
  metadata configured. The authenticated local Vercel CLI was used; the
  previously exposed `VERCEL_TOKEN` was not used. The operator reports that
  rotation is not complete yet. Do not use that token; record rotation as an
  outstanding security closeout.
- Render service `zk-credits-gateway` is deployed from commit
  `54e8fbc5f98da650d445421a723731b8bcae94b2`. Its readiness response returned
  HTTP 200 with `ready: true`, launch control enabled, and V2 compatibility
  `pass`. The public report matches the pinned Base Sepolia chain, bond,
  deployment block/domain, circuit and verifying-key identity/hash, verifier
  pointers, and deployed bytecode. The verification key is served from the
  uploaded Render secret-file path.
- A fresh machine-readable `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-27T16:56:25.362Z`. Local preflight, gateway readiness, V2
  compatibility, provider, authenticated admin status, launch control, and
  Base scan all passed. The scan had one known root at block `47379934`, with
  14 blocks of lag. Aggregate exchange metrics and all claim counts were zero.
- `zk-credits@0.2.3` passed package build, sidecar tests, packed-candidate
  clean install, and the package's pinned immutable-artifact hash check. The
  authorized npm publication attempt stopped with `EOTP`; no authenticator
  code was requested or handled. Registry latest remains `0.2.2`, so the
  0.2.3 onboarding pin cannot be used from npm yet.
- The earlier browser funding report and downloaded export refer to V1. Keep
  that export intact. This V2 deployment and readiness gate do not reconcile
  its durable funding record or establish a V2 activation. No new V2 funding,
  re-import, witness validation, proof, 402 challenge, exchange, or slot
  consumption occurred in this continuation. Keep issue 26 open.
- The working tree still contains unrelated user changes; the gateway commit
  was limited to its explicit file list. No broad staging, reset, or cleanup
  was performed.

## npm publication, setup CLI alignment, and invite issuance (2026-09-27 17:17Z)

- The operator reports that the V1 export is preserved and its funding outcome
  is reconciled. This is an operator-reported status; this continuation did
  not access the export or perform another V1 or V2 funding action.
- The published npm registry package is `zk-credits@0.2.3`. Before updating,
  this machine's global `zk-credits` executable resolved to version `0.2.2`,
  whose embedded missing-bundle error exactly matched the operator's output.
  Installing `zk-credits@0.2.3` globally completed, and the global package
  version now reports `0.2.3`. Its setup code uses the authenticated GitHub
  CLI to acquire the manifest-pinned bundle. The authenticated GitHub session
  can read the pinned `v2.0.0` release and its expected asset. Setup itself was
  not run here because it requires the operator's local credential password.
- A fresh machine-readable `scripts/launch-pilot.sh --trial-gate` passed at
  `2026-09-27T17:19:04.912Z`. Local preflight, gateway readiness, V2
  compatibility, provider, authenticated admin status, launch control, and
  Base scan passed. The scan had one known root at block `47380610`, with 18
  blocks of lag. Aggregate exchange metrics and claim counts were zero.
- One invite was issued through the existing admin service, bound to the
  authenticated GitHub account, with the default seven-day lifetime. Its
  plaintext code is delivered privately and is intentionally absent from this
  evidence and the public issue. It expires at `2026-10-04T17:17:06.995Z`.
- No V2 credential or witness was accessed by this agent, and no sponsor
  funding, proof, exchange, or slot consumption occurred. Before V2 funding,
  take a fresh trial gate and reread sponsor allowance. Issue 26 remains open.

## Operator setup now requires a Base Sepolia RPC (2026-09-27 17:25Z)

- The operator reports that `zk-credits setup codex` now stops with the
  explicit error that `BASE_RPC_URL` is required to sync the pinned V2 bond
  from its deployment block. The 0.2.3 README documents this environment
  variable as part of first-run setup. This indicates setup advanced beyond
  the earlier missing-bundle failure, but no witness sync or validation is
  confirmed.
- No password, credential, RPC URL, or other secret was provided to the
  assistant. No V2 funding, proof, exchange, or slot consumption occurred.
  The next operator action is to set a Base Sepolia RPC endpoint locally and
  rerun setup; keep any provider key and the credential backup password local.

## Setup reaches gateway root verification (2026-09-27 17:29Z)

- The operator reports that setup now prompts for `Gateway admin token:` after
  entering the credential backup password with a Base Sepolia RPC configured.
  In the 0.2.3 flow, this hidden prompt is used to call the gateway's
  authenticated `/v1/admin/root-known` check after the local event witness has
  resolved and validated against the credential. Setup then still needs to
  finish its pinned proving-bundle check and save local setup configuration.
- The admin token was not shared with the assistant. The operator should enter
  the gateway's `BILLING_INTERNAL_TOKEN` value only at the local no-echo prompt;
  this is not the invite code or a GitHub, Infura, Vercel, or credential password.
  No V2 funding, proof, exchange, or slot consumption occurred.

## Admin setup completed; new-user token blocker confirmed (2026-09-27 17:34Z)

- The operator reports that `zk-credits setup codex` completed after they
  entered the gateway admin token locally. The CLI printed that the pinned
  proving bundle and witness were validated for the activated credential,
  saved local setup paths, and reported Codex ready. No token value was shared.
- This successful operator setup does not resolve the new-user blocker. The
  package's first-run instructions do not and should not distribute
  `BILLING_INTERNAL_TOKEN`, but setup currently calls the admin-only
  `/v1/admin/root-known` endpoint. New users cannot complete the advertised
  flow without an operator secret. No proof or exchange was run and no slot
  was consumed.

## Public root check and first Codex trial probe (2026-09-27 18:02Z)

- Added public `POST /v1/root-known` to the gateway. It validates a public
  field root, applies a per-client rate limit, and returns only
  `{ "known": boolean }`. Invalid roots return 400, rate limits return 429,
  and an unavailable root index returns 503. The protected
  `/v1/admin/root-known` route remains authenticated. Gateway commit
  `cbcdc49` was pushed, and the Render deploy reached `live`.
- Against the live gateway, the current public root returned HTTP 200 with
  `{ "known": true }`, a valid unknown root returned HTTP 200 with
  `{ "known": false }`, and an invalid field returned HTTP 400. The returned
  success bodies contained only the `known` key. The unauthenticated admin
  root check returned HTTP 401. Unit tests cover the rate-limited 429 and
  unavailable-index 503 responses.
- Updated `zk-credits setup codex` to call the public check without an
  authorization header or `BILLING_INTERNAL_TOKEN` prompt. The README now
  documents that setup flow. The `0.2.4` candidate passed all 23 sidecar test
  files (87 tests), gateway tests (19 tests), TypeScript checks, package
  build, and a clean packed install. npm publication stopped with `EOTP`;
  no authenticator code was requested or handled, and the registry remains
  at `0.2.3`. Do not invite new users until `0.2.4` is published.
- The earlier Codex trial probe failed locally with
  `unsupported_reasoning_controls` before reaching the 402 route. No 402
  challenge, proof, self-check, payment signature, facilitator settlement,
  committed response, or payment response occurred. Sidecar exchange
  counters remained at zero. The sidecar was stopped, and the durable slot
  ledger was reconciled with no slots consumed.
- A fresh machine-readable trial gate passed at
  `2026-09-27T18:01:43.534Z`; readiness, V2 compatibility, provider,
  authenticated admin status, launch control, and current Base scan all
  passed. The scan reported two known roots, block `47381898`, and nine
  blocks of lag. Aggregate exchange and claim counters were zero. At
  `2026-09-27T18:02:09.566Z`, a Base Sepolia allowance read showed zero sponsor
  USDC, zero sponsor-to-bond allowance, and 20.000000 USDC at the bond.
- No retry started: the current CLI environment reports no configured
  credential export, though encrypted local exports exist. Setup and exchange
  require the operator's local backup password, which was not collected.
  The registered-adapter exchange remains unattempted pending a successful
  Codex exchange and its own fresh gate and allowance read. Issue 26 remains
  open; these calls are not external operator evidence.
- Vercel token rotation was checked with `VERCEL_TOKEN` removed from the CLI
  environment, without reading or reusing that value. The account token list
  contains multiple entries and does not identify which one matches the
  launcher token, so its rotation status remains unverified. The launcher
  database credential rotation remains scheduled for after both exchanges.
