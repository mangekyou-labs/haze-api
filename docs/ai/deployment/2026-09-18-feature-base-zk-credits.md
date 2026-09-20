---
phase: deployment
title: Base private API credits deployment strategy
description: Base Sepolia-first deployment, paid-traffic gates, and blocked mainnet
---

# Base private API credits deployment strategy

Date: 2026-09-20  
Status: approved 2026-09-20 on
[Review the reconciled pilot design and implementation plan](../../wayfinder/base-zk-credits-pilot/tickets/05-reconcile-pilot-docs.md).

## Environments

Local and CI use deterministic mocks and must not claim unlinkability.
Staging deploys the immutable contract to Base Sepolia (`eip155:84532`,
chain ID `84532`) with development proving material after the circuit
rewrite. Paid design-partner traffic waits on the paid-traffic gate
(planning B12) and a passing founder proof-latency dry-run (B16).

Base mainnet and a production proving ceremony are a later go/no-go map.
They are not an automatic promotion from Sepolia.

## Local and CI

1. Run `npx ai-devkit@latest lint --feature base-zk-credits` and
   `npx ai-devkit@latest lint`.
2. Package typecheck and tests, Foundry, circuit compile plus R1CS
   inspection (6 public / 48 private), web build, `git diff --check`.
3. Confirm replay cap 1 MiB, no streaming handlers, and `issuedAt` window
   tests are green.
4. Do not broadcast.

## Sepolia checklist (unpaid)

1. Run the complete local verification matrix and database migrations
   twice.
2. Configure a Foundry keystore, sponsor ETH, Base Sepolia USDC, dedicated
   HTTPS RPC, immutable constructor addresses (USDC, sponsor, refund
   vault, treasury, verifier, Poseidon, deployment domain), circuit and
   verifying-key identifiers, and a BaseScan verification record. Never
   commit keys or put RPC credentials in the browser.
3. Deploy once; record chain ID, bytecode hash, constructor arguments, and
   addresses in an environment manifest. Validate every address and chain
   ID `84532` before jobs start.
4. Pin development WASM/zkey hashes in the sidecar manifest. Control plane
   must not serve proving keys.
5. Founder unpaid dry-run: discard one cold start, 20 hot prove+self-verify
   cycles, p95 ≤ 2.0s on a normal laptop, nothing submitted to the live
   gateway.
6. Smoke: sponsored funding through `POST /v1/pilot/funding`, buffered
   (non-stream) Chat Completions, exact-retry replay, provider failure,
   abandoned reservation, and proof-failure non-claim. Real checkout is not a
   pilot smoke: `/api/checkout`, `/api/webhooks/stripe`, `/api/orders/:id`,
   `/api/wallet/link`, `/v1/billing/orders`, `/v1/billing/orders/:id`,
   `/v1/billing/stripe-event`, and `/v1/accounts/wallet-link` must all return
   404, and `/sign-in`, `/onboarding`, and `/recover` must render no checkout
   or payment action. The `Deploy Smoke` workflow asserts both, plus that
   anonymous `/dashboard` access is gated and that the pilot funding and
   bundle routes are mounted. Those probes were verified locally against a
   booted gateway and `next start` on 2026-09-20; the hosted run is still
   outstanding.
7. Enable durable workers and alerts only after reconciliation passes.

## B11 verifier and adapter broadcast (pending authorization)

B11 has to show a generated proof verified by the real Solidity verifier and
the `ISpendVerifier` adapter on Base Sepolia. That broadcast is the verifier
and the adapter only: no `PrivateCreditBond`, no USDC, no Poseidon libraries,
no mainnet, and no production ceremony. It has not been authorized or run, so
there is no receipt.

Prerequisites: a Foundry keystore funded on Base Sepolia (`cast wallet import`;
never a committed key or `.env`), an HTTPS RPC (`https://sepolia.base.org` or
`BASE_SEPOLIA_RPC_URL`), and a BaseScan API key for `--verify`. At the
measured 0.006 gwei base fee the two creations cost about 841,000 gas in total
(verifier ~450,500, adapter ~390,800), roughly 0.000005 ETH, so one CDP faucet
claim of 0.0001 ETH covers them. No builder-code attribution is configured in
this repository; ERC-8021 applies to wallet and app transaction paths, not to
a one-off `forge create`.

From `contracts/`, each command prompts for the keystore password:

```bash
forge create src/PrivateCreditSpendVerifier.sol:Groth16Verifier \
  --rpc-url https://sepolia.base.org --account <keystore> --verify
forge create src/SpendVerifier.sol:SpendVerifier \
  --rpc-url https://sepolia.base.org --account <keystore> --verify \
  --constructor-args <verifier address>
```

Then record the receipt by calling the adapter with the fixture transcript from
`contracts/test/fixtures/PrivateCreditSpendFixture.sol`
(`COMMITMENT`, `SIGNAL_1`, `NULLIFIER`, `SHARE_1`, `PROOF_1`):

```bash
cast call <adapter> \
  "verifySpend(bytes32,uint256,uint256,uint256,bytes)(bool,bytes32,uint256,bytes32)" \
  <commitment> <signal> <nullifier> <share> 0x<proof> --rpc-url https://sepolia.base.org
```

The call must return `true` with the fixture's `ROOT`, `TIMESTAMP`, and
`DOMAIN`. Persist the addresses, transaction hashes, block numbers, and that
return value in the testing document. A local fork test against those
addresses is optional.

## Paid-traffic gate (before design partners)

Do not onboard paid partners or claim unlinkability until all of:

- written independent cryptographic review of the restored statement and
  implemented artifacts;
- R1CS inspection of 6 public / 48 private;
- the negative-test set in the testing document;
- an end-to-end generated proof verified by the real Solidity verifier and
  adapter on Base Sepolia;
- two-transcript recovery that slashes;
- founder B16 pass.

Then at most three live-SKU partners. Each partner writes an accepted
proving latency (p95, not looser than 3.0s) and passes a local unpaid
20-sample dry-run on their sidecar host before the first paid claim. Fail
the cap means not activated. No lab substitution, remote prove, or
loosened cap.

## Partner activation

Activation is paid live SKU ($20 service + $20 bond), sidecar on their
machine, at least one real call, secret never handled by the team. Two
agents are not required at activation. Continuation evidence is defined in
requirements and planning B13.

## Rollback

The contract is immutable. Disable new Stripe purchases and sponsorship,
drain and reconcile pending jobs, preserve historical rows, and route
existing credentials to a safe error while support handles active bundles.
Never erase spend or billing records. Never claim a rollback can undo a
funded chain state.

Pause new checkout when OpenRouter is unavailable, when no eligible route
fits the price ceilings, or when the $40/UTC day or $200/30d provider-spend
cap is hit.

## Mainnet

Blocked. A later map must add a trust-minimized user refund path, an
independent audit, a production ceremony, and key-loss / USDC-freeze /
sequencer / RPC / facilitator recovery procedures.
