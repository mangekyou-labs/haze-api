# Internal Base Sepolia x402 trial

Status: **blocked; fresh gateway gate could not be collected and no successful exchanges are recorded**
Checkpoint reviewed: 2026-09-23

This is an internal technical trial using one primary GitHub account and one
locally held credential. It is separate from the invite-only external operator
pilot. The three setup accounts are setup identities, not three independent
operators. Internal calls must not be submitted through the external operator
evidence wizard or counted as operator activations.

## Launcher checkpoint

The checkpoint files were generated at `2026-09-21T04:43:53Z` and report
readiness `false` and launch control `paused` for a provider incident. The
database, verifier assets, and provider readiness checks pass; launch control
and the Base root check fail. The Base root index has zero known roots and no
scan position. `zk-credits status` was run on 2026-09-23 but exited with code 1
and text output, so there is no fresh machine-readable readiness result. Treat
the snapshot as stale until a fresh status check succeeds.

On 2026-09-23, read-only GETs to the published gateway `/health` and
`/v1/contract-status` each timed out after 12 seconds without a response
(contract-status returned HTTP 000). These checks do not establish readiness
or refresh the launcher checkpoint.

Aggregate launcher counters at review:

| Counter | Value |
|---|---:|
| Challenges issued | 1 |
| Valid proofs | 0 |
| Invalid proofs | 0 |
| Reservations created or reused | 0 |
| Claims committed | 0 |
| Successful dispatches | 0 |
| Dispatch errors / timeouts | 0 / 0 |
| Requests rejected while paused | 3 |

The three recorded launcher attempts each returned `pilot_paused`. No live
exchange was attempted while launch control was paused. The checkpoint was
left unchanged; do not clear the pause as part of evidence collection. Recheck
readiness and the incident state before starting the trial.

The user confirmed that the Stellar-labeled deployment was the wrong app and
requested `https://hazecredits.vercel.app` for this trial. On 2026-09-23, that
host was attached as a production domain to `zk-credits-web`, and the
production `NEXTAUTH_URL` was set to it. A fresh production deployment reached
Ready. The public sign-in page now loads at this host, and its GitHub button
emits the callback URI
`https://hazecredits.vercel.app/api/auth/callback/github` for OAuth client ID
`Ov23liH6ZVmwWRLR43nY`. The user reported the `redirect_uri is not associated
with this application` error before this deployment correction. On 2026-09-23,
the user confirmed hosted sign-in succeeds. No account identifiers or
credentials were recorded.

## Trial paths and evidence

The published `zk-credits` launcher exposes `zk-credits setup codex` and
`zk-credits codex`. After launch readiness and hosted GitHub sign-in are
confirmed, record the two paths independently:

| Path | Challenge | Local proof and self-check | Payment signature | Facilitator settlement | Committed response | Payment response |
|---|---|---|---|---|---|---|
| Codex sidecar | Pending | Pending | Pending | Pending | Pending | Pending |
| Controlled x402 client registering `zk-prepaid` | Pending | Pending | Pending | Pending | Pending | Pending |

For the controlled x402 path, bind the proof to the exact request and use the
sidecar's local proving machinery with the existing adapter. This establishes
only a controlled integration result, not compatibility with an independently
operated x402 agent.

Store only redacted protocol outcomes and aggregate counters here. Keep the
credential, password, proof artifacts, and proving files on the operator's
machine. Never record secrets, full wallet or account identifiers, spend-plane
identifiers, request bodies, or raw payment headers in this evidence file.

## External pilot boundary

Issue #26 is now B22, the internal trial tracker. Issue #27 is B23, the
follow-on for three independent external operators. The two-week readout in
issue #16 is blocked by #27 and starts only at the first qualifying external
activation. Keep internal outcomes out of the external evidence bundles. Keep
the external pilot open until three distinct operators run their own agents
and submit qualifying bundles.

The tracker split and dependency updates are complete. Live trial results
remain pending; the local checkpoint currently does not permit either trial
path to run.

## 2026-09-23 resume diagnostics

- Fresh `zk-credits status` still exits 1 with `An unknown error occurred.`
- The installed CLI is `zk-credits` 0.1.3. Its `status` command reports only
  local identity, Codex profile, and sidecar health; it does not query the
  provider incident, Base root index, or launch-control checkpoint.
- The status path checks the macOS Keytar identity before printing any lines.
  A redacted direct Keytar lookup for the expected service/account also fails
  with `Error: An unknown error occurred.` This leaves local identity state
  unreported and is consistent with the observed CLI failure; it is not proof
  of provider readiness.
- GitHub tracker access was confirmed in the user's shell. Issues #25, #26,
  #27, and #16 were updated; the actual blocker graph now has #27 blocked by
  #14, #24, and #26, and #16 blocked only by #27.
- No checkpoint was cleared and no x402 exchange was run. Keep the trial
  paused until a machine-readable control-plane checkpoint shows readiness,
  launch control is unpaused for a resolved incident, and the Base root check
  has a current scan position and known roots.

## 2026-09-23 fresh gate attempt

- At `2026-09-23T06:03:34Z`, the installed `zk-credits` 0.1.3 CLI rejected
  `zk-credits --status` and printed usage; that interface is not supported by
  this installed launcher. Its supported `zk-credits status` command exited 1
  with `An unknown error occurred.`
- At `2026-09-23T06:06:32Z`, fresh GETs to `/ready` and authenticated
  `/v1/admin/status` using the local gateway configuration both failed with
  `ECONNREFUSED`. The configured loopback gateway was not accepting connections.
  This does not establish a current gateway timestamp, provider incident state,
  provider checks, launch control, Base root count, or scan position. The earlier
  launcher checkpoint and aggregate counters above remain the last recorded
  values; they are not fresh gate evidence.
- `gh issue view 26 --repo mangekyou-labs/haze-api` failed with `error
  connecting to api.github.com`, so the current B22 issue text and comments
  could not be refreshed from this session.
- Entry gate remains unavailable. No exchange was run, no checkpoint was
  cleared, and no issue update was made. Keep B22 open and paused. Retry after
  the intended gateway endpoint is available, the status GETs succeed, and a
  machine-readable launcher checkpoint can be collected.

## 2026-09-23 hosted reconciliation

- The protected launch environment names `https://zk-credits-gateway.onrender.com`
  as the gateway. The Render service was live, but its `autoDeploy` setting was
  `yes` while the reviewed launcher configuration requires it to be `no`.
  Updated only that Render service field through the service update API. The
  API returned HTTP 200; a read-back returned HTTP 200 with `autoDeploy: no` at
  `2026-09-23T06:21:19.960635Z`. No deployment was triggered.
- Immediately after the update, `/ready` returned HTTP 200 with
  `generatedAt: 2026-09-23T06:21:45.799Z` and `ready: true`. Launch control,
  database, Base root, Base RPC lag, verifier assets, and provider checks all
  passed. Authenticated `/v1/admin/status` returned HTTP 200: launch control
  was enabled with no incident reason, network was Base Sepolia, one root was
  known, the scan position was present, and root lag was 7 blocks. All exchange
  and claim counters remained zero. These results supersede the earlier stale
  local-loopback gate failure.
- The installed global `zk-credits` is version 0.1.3 from a different
  worktree. Its elevated, read-only status reports an identity configured, a
  Codex profile installed, and the sidecar stopped; that legacy identity does
  not establish that the pinned Base client is ready. The current Base
  worktree's sidecar status reports `Credential export: missing`,
  `Codex profile: installed`, and `Sidecar: stopped`. The current pinned client
  requires a local encrypted credential export, which is not configured in
  this trial environment. Do not use or copy the legacy identity material into
  the Base trial.
- The hosted readiness gate now passes, but neither exchange was run because
  the pinned client has no local encrypted credential export. No challenge,
  proof, payment signature, settlement, committed response, or payment
  response is recorded. Keep B22 open; do not close it or count either path
  until both independent protocol traces qualify. To resume, configure the
  encrypted export and password locally for the pinned client, then collect a
  fresh readiness/admin snapshot immediately before the exchanges.
