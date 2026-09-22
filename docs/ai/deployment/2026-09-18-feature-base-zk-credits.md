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

## Base Sepolia launch wizard repair (2026-09-22)

The repaired wizard is configuration-only. Before it asks for provider or
hosting setup it records the dedicated RPC, deployment domain `84532`, default
USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, Foundry keystore account,
an absolute regular non-symlinked password file with mode `0600`, sponsor hot
key, treasury, refund vault, the reviewed adapter
`0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD`, and an optional BaseScan key.
Bond address and deployment-block prompts are removed. The wizard never prints
the password or a private key.

The launch-native environment names are `BASE_RPC_URL`,
`BASE_DEPLOYMENT_DOMAIN`, `BASE_USDC_ADDRESS`,
`BASE_DEPLOYER_KEYSTORE_ACCOUNT`, `BASE_DEPLOYER_PASSWORD_FILE`,
`BASE_SPONSOR_PRIVATE_KEY`, `BASE_TREASURY_ADDRESS`,
`BASE_REFUND_VAULT`, and `BASE_SPEND_VERIFIER_ADDRESS`. The launcher derives
`BASE_SPONSOR_ADDRESS`; it never passes the sponsor private key as an address.
The Solidity script reads those names directly and deploys, in order, Poseidon
T2, Poseidon T3, Poseidon T4, and `PrivateCreditBond`, wiring the bond to the
adapter whose `verifier()` must be
`0xC66CC4866f945Ce39c207729CF136fd03d58207E`.

`launch-pilot` performs read-only chain and keystore checks, runs the Foundry
simulation without `--broadcast`, persists scalar deployment intent, prints a
nonsecret input/prediction summary, and waits for fresh human authorization
before exposing the operator's dotenv-wrapped keystore command. The launcher
does not run that command. On resume it parses `run-latest.json` and reconciles
all four CREATEs against the intended signer, nonce, order, predicted address,
receipt, chain, and bytecode. Ambiguous partial/reverted/reordered/missing or
unreadable results stay `unknown` and block blind retry; verification is an
independent retryable step that never redeploys. Only after all nine bond
immutables and the initial commitment root match are the four addresses, bond
deployment block, sponsor address, and `BASE_CONFIRMATIONS=3` atomically
written. Hosting, GitHub-variable, and activation stages follow that output
boundary.

Validation for this repair is recorded in the implementation/testing lifecycle
documents and includes shell guardrails, TypeScript typecheck and tests,
offline Foundry build/tests, and a dry `launch-pilot --check`. No live bond
broadcast is part of this repair. Wayfinder B22 remains open until the three
founder activations and the observation period are complete.

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

1. The Render blueprint runs the free web plan in Singapore and declares no
   Render database: the durable Postgres is an external free Neon database
   reached over its **direct** TLS connection (never the `-pooler` host), so
   `DATABASE_URL` is set in the dashboard and no `fromDatabase` interpolation
   appears. A free instance suspends, so cold starts are accepted explicitly
   rather than paid away: `npm run activation:start` prewarms `/health` with
   bounded retries and then requires a fully ready `/ready` **before** it
   issues an invite, so an operator never meets a suspended instance, and the
   `Deploy Smoke` workflow retries every positive probe. The blueprint carries
   no Stripe variable, and every secret is `sync: false` and set in the
   dashboard.
2. The Base RPC is a dedicated provider endpoint, not the shared public
   `sepolia.base.org`, and `BASE_DEPLOYMENT_BLOCK` is set to the block the bond
   was deployed at. Deploy Smoke asserts `/v1/admin/status` reports a
   `base.lastScannedBlock` at or after that value; scanning less means no
   `BundleFunded` event can be observed yet, and an unset value either rescans
   the whole chain history or misses every event.
3. `GET /health` answers `200` and `GET /ready` answers `200` with every check
   `ok`. A `baseRpc: not_configured` or `baseRoot: not_synchronized` detail is
   a deployment defect, not a warning: without a synchronized root no proof can
   be accepted. Setting the `SMOKE_STRICT_READY` repository variable to `1`
   makes Deploy Smoke require exactly that instead of tolerating a paused
   `503`.
4. `GET /v1/admin/status` reports state `enabled`, the fixed caps
   `40000000` / `200000000` micro-USD, and zero spend.
5. The service class is enforced in the deployed build. `POST
   /v1/chat/completions` with `{"stream":true}`, a `models` fallback list, a
   `provider` routing object, an unknown field, `n: 2`, an output ceiling above
   4,000, an image content part, or a body over 256 KiB each returns `400` with
   the named code, and an OpenAI-compatible body whose `model` names another
   model still returns a `402` challenge.
6. Retired routes stay retired. The `Deploy Smoke` workflow probes 14 retired
   Stellar, evaluation, billing, and wallet-link paths, seven generic x402,
   `exact`, Bazaar, and MCP paths, the unauthenticated facilitator `settle`
   route, and the unsupported OpenAI and Anthropic paths, and asserts
   `/v1/responses` returns `400` with no `PAYMENT-REQUIRED` header.
7. Pause, verify, resume: `POST /v1/admin/pause` with a reason returns `200`
   and inference and funding return `503 pilot_paused` while `/health`,
   `/ready`, `/v1/contract-status`, and `/v1/admin/status` stay reachable; then
   `POST /v1/admin/resume` restores the `402` challenge. Do this once on
   production before invitations.
8. Cap exhaustion is exercised on a **staging** deployment with deliberately
   low limits, never by spending production budget. Production must report the
   fixed $40 and $200 limits from step 4. The narrowing seam is
   `PILOT_ENVIRONMENT=staging` plus
   `PILOT_STAGING_DAILY_CAP_MICRO_USD` / `PILOT_STAGING_ROLLING_CAP_MICRO_USD`.
   It is narrow by construction: the overrides are read only when the
   environment is exactly `staging`, they may only narrow the fixed ceiling, and
   a service that is not staging **refuses to start** when either one is set
   rather than ignoring it. Staging is a separate service
   (`zk-credits-gateway-staging`) and a separate database, so an exhausted
   staging launch cannot pause production.
9. Publish `@zk-credits/shared@0.1.0`, `@zk-credits/x402-zk-prepaid@0.1.0`,
   and the breaking Base sidecar `zk-credits@0.2.0`, then pin those exact
   versions in the onboarding guide. Deliver
   `private-credit-spend-bn254-dev-sepolia-v1` artifacts directly through the
   invite channel and require operators to verify the shipped manifest hashes
   before proving.

   The order is not optional. The sidecar's runtime dependencies are
   checkout-local `file:` paths, so it cannot install from the registry until
   the two leaves are public. Publish the leaves, then run
   `npm run launch:rewrite-sidecar-deps` to replace those paths with the exact
   published versions and regenerate the lockfile, then reinstall, build, test,
   and install the packed tarball into a throwaway directory, commit the
   dependency-only change, push it, and only then publish the sidecar. A new
   package also publishes directly rather than staged, because npm staged
   publishing only covers packages that already exist. If an existing registry
   version's packed contents differ from this checkout's, stop and bump the
   version: a consumed version can never be replaced.
10. The activation path is rehearsed before the first real operator.
    `scripts/launch-pilot.sh` is the single entrypoint: `--check` is a read-only
    preflight over credentials, git, packages, the chain, and the providers;
    `--status` reconciles local checkpoints against the providers; and no
    argument starts or resumes from the last completed checkpoint. There is no
    unattended confirmation flag and no flag that deletes a resource.

    `npm run activation:rehearse` runs the founder half of the sequence with no
    slot and no invite, so the orchestration is proved without consuming one of
    the three operator slots; it refuses while any window is open, because extra
    traffic during a window contaminates that slot's counters. Each real slot is
    then opened with `npm run activation:start`, which prewarms, requires
    `/ready`, records the baseline aggregate committed-claim count, and issues
    exactly one invite; the operator's bundle is admitted only through
    `npm run activation:evidence`, which validates it against the versioned
    schema and privacy denylist and confirms the committed count increased
    across the window. The commands refuse an operator secret or env path.

    Slots are serialized: A qualifies before B opens, and B before C, because
    the committed-claim comparison is between two aggregate integers and cannot
    on its own distinguish one operator's traffic from another's.
11. Each activation reports three snapshots of the operator sidecar's counters —
    before the discarded warm-up, after it, and after the single counted
    exchange — and qualification requires the warm-up and the counted exchange
    to be exactly one clean lifecycle each. A cumulative total cannot tell a
    warm-up from an activation, so a bundle whose warm-up was retried, whose
    counted window absorbed a second exchange, or whose sidecar had already
    served traffic is refused with a named reason rather than averaged in.
12. The redacted evidence bundles carry aggregate counters only. The committed
    artifacts are the three bundles, the aggregate summary, the deployed
    addresses, the published versions, and the privacy-scan results: no
    operator identity, invite or funding token, credential identifier,
    remaining balance, request metadata, or spend-plane identifier.

## B22 hosted checkpoint evidence (2026-09-23)

The production Render deployment passed strict readiness with every check
healthy, reported the fixed `40000000` / `200000000` micro-USD ceilings, and
completed one pause/resume control cycle; the paused inference probe returned
`503` and readiness returned after resume. A separate staging Neon database and
Render service were provisioned with the narrowed-cap configuration. Against
that isolated database, the real Postgres admission path retained one
`25000` micro-USD debit, rejected the next admission at the UTC-day cap, and
durably paused staging while production remained untouched.

The launcher also completed the founder-side activation rehearsal without
issuing an invite or opening a slot. Its child-process environment forwarding
was tightened to pass only the database URL, hosted gateway URL, and billing
token needed for that rehearsal; the focused launcher suite covers this
boundary. The staging service remains non-runnable until the separate runtime
credentials are explicitly authorized for injection. Slots A–C and the final
verification/evidence checkpoint remain open.

The fresh non-credentialed final checks on the same date also passed for the
hosted gateway: strict `/ready` returned `ready: true`, launch control was
enabled, and all six checks were healthy. The adopted Vercel deployment's
public landing page and onboarding entry rendered, and anonymous `/dashboard`
redirected to `/sign-in`. Its `/api/auth/session` endpoint still returned
`500` because the Vercel project has no production runtime variables; the
attempt to inject the OAuth, NextAuth, gateway, and billing values was stopped
at the explicit SaaS credential-authorization boundary. No Vercel secret was
exported, and the pilot remains open until that authorization (and the real
operator slots) is supplied.

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
