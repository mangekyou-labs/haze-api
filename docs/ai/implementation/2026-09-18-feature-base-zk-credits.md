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
treasury, verifying-key ids, Stripe, OpenRouter, and encryption settings
are server or local-proxy configuration. No private key, RPC credential,
proving secret, or credential secret belongs in the repository or a
browser server response.

Development WASM and zkey are installed out of band and hash-pinned in the
sidecar manifest. Hash mismatch is a proof failure.

## Implementation order

Follow planning B2→B3→B4 for the cryptographic spine, then B5→B6→B8 for
spend, then B9 for invite-only onboarding. B2, B3, B4, and the B9 onboarding
rewrite are done locally; B5/B6/B8 remain **present-unsafe** where the notes
above say so. Do not represent the restored circuit as privacy-preserving
while the rejected root fixtures are still present and the independent
cryptographic review is outstanding; the generated verifier and the adapter do
now carry Base Sepolia receipts (2026-09-21). Do not onboard paid partners
until planning B12 and founder B16 pass.
