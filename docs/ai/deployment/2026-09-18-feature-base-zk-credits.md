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

## B22 launch controls before invitations

The hosted deploy must satisfy these before any participant is invited. Each
is verifiable from the workflow and the live service; none requires a
participant.

1. The Render blueprint is non-sleeping: web `plan: starter`, Postgres
   `plan: basic-256mb`. A sleeping instance turns an invitee's first call into
   a cold-start failure. The blueprint carries no Stripe variable, and every
   secret is `sync: false` and set in the dashboard.
2. `GET /health` answers `200` and `GET /ready` answers `200` with every check
   `ok`. A `baseRpc: not_configured` or `baseRoot: not_synchronized` detail is
   a deployment defect, not a warning: without a synchronized root no proof can
   be accepted.
3. `GET /v1/admin/status` reports state `enabled`, the fixed caps
   `40000000` / `200000000` micro-USD, and zero spend.
4. The service class is enforced in the deployed build. `POST
   /v1/chat/completions` with `{"stream":true}`, a `models` fallback list, a
   `provider` routing object, an unknown field, `n: 2`, an output ceiling above
   4,000, an image content part, or a body over 256 KiB each returns `400` with
   the named code, and an OpenAI-compatible body whose `model` names another
   model still returns a `402` challenge.
5. Retired routes stay retired. The `Deploy Smoke` workflow probes 14 retired
   Stellar, evaluation, billing, and wallet-link paths, seven generic x402,
   `exact`, Bazaar, and MCP paths, the unauthenticated facilitator `settle`
   route, and the unsupported OpenAI and Anthropic paths, and asserts
   `/v1/responses` returns `400` with no `PAYMENT-REQUIRED` header.
6. Pause, verify, resume: `POST /v1/admin/pause` with a reason returns `200`
   and inference and funding return `503 pilot_paused` while `/health`,
   `/ready`, `/v1/contract-status`, and `/v1/admin/status` stay reachable; then
   `POST /v1/admin/resume` restores the `402` challenge. Do this once on
   production before invitations.
7. Cap exhaustion is exercised on a **staging** deployment with deliberately
   low limits, never by spending production budget. Production must report the
   fixed $40 and $200 limits from step 3.
8. Publish `@zk-credits/shared@0.1.0`, `@zk-credits/x402-zk-prepaid@0.1.0`,
   and the breaking Base sidecar `zk-credits@0.2.0`, then pin those exact
   versions in the onboarding guide. Deliver
   `private-credit-spend-bn254-dev-sepolia-v1` artifacts directly through the
   invite channel and require operators to verify the shipped manifest hashes
   before proving.

## B11 verifier and adapter broadcast (executed 2026-09-21)

B11 has to show a generated proof verified by the real Solidity verifier and
the `ISpendVerifier` adapter on Base Sepolia. That broadcast is the verifier
and the adapter only: no `PrivateCreditBond`, no USDC, no Poseidon libraries,
no mainnet, and no production ceremony. It ran on 2026-09-21 from commit
`9a596c3e7957` with the three deployed-from sources committed and clean at HEAD
(`PrivateCreditSpendVerifier.sol` `267649570b3ec684…`, `SpendVerifier.sol`
`36b2d15fa5c9b57c…`, `PrivateCreditSpendFixture.sol` `6960155a6b529ee6…`) and
with a dedicated keystore, so no private key was committed, exported, or
displayed.

| Contract | Address | Transaction | Block | Gas | Cost |
| --- | --- | --- | --- | --- | --- |
| `Groth16Verifier` | `0xC66CC4866f945Ce39c207729CF136fd03d58207E` | `0xa38ccbe4650027fc55a2f8459c62b15f94c54ba4243c193f6128b04d1a943183` | 47,096,589 | 445,789 | 0.00000267 ETH |
| `SpendVerifier` | `0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD` | `0x1832be22b0928ec7b3e340b006385ad7652faf91e1b45a62930db0da6b9557c8` | 47,096,600 | 386,525 | 0.00000232 ETH |

Both creations paid the 0.006 gwei effective price, 4,993,884,000,000 wei in
total, against a pinned 13,200,000 wei max fee and the 0.0001 ETH ceiling. The
verifier runtime bytecode hashes to the compiled artifact exactly
(`572b3914765f0531…`); the adapter differs only by its immutable `verifier()`
slot, which reads back `0xC66CC4866f945Ce39c207729CF136fd03d58207E`. BaseScan
verified both through the Etherscan V2 API (`Pass - Verified`, GUIDs
`zum2tr64kcer8zycbjteaubzdhapvumay51tj2yssdj5afybsk` and
`d4nbreimqlrgzsr4s4y5tzmacwb7qx9zwbhicpdnbxdl2a5hf7`). A generated proof then
verified through the deployed pair: `verifySpend` with the fixture transcript
returned `true` with root
`0x0d246a2afb766521d94437474ef6377058f7987bbe8a588005f37c8e3aa70831`,
timestamp `1797400000`, and domain `1234`, and the second transcript of the same
nullifier returned `true` as well. The timestamped evidence file for the run is
`/private/tmp/haze-b11-base-sepolia-evidence-20260921T032831Z.json`; the values
above are its durable copy in this document set.

### Reproducing the broadcast

Preconditions the run enforced before authorizing anything: chain ID `84532`
from the configured RPC, the three sources above tracked and clean at HEAD, a
green `forge build` plus the focused `SpendVerifierTest` suite (8 passed), a
signer balance covering the projection, and a projected cost no greater than
0.0001 ETH. The projection is `gas × pinned max fee`, so the pinned fee is also
the spend ceiling; a base fee above it stops the run instead of the wallet.

`forge create` in Foundry 1.5.1 has no `--dry-run`: omitting `--broadcast`
prints the projected transaction (gas, `maxFeePerGas`) and sends nothing, which
is how the projection is taken. `--constructor-args` is variadic and must be the
last flag, or it swallows the flags that follow it.

```bash
# from contracts/, with the keystore password in a 0600 file
forge create src/PrivateCreditSpendVerifier.sol:Groth16Verifier \
  --rpc-url https://sepolia.base.org --chain 84532 --broadcast \
  --keystore ~/.foundry/keystores/base-sepolia-zk-credits-deployer \
  --password-file ~/.config/haze/base-sepolia-zk-credits-deployer.password \
  --gas-price 13200000 --priority-gas-price 1000000 \
  --verify --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --retries 2 --delay 5

forge create src/SpendVerifier.sol:SpendVerifier \
  --rpc-url https://sepolia.base.org --chain 84532 --broadcast \
  --keystore ~/.foundry/keystores/base-sepolia-zk-credits-deployer \
  --password-file ~/.config/haze/base-sepolia-zk-credits-deployer.password \
  --gas-price 13200000 --priority-gas-price 1000000 \
  --verify --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --retries 2 --delay 5 \
  --constructor-args 0xC66CC4866f945Ce39c207729CF136fd03d58207E
```

`BASESCAN_API_KEY` must also be exported, because `contracts/foundry.toml`
interpolates `${BASESCAN_API_KEY}` whenever verification runs; the key is an
Etherscan V2 key. Let Foundry resolve the verifier URL itself: it appends its
own query parameters and needs the `chainid` baked into its default,
`https://api.etherscan.io/v2/api?chainid=84532`. A hand-written
`--verifier-url` loses that chain parameter, and the deprecated
`api-sepolia.basescan.org` V1 endpoint now answers with a migration error.
Verification failure never invalidates a successful creation: the receipt and
the bytecode are checked first, and explorer verification is retried separately
with `forge verify-contract`.

Receipts are recorded by calling the adapter with the fixture transcript from
`contracts/test/fixtures/PrivateCreditSpendFixture.sol`
(`COMMITMENT`, `SIGNAL_1`, `NULLIFIER`, `SHARE_1`, `PROOF_1`). Each decimal
constant is passed as a left-padded 32-byte word, because `cast` cannot parse a
76-digit decimal into `bytes32`:

```bash
cast call <adapter> \
  "verifySpend(bytes32,uint256,uint256,uint256,bytes)(bool,bytes32,uint256,bytes32)" \
  <commitment> <signal> <nullifier> <share> 0x<proof> --rpc-url https://sepolia.base.org
```

The call must return `true` with the fixture's `ROOT`, `TIMESTAMP`, and
`DOMAIN`. The addresses, transaction hashes, block numbers, gas, and that return
value are recorded in the testing document.

No builder-code attribution is configured in this repository; ERC-8021 applies
to wallet and app transaction paths, not to a one-off `forge create`.

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
