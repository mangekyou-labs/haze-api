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
- `contracts/src/PrivateCreditBond.sol`: immutable Base escrow and tree.
  Target: one funded tier; `_recoverSecret` under the restored algebra.
  Current source still has `TIER_COUNT = 3` and the old recovery.
- `packages/zk-credits-shared`: browser/Node crypto, canonical requests,
  encrypted credentials. B2 restored the slot-blinding statement, BN254
  field-range rejection, and the RFC 8785 length-prefixed request signal in
  `src/base.ts`; `src/index.ts` exports only the Base surface.
- `packages/x402-zk-prepaid`: custom x402 v2 `zk-prepaid` codecs and
  adapters. Core `amount`/`asset` name the credit asset
  `coding-deepseek-v4-flash-v1`. `extra.issuedAt` is gateway-issued unix
  seconds. The bond address lives in `extra.contract`.
- `ts/zk-prepaid-gateway.ts`, `ts/claim-store.ts`, `ts/response-replay.ts`,
  `ts/stripe-billing.ts`: isolated claim store, facilitator, gateway
  middleware, buffered replay, durable billing jobs.
- `packages/zk-credits-sidecar`: operator-local credential, hash-pinned
  WASM/zkey, Groth16 `fullProve` plus self-verify, x402 client, replay.
- `web`: Stripe and Base-aware account/dashboard. No remaining-credit or
  usage history.
- `archive/stellar` plus historical evaluation migrations: reference only.

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
spend, then B7/B9 for checkout. B2 and B3 are done locally; B4 is next. Do
not represent the restored circuit as privacy-preserving while the rejected
root fixtures are still present and no generated Solidity verifier has been
proven end to end. Do not onboard paid partners until planning B12 and
founder B16 pass.
