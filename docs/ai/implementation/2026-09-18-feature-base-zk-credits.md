---
phase: implementation
title: Base private API credits implementation notes
description: Source layout, invariants, and rewrite rules for the paid Base Sepolia pilot
---

# Base private API credits implementation notes

Date: 2026-09-20  
Status: approved 2026-09-20 on
[Review the reconciled pilot design and implementation plan](../../wayfinder/base-zk-credits-pilot/tickets/05-reconcile-pilot-docs.md).

Sources listed below that are still marked **present-unsafe** must be
rewritten against the frozen design. Do not add paid-traffic features on
the rejected share equation.

## Source layout

- `circuits/private_credit_spend.circom`: Circom 2 BN254 spend, restored and
  compiled. `slotBlinding = Poseidon(secret, slot, domain)` private;
  `nullifier = Poseidon(slotBlinding)`;
  `share = secret + slotBlinding * requestSignal`;
  public ABI `[root, timestamp, domain, requestSignal, nullifier, share]`;
  funded allowance 250; 48 private inputs. Compile with
  `circuits/scripts/compile-private-credit.js` into
  `circuits/build/private-credit/` under Circom 2.2.2. The Circom 0.5
  artifacts at `circuits/private_credit_spend.{r1cs,wasm,sym}` are negative
  fixtures for the rejected equation and are never overwritten.
- `contracts/src/PrivateCreditBond.sol`: immutable Base escrow and tree, one
  funded tier. `FUNDED_TIER_ID` 0 with in-circuit allowance 250 and
  refundable bond `20_000_000` ($20 at six decimals); every other `tierId`
  reverts `InvalidTier`. Slash recovers slot blinding as
  `(share1 - share2) / (signal1 - signal2)`, then secret as
  `share1 - slotBlinding * signal1`, and requires
  `Poseidon(slotBlinding) == nullifier` and `Poseidon(secret) == commitment`.
  It rejects equal signals, zero signals, a zero nullifier, a zero recovered
  slot blinding or secret, and out-of-range field elements. `releaseBond` is
  permissionless at expiry plus seven days and pays the refund vault. Leaves
  stay `Poseidon(commitment, tier_id, expiry)` over a depth-20 append-only
  tree with historical roots retained. The spend verifier is
  `contracts/src/SpendVerifier.sol`, an `ISpendVerifier` adapter over the
  generated `contracts/src/PrivateCreditSpendVerifier.sol`; `MockSpendVerifier`
  and the keccak Poseidon stand-ins remain only for narrow bond-accounting
  unit tests.
- `packages/zk-credits-shared`: browser/Node crypto, canonical requests,
  encrypted credentials. B2 restored the slot-blinding statement, BN254
  field-range rejection, and the RFC 8785 length-prefixed request signal in
  `src/base.ts`; `src/index.ts` exports only the Base surface.
- `packages/x402-zk-prepaid`: custom x402 v2 `zk-prepaid` codecs and
  adapters. Core `amount`/`asset` name the credit asset
  `coding-deepseek-v4-flash-v1`. `extra.issuedAt` is gateway-issued unix
  seconds. The bond address lives in `extra.contract`.
- `ts/zk-prepaid-gateway.ts`, `ts/claim-store.ts`, `ts/response-replay.ts`: isolated claim
  store, facilitator, gateway middleware, buffered replay. The pilot routes
  (`/v1/pilot/invites/redeem`, `/v1/pilot/funding`, `/v1/pilot/bundles/:commitment`)
  are mounted here and fail closed with 503 when no pilot store is injected.
- `ts/pilot-invites.ts`, `ts/pilot-funding.ts`, `ts/pilot-admin.ts`: control-plane
  invites, detached provisioning capabilities, and the founder CLI. The two plane
  modules never import each other; redemption crosses the boundary through an
  issuer that takes no arguments.
- `packages/zk-credits-sidecar`: operator-local credential, hash-pinned
  proving bundle, Groth16 `fullProve` plus self-verify, x402 client, replay. It
  accepts version-2 activated credentials and legacy version-1 exports.
- `web`: invite-only unpaid onboarding. Five-step state machine on `/dashboard`
  (invite, capsule, re-import, funding, activated), local-only recovery, sanitized
  Base Sepolia status. No checkout, order, webhook, wallet-link, or Stripe code.
- `archive/stellar` plus historical evaluation migrations: reference only.
- `scripts/launch-pilot.sh` plus `ts/launch-pilot.ts` and `ts/launch/`: the
  resumable launch system. `ts/launch/cli.ts` holds the ordered plan and the
  runner, `state.ts` the checkpoint file and its secret-free boundary, and
  `environment.ts`, `providers.ts`, `release.ts`, `deploy.ts`, and `redact.ts`
  the validation, provider reconciliation, publish sequencing, broadcast
  reconciliation, and output redaction. `ts/launch/rewrite-sidecar-deps.ts` is
  the one point where the sidecar stops being buildable from the checkout alone.
- `scripts/launch-guardrails.sh`, `scripts/launch-wizard.sh`,
  `scripts/operator-wizard.sh`, and `scripts/operator-evidence.mjs`: the shared
  secret boundary, the two human wizards, and the operator-side counter
  measurement and local checks. `scripts/guardrails.test.sh` and
  `scripts/operator-evidence.test.mjs` cover them without a TypeScript
  toolchain, because the operator machine has none.

## Invite-only unpaid onboarding (B9)

Migration `ts/db/migrations/0015_pilot_invites.sql` adds two deliberately
unjoinable schemas. `control_plane.pilot_invites` holds a SHA-256 code digest,
the invited GitHub account id, expiry, redemption, and revocation state, and
no commitment or funding token. `pilot_provisioning.funding_capabilities`
holds a SHA-256 token digest, capability expiry, funding state, the commitment
bound on the first attempt, the authoritative bundle expiry, and the funding
transaction, and no account, invite, or session identifier.

Codes and capabilities are 32 random bytes (base64url) shown once; invites
default to seven days and capabilities to 30 minutes with a two-minute attempt
lease. Redemption requires a matching GitHub account, is claimed with a single
conditional `UPDATE`, and mints the capability through an issuer that receives
no identity. Funding binds one commitment permanently: retries return the
stored result, reuse with another commitment is `funding_commitment_conflict`,
and a failed sponsorship stays retryable for the same commitment.

The browser export is two-stage. The version-2 recovery capsule encrypts only
`{ version: 2, secret }` and must be re-imported successfully before funding;
after funding the unchanged capsule is wrapped with the gateway's authoritative
tier, expiry, deployment domain, network, contract, and transaction hash, then
verified locally against the secret. Version-1 exports remain readable by the
recovery page and the sidecar.

Removed from the deployed pilot path: `POST /api/checkout`,
`GET /api/orders/:orderId`, `POST /api/webhooks/stripe`,
`GET|POST /api/wallet/link`, `POST /v1/billing/orders`,
`GET /v1/billing/orders/:orderId`, `POST /v1/billing/stripe-event`, and
`POST /v1/accounts/wallet-link`. The Stripe npm packages, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, and the Stripe refund adapter are gone from the active
tree. Base event synchronization still feeds proof roots and no longer calls
order reconciliation.

## Non-negotiable invariants

- Validate BN254 field range before proof verification.
- Canonicalize JSON without floating-point ambiguity. Hash the bytes
  actually sent.
- Public timestamp equals gateway `issuedAt` and must lie in
  `[now - 300s, now + 5s]`. Reject a client-chosen timestamp.
- Reserve a nullifier atomically before any upstream dispatch. Only a
  committed reservation consumes a slot. Commit only after a fully
  buffered, structurally valid provider 2xx within 1 MiB.
- Streaming is not implemented. Reject `stream: true` and stream-shaped
  bodies before reserve.
- A proof failure (prove miss, 10s abort, artifact hash mismatch, failed
  self-verify) inserts no claim row, cancels nothing, slashes nothing, and
  leaves the slot unused.
- Exact retry of a committed claim returns the 24h encrypted replay. That
  ciphertext is not slash evidence. First-transcript evidence is retained
  until expiry plus seven days, capped at 250 per bundle.
- At most two upstream dispatches per nullifier. No model fallback.
- Reject unknown or identifying x402 payload fields. Omit `payer`.
  `PAYMENT-RESPONSE.transaction` is empty.
- Contract external calls follow checks-effects-interactions and
  `SafeERC20`.
- Sidecar computes Merkle paths from public tree data. Gateway never
  serves a path for a named leaf or commitment. Control plane never serves
  proving keys at runtime.
- One `fullProve` at a time per sidecar process.

## Sidecar proving boundary (B8)

`ZK_CREDITS_ARTIFACT_DIR` points at the installed frozen bundle;
`packages/zk-credits-sidecar/circuits/manifest.json` pins the SHA-256 of the
WASM, zkey, and verification key. Resolution rejects a missing, remote,
relative, symlink-escaping, or hash-mismatched artifact before the first
`fullProve`. Failure categories are fixed and aggregate-only.

- `src/proof-coordinator.ts` serializes proves process-wide, runs each attempt
  in a terminable child process with a 10-second deadline, self-verifies with
  the pinned key, and requires the six public signals to match
  `[root, timestamp, domain, requestSignal, nullifier, share]` exactly. The
  worker boundary is a child process, not `worker_threads`: snarkjs's
  `web-worker` polyfill cannot create nested workers, so a `worker_threads`
  prover hangs. Retries reuse the same slot, request signal, nonce, response
  key, and gateway `issuedAt` while more than ten seconds remain.
- `src/slot-ledger.ts` holds the durable local slot ledger
  (`$ZK_CREDITS_HOME/base-slots.json`, slot numbers only). A slot is
  provisional until self-verification succeeds and is committed immediately
  before `PAYMENT-SIGNATURE` can be emitted; proof misses, timeouts, hash
  failures, and verification failures release it.
- `src/sidecar.ts` serves only `GET /health`, `GET /v1/models`,
  `GET /metrics`, and non-streaming `POST /v1/chat/completions`.
  `/v1/responses`, Anthropic `/v1/messages`, streaming bodies, and a missing
  `model` are rejected before any prove; there is no model fallback and no
  Anthropic translation.
- `GET /metrics` requires the loopback token and returns attempt counts, fixed
  failure categories, and hot-prove p50/p95 only. No proofs, signals,
  nullifiers, credentials, requests, or identifying labels.
- `createFileWitnessProvider` accepts a prepared witness or a public tree
  artifact and derives the depth-20 path locally. No gateway endpoint serves a
  path for a named leaf or commitment.

## Spend verifier and real-proof fixtures (B11)

`contracts/src/PrivateCreditSpendVerifier.sol` is the unmodified snarkjs
export of the development zkey pinned by the sidecar manifest (zkey sha256
`3afb378d832d646a7d207b7eecbbd33cf3b041b99274cb074bbe314ac0b79291`). It reads
exactly six public signals in the canonical order and is never hand-edited;
regenerate it with
`snarkjs zkey export solidityverifier <zkey> PrivateCreditSpendVerifier.sol`.

`contracts/src/SpendVerifier.sol` implements `ISpendVerifier` over that
verifier. Its `proof` payload is the snarkjs `soliditycalldata` word list: the
eight Groth16 point words with each `pi_b` Fp2 pair swapped relative to the
proof JSON, then `[root, timestamp, domain, requestSignal, nullifier, share]`.
The adapter passes those six words to the generated verifier unchanged and
binds the caller's `signal`, `nullifier`, and `share` to their canonical
positions, so a reordered, altered, or truncated payload cannot verify.
`commitment` is not a circuit public input; the bond binds it through
two-transcript recovery.

`contracts/scripts/generate-spend-fixtures.mjs` regenerates
`contracts/test/fixtures/PrivateCreditSpendFixture.sol` from the frozen
bundle. It refuses any artifact whose digest does not match the manifest and
checks its payload layout against `groth16.exportSolidityCallData`, so the
Foundry suites cannot drift from the shipped bundle or from snarkjs. Foundry
deploys the real Poseidon T2/T3/T4 libraries on that path and reproduces the
circuit root, the circomlibjs literals, and the mocked-free slash recovery.

The gateway accepts a challenge while its `issuedAt` stays inside
`[now - 300s, now + 5s]`, and the real Groth16 verifier reads the same
`issuedAtInWindow` helper, so the off-chain prover cannot accept a timestamp
the resource server would reject. Token-issuance `expiry` is not known to the
gateway; the circuit and the bond enforce `timestamp < expiry`.

Deployment for this ticket is the verifier and the adapter only. The bond,
USDC escrow, and Poseidon libraries are not part of the B11 broadcast. That
broadcast ran on 2026-09-21 from commit `9a596c3e7957`: `Groth16Verifier` at
`0xC66CC4866f945Ce39c207729CF136fd03d58207E` (block 47,096,589, runtime bytecode
identical to the compiled artifact) and `SpendVerifier` at
`0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD` (block 47,096,600, immutable
`verifier()` reading back the verifier address). Both are BaseScan-verified and
the fixture transcript verifies through the deployed pair. The exact commands,
the pinned 13,200,000 wei max fee, and the preconditions that authorized the
broadcast are in the
[deployment document](../deployment/2026-09-18-feature-base-zk-credits.md); the
recorded addresses, transactions, and proof output are in the
[testing document](../testing/2026-09-18-feature-base-zk-credits.md#base-sepolia-b11-evidence-2026-09-21).

One calling detail the broadcast exposed: `cast` cannot parse the fixture's
76-digit decimals into `bytes32`, so a receipt call passes each public signal as
a left-padded 32-byte word. The verifier still receives the six words in
canonical order, which is what the adapter's positional checks rely on.

## Error and logging policy

Return safe x402 challenge/validation errors without exposing proof
internals. Structured logs may contain operation IDs, result categories,
and durations. They must never contain request bodies, response bodies,
secrets, proofs, wallet addresses, commitments, orders, nullifiers, or
request signals.

Provider failures after reserve and before commit cancel the reservation
and consume no credit. Provider work may have started; not charging is the
accepted cost of escrow. Failures after a durable commit consume the
credit, including client disconnect. A proof failure is not a provider
failure and never enters the claim machine.

## Configuration

Base chain ID `84532`, RPC URL, contract, USDC, sponsor, refund vault,
treasury, verifying-key ids, OpenRouter, and encryption settings are server
or local-proxy configuration. No private key, RPC credential, proving secret,
or credential secret belongs in the repository or a browser server response.

Development WASM and zkey are installed out of band and hash-pinned in the
sidecar manifest. Hash mismatch is a proof failure.

The single service class, the price ceilings, the request limits, the
per-dispatch spend ceiling, and the pilot spend caps are **not** environment
configuration. They are fixed in source (`ts/service-class.ts` and
`ts/launch-control.ts`) so no deployment can widen an approved economic
boundary without a reviewed code change.

## Service-class enforcement (B22)

`ts/service-class.ts` is the only path a request takes to the provider. Every
accepted body is rebuilt into the exact upstream envelope, and everything
outside the class is rejected before a credit is reserved:

- the model is forced server-side; a client `model` field is ignored and
  never forwarded, so an OpenAI-compatible client cannot select another model;
- streaming, model fallback lists, client routing, transforms, plugins, web
  search, media, audio, non-function tools, legacy `functions`, reasoning
  controls, service tiers, and any unknown field are refused by name;
- the parser caps the body at 256 KiB, the counter caps input at 16,000 UTF-8
  bytes of text and tool payload, and output is capped at 4,000 tokens;
- every dispatch carries `provider.max_price` of $0.90 per million input and
  $1.80 per million output tokens with `allow_fallbacks: false` and
  `require_parameters: true`, and the upstream timeout is 120 seconds.

The input ceiling counts UTF-8 bytes rather than model tokens: the gateway
cannot run the provider tokenizer before reserving a credit, and a byte-level
BPE never emits more than one token per byte, so an accepted body of at most
16,000 UTF-8 bytes always holds at most 16,000 real tokens. The counter is
deliberately stricter than the provider's own count and can never under-count.

## Launch controls (B22)

`ts/launch-control.ts` holds two durable controls in Postgres, both decided
inside one serialized transaction so concurrent dispatches cannot race them:

- a single `enabled` / `paused` kill switch in `control_plane.launch_control`,
  and
- an unlinked integer micro-USD debit ledger in
  `spend_plane.dispatch_debits`.

A dispatch debits the conservative $0.025 class ceiling before the request can
leave the process. The debit is **retained** once a dispatch promise exists,
including provider errors and timeouts, and **released** only when the failure
happened before the network call. If either the $40 per UTC day or the $200
rolling 30-day cap would be exceeded, the debit is refused, the reservation is
cancelled without consuming a credit, a retryable `503` is returned, and the
exhausted cap **persists a paused launch state** for operator review.

The ledger is unlinked by construction: its only identifier is its own
sequence value. No credential, nullifier, request signal, provider generation
id, or participant identity appears in a control or monitoring table, so those
reads can never be joined back to a spend-plane claim.

The kill switch blocks invite redemption, detached funding, and new inference.
It preserves `/health`, `/ready`, `/v1/contract-status`, the public bundle
lookup, the committed-claim replay, and the authenticated admin commands, so
recovery stays reachable during an incident.

## Resumable launch system (B22)

The launch crosses three irreversible boundaries — three npm publishes, a
contract broadcast, and three operator activations — so its tooling is built so
that an interruption anywhere is recoverable and nothing is ever repeated
blindly.

`scripts/launch-pilot.sh` is the single entrypoint and `ts/launch/cli.ts` is the
state machine behind it. The shell layer resolves the protected founder env file
and refuses a shell that already carries an operator variable; ordering,
checkpoints, and reconciliation live in TypeScript where they are covered by
tests. The modes are `--check` (read-only preflight over credentials, git,
packages, the chain, and the providers), `--status` (read-only reconciliation of
local checkpoints against the providers), and no argument (start or resume).
There is no unattended confirmation flag and no flag that deletes a resource.

The plan is 26 ordered steps across the plan's stages. Six are irreversible and
every one of those stops and asks.

`.launch-state.local.json` is the launch's memory and nothing else: for each step
a status, a timestamp, and secret-free detail. Two properties make it
trustworthy. It refuses to persist anything secret-shaped, so it can be read,
diffed, and pasted safely, and it has an `unknown` status distinct from
`failed`. `unknown` is what a non-idempotent call that timed out becomes, and an
unresolved `unknown` stops the run until reconciliation resolves it — the whole
point being that a timed-out broadcast or publish may already have happened.

`ts/launch/environment.ts` holds the protected founder environment. Requirements
are staged, so a preflight before the npm release does not demand a Vercel token
that cannot exist yet, and the GitHub OAuth pair is deferred until the deployed
web host has produced the real callback URL. Custody keys and operator secrets
are refused outright rather than ignored: the launch holds addresses and a
bounded hot sponsor key, never custody. The three operator GitHub ids must be
numeric and pairwise distinct, so a slot cannot be double-counted.

`ts/launch/providers.ts` makes a retry safe. Every external resource is created
under a deterministic name, and an exact-name lookup decides the outcome: none
means create, exactly one means adopt after verifying the configuration matches
the intent, and several means stop and list them, because choosing between two
real resources is not a decision a script may make. A transport timeout is
reported as a timeout rather than a failure, which is what lets the runner
record `unknown` instead of retrying blind.

`ts/launch/release.ts` encodes the publish order as checks. The sidecar's runtime
dependencies are checkout-local `file:` paths, so it cannot install from the
registry until the two leaves are public; the rewrite to exact versions, the
lockfile regeneration, the tarball install, and the dependency-only commit are
steps *between* the two publish groups rather than part of either. An existing
registry version whose packed contents differ from this checkout stops the
release rather than being overwritten.

`ts/launch/deploy.ts` writes the deployment intent down before an operator can
broadcast it — the signer, starting/contract nonce, and each CREATE address
that pair implies — so a resumed run compares against predictions instead of
log lines. `scripts/launch-wizard.sh` is configuration-only: it collects the
Base Sepolia RPC/domain, official USDC default, Foundry keystore/password-file
path, sponsor key, role addresses, reviewed adapter, and optional BaseScan key;
bond address and deployment block are launcher outputs. The password file must
be regular, non-symlinked, and mode `0600`, and neither it nor private key
material is printed.

The Solidity entrypoint deploys Poseidon T2, T3, T4, then
`PrivateCreditBond`, reading launch-native environment names and decimal
domain `84532`. The launcher derives the keystore signer and sponsor address,
checks chain/balance/nonce, USDC bytecode/decimals, role distinctness, and the
reviewed adapter's underlying verifier, then runs a no-broadcast simulation.
It asks for fresh human authorization before displaying the dotenv-wrapped
keystore command; it never runs that command. Artifact resume requires all four
CREATEs to match signer, nonce, order, predicted address, chain, successful
receipt, and deployed bytecode. Ambiguous partial, reverted, reordered,
missing, or unreadable results stay `unknown` and expose only a guarded
`forge script --resume` command after another confirmation. Post-deploy checks
cover all nine bond immutables and the initial commitment root, after which
outputs are atomically persisted. Explorer verification is independent and
retryable, and the runtime sponsor's USDC approval remains bounded to 80 test
USDC.

### Base Sepolia launch repair evidence (2026-09-22)

The repair is intentionally stopped before a live bond broadcast. Wayfinder
B22 remains open until the three founder activations and observation period
complete. The implementation and tests cover wizard ordering and output-only
bond fields, secret redaction, password-file permissions, environment
validation, four-contract order and constructor wiring, Foundry artifact
parsing, nonce drift, partial/resumed broadcasts, reverted receipts, missing
bytecode, immutable/root mismatches, and verification-only retries.

### Activation measurement

`ts/activation-evidence.ts` schema version 2 replaces the single cumulative
exchange and proving totals with three snapshots of the operator sidecar's
authenticated loopback counters: before the discarded warm-up, after it, and
after the counted exchange. Every exchange counter, proving counter, and failure
category is derived as a delta between two of them.

A cumulative total cannot distinguish a warm-up from an activation, which is why
qualification now requires a fresh sidecar, exactly one successful cold warm-up
before the baseline, and exactly one successful counted exchange after it. The
hot-prove sample count separates the two windows: the first prove in a process
is the cold sample, so a clean warm-up leaves it at zero and the counted
exchange raises it to one. Contaminated evidence still records as a failure, but
it cannot qualify, and the reason names the contamination.

`activation-rehearse` runs the founder half of the sequence with no slot and no
invite, so the orchestration is proved against a real deployment without
consuming one of the three operator slots. It refuses while any window is open,
because extra traffic during a window contaminates that slot's counters, and the
committed-claim comparison is between two aggregate integers that cannot on
their own tell one operator's traffic from another's.

## Staging-only caps

The spend caps are the pilot's economic promise, so they are frozen constants
and nothing in the environment can widen them. The one exception exists so the
cap-exhaustion path can be exercised without spending real budget:
`PILOT_ENVIRONMENT=staging` plus `PILOT_STAGING_DAILY_CAP_MICRO_USD` and
`PILOT_STAGING_ROLLING_CAP_MICRO_USD` in `ts/launch-environment.ts`.

The seam is narrow by construction. The overrides are read only when the
environment is exactly `staging`; they may only narrow the fixed ceiling; and a
deployment that is not staging **refuses to start** when either one is present
rather than ignoring it, so a production service cannot run on a staging cap.
The effective pair is reported by `/v1/admin/status`, which is how production is
confirmed to hold `40000000` / `200000000` micro-USD and staging is confirmed to
hold the narrowed pair.

## Monitoring surface (B22)

- `GET /health` is liveness only and never depends on a downstream dependency.
- `GET /ready` covers Postgres, Base root freshness and lag, verifier assets,
  provider configuration, and the launch-control state. It reports `503` when
  any check fails, and each check reports one fixed, privacy-safe detail string
  that never echoes a connection string, RPC error body, or root value.
- `GET /v1/admin/status` is authenticated with `BILLING_INTERNAL_TOKEN` and
  returns bounded aggregate counters, conservative spend and headroom for both
  windows, durable claim-state counts, Base lag, and the launch state.
  Proving happens only inside an operator's sidecar, so the gateway reports
  `provingLatency: { source: 'participant-reported', value: null }` rather than
  deriving a latency it never observes.

## Implementation order

Follow planning B2→B3→B4 for the cryptographic spine, then B5→B6→B8 for
spend, then B9 for invite-only onboarding, then B22 for the launch controls
above. B2, B3, B4, the B9 onboarding rewrite, and the B22 controls are done
locally; B5/B6/B8 remain **present-unsafe** where the notes above say so. Do
not represent the restored circuit as privacy-preserving while the rejected
root fixtures are still present and the independent cryptographic review is
outstanding; the generated verifier and the adapter do now carry Base Sepolia
receipts (2026-09-21). Do not onboard paid partners until planning B12 and
founder B16 pass.
