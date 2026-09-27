# Internal Base Sepolia x402 trial

Status: **fresh launcher gate passes; paused before exchange because the local credential is missing and the installed Codex Responses request does not fit the gateway's bounded service class**
Checkpoint: 2026-09-27

This is an internal technical trial using one locally held credential. It is
separate from the invite-only external operator pilot. It does not count as an
operator activation. Keep the issue open and the preview unpromoted.

## Fresh launcher and compatibility checkpoint (2026-09-27)

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
