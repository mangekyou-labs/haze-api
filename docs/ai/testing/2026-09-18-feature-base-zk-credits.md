---
phase: testing
title: Base private API credits testing strategy
description: Scenario catalog for the paid Base Sepolia private-credit pilot
---

# Base private API credits testing strategy

Date: 2026-09-20  
Feature slug: `base-zk-credits`  
Status: approved 2026-09-20 on
[Review the reconciled pilot design and implementation plan](../../wayfinder/base-zk-credits-pilot/tickets/05-reconcile-pilot-docs.md).

The circuit, the shared crypto package (planning B2/B3), and the bond
contract (B4) are rewritten locally. The gateway and replay code still
implement a 10 MiB replay cap and a future-only timestamp check, and the
root `circuits/private_credit_spend.{r1cs,wasm,sym}` Circom 0.5 artifacts
still carry the rejected equation at 48 public / 0 private. Those artifacts
are negative fixtures until rewritten. Do not treat their existing tests as
paid-traffic evidence.

Every scenario below maps to at least one planning task. Streaming, generic
x402 wallets, a public facilitator, Bazaar, MCP, `/v1/responses`, Anthropic
translation, an `exact` rail, Base mainnet, and a production ceremony are
not acceptance suites.

## Evidence policy

Implement with a failing test, then the minimum green change. Before any
paid-traffic claim, run a fresh local matrix: `npx ai-devkit@latest lint
--feature base-zk-credits`, package typecheck and tests, Foundry, circuit
compile plus R1CS inspection, web build, and `git diff --check`. A local
pass does not substitute for independent review, a real Sepolia verifier,
Stripe, OpenRouter, or partner dry-run evidence.

Inspect captured logs and persisted rows in privacy scenarios. Fail the
suite if plaintext prompts, responses, secrets, proofs, wallet or account
identifiers, remaining-credit data, nullifiers, or request signals appear
in production logs, spend-plane rows, dashboard views, or weekly sidecar
exports.

A proof failure (prove miss, 10s abort, hash mismatch, or failed
self-verify) must leave no claim row, consume no slot, and must not be
counted as a cancellation.

## Base Sepolia launch repair evidence (2026-09-22)

This repair stops before a live `PrivateCreditBond` broadcast. The shell wizard
is checked for prompt ordering, output-only bond address/block fields, official
USDC and adapter defaults, and redacted secret handling. The TypeScript launch
suite covers the strict Foundry four-CREATE parser/reconciler, nonce/order/type
drift, partial artifacts, reverted receipts, missing bytecode, password-file
permissions, immutable/root validation, and an explorer-verification retry that
preserves the reconciled deployment checkpoint. The Solidity script is built
and tested offline; its order is Poseidon T2, T3, T4, then the bond.

Fresh repair checks from the feature worktree:

| Surface | Command | Result |
| --- | --- | --- |
| TypeScript | `cd ts && npm run typecheck` | passed |
| TypeScript launch and regression suites | `cd ts && npm test -- --run` | passed; 27 files passed, 5 skipped; 340 tests passed, 28 skipped |
| Shell syntax and guardrails | `bash -n scripts/launch-wizard.sh scripts/launch-guardrails.sh scripts/guardrails.test.sh scripts/launch-pilot.sh && bash scripts/guardrails.test.sh` | passed |
| ShellCheck | `shellcheck scripts/launch-wizard.sh scripts/launch-guardrails.sh scripts/guardrails.test.sh` | unavailable on this workstation; syntax/guardrail checks still passed |
| Contracts | `cd contracts && FOUNDRY_OFFLINE=true forge build` | passed with compiler warnings only |
| Contract tests | `cd contracts && FOUNDRY_OFFLINE=true forge test --summary` | 42 passed, 0 failed, 0 skipped |
| Launcher dry check | `scripts/launch-pilot.sh --check` | read-only entrypoint ran; expected not-ready result with incomplete local config; no live credentials or broadcast used |

No password contents, private key, sponsor key, or BaseScan token is emitted
by the wizard/launcher output or checkpoint. Hosting and activation remain
behind the atomically persisted deployment-output boundary.

## Local B2/B3/B4 evidence (2026-09-20)

Run from the `feature-base-zk-credits` worktree. This is local evidence for
the rewritten statement only; it does not close planning B12.

| Scenarios | Command | Result |
| --- | --- | --- |
| S1 | `npm test` in `packages/zk-credits-shared` | 23 passed, 8 skipped (`src/base.test.ts`: 8 passed) |
| S10 | `NODE_ENV=test npx vitest run zk-prepaid-gateway.test.ts` in `ts` | 7 passed |
| B2 caller regression | `npm test` in `packages/zk-credits-sidecar` | 46 passed, 16 files |
| S2, S3, S5 | `CIRCOM=$HOME/.local/bin/circom npm test` in `circuits` | compiled with circom 2.2.2; `public inputs: 0`, `private inputs: 48`, `public outputs: 6`; witness checks passed. S2: slots 0 and 249 satisfy. S3: altered root, altered path, altered tier, altered expiry, slot ≥ 250, slot ≥ 256, `timestamp >= expiry`, zero secret, zero request signal, and a malformed field encoding are all rejected. S5: two-transcript recovery, one-transcript non-recovery |
| S4 | `r1csfile.readR1cs(file, { loadConstraints: false, loadMap: false })` | new build `{ nOutputs: 6, nPubInputs: 0, nPrvInputs: 48 }`; root fixture `{ nOutputs: 6, nPubInputs: 48, nPrvInputs: 0 }` |
| S6, S7 | `FOUNDRY_OFFLINE=true forge test` in `contracts` | 28 passed (26 unit + 2 invariants); invariants ran 256 sequences and ~128,000 calls each with 0 reverts |
| S34 lint | `npx ai-devkit@latest lint --feature base-zk-credits` | all checks passed |

The B4 suites were written first and failed before the contract change, on
the three-tier table (`5000 != 250`, `5000000 != 20000000`, and tier 1/2
still fundable) and on `InvalidProof` for every restored-algebra slash.
After the change, S6 covers the single funded tier, depth-20 append-only
roots with historical retention, release at expiry plus seven days,
permissionless release, terminal exclusivity, USDC accounting, verifier
context failures, and the two fuzz properties. S7 covers two-transcript
recovery of slot blinding then secret, the `Poseidon(slotBlinding) ==
nullifier` and `Poseidon(secret) == commitment` bindings, equal signals,
zero signals, a zero recovered slot blinding, out-of-range field elements,
and the absence of any 300s spend window: evidence six hours old still
slashes. The local S31 overlap is the 50/50 split, the rejected second
slash, and release-versus-slash exclusivity; the full S31 path against the
gateway stays with B20.

Two reading notes. Expected-unsatisfying witnesses print `ERROR: 4 Error in
template PrivateCreditSpend_218`; the circuit suite still exits zero and that
line is not a test failure. The `ts` suite must run with `NODE_ENV=test`,
because the gateway denies billing routes when the ambient `NODE_ENV` is
`production`.

S1–S5 are verified at the source and witness level only, and S3 is partial.
Three S3 clauses are not local: zero slot blinding is constrained in-circuit
but not witness-testable (`Poseidon` has no usable zero preimage), so B2
carries the API-level rejection instead; matching deployment domain is a
contract check in B4, not an in-circuit one; and verifier-adapter consumption
of reordered public signals is B12. S6 and S7 are Foundry evidence against a
mocked `ISpendVerifier` and keccak Poseidon stand-ins, so they do not show
that a real generated proof verifies, that a real Poseidon deployment agrees
with the circuit, or that anything has happened onchain. S23 is not closed:
there is still no independent review and no paid-traffic gate.

Superseded in part by [Local B11 evidence](#local-b11-evidence-2026-09-20):
the generated verifier, the adapter, and the real Poseidon deployments now
carry real-proof Foundry evidence, and the adapter's reordered/altered/malformed
payload cases are covered there. The Base Sepolia half of S23 is recorded in
[Base Sepolia B11 evidence](#base-sepolia-b11-evidence-2026-09-21); the
independent review is still open.

## Local B9 evidence (2026-09-20)

Run from the `feature-base-zk-credits` worktree on 2026-09-20. `NODE_ENV` was
`production` in the ambient shell, so the gateway's internal guard failed
closed until a token was supplied; that is recorded rather than hidden.

| Scenarios | Command | Result |
| --- | --- | --- |
| S1 | `npx vitest run` in `packages/zk-credits-shared` | 29 passed, 8 skipped; `src/recovery-capsule.test.ts` covers version-2 capsule round trip, wrong password, tamper, activation-metadata binding, version-1 acceptance |
| S19, S20, S21, S22 | `npx vitest run` in `ts` (no DB) | 80 passed, 12 skipped across 16 files; `pilot-invites.test.ts`, `pilot-funding.test.ts`, `pilot-admin.test.ts`, `pilot-routes.test.ts`, `pilot-plane-separation.test.ts` cover digests-only storage, expiry, revocation, single redemption under concurrency, account binding, commitment binding, idempotent retries, concurrent funding, invalid commitments, sponsor-failure recovery, response scans, and fail-closed 503s |
| S21, S22, migration | `RUN_DB_TESTS=1 TEST_DATABASE_URL=postgres://localhost:5432/zk_credits_test npx vitest run` in `ts` | 92 passed against local Postgres; `pilot-store.integration.test.ts` covers digest-only rows, no cross-plane columns, one-redemption and one-commitment under concurrent service instances, the SQL expiry claim, and failed-sponsorship recovery |
| S19, S20 | `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` in `web` | all passed; the production route table contains only `/api/invites/redeem`, `/api/pilot/funding`, `/api/network-status`, and `/api/auth/[...nextauth]` |
| S19, S20 | `E2E_PORT=3313 npx playwright test` in `web` | 7 passed: invite denial, backup gating, full onboarding with local activation verification, funding rejection plus retry with the same capability, version-1 and version-2 recovery, wrong password, tamper |
| S21 | smoke probes against locally booted gateway (`:3401`) and `next start` (`:3402`) | `/v1/billing/orders`, `/v1/billing/orders/:id`, `/v1/billing/stripe-event`, `/v1/accounts/wallet-link`, `/api/checkout`, `/api/webhooks/stripe`, `/api/orders/:id`, `/api/wallet/link` all 404; anonymous `/dashboard` 307 to sign-in; `/sign-in`, `/onboarding`, `/recover` contain no Stripe, checkout, or purchase action |
| B8 boundary (superseded) | `npx vitest run` in `packages/zk-credits-sidecar` | 64 passed, 2 failed at the time: the two `src/pinned-artifacts.artifact.test.ts` real-Groth16 cases timed out at 120s. Root cause was the prover running in a `worker_threads` worker, where snarkjs's `web-worker` polyfill re-enters itself; the prover now runs in a terminable child process. See [Local B8 evidence](#local-b8-evidence-2026-09-20) |

Not verified and not claimed: real GitHub OAuth in a deployed environment,
real Base Sepolia sponsorship, hosted smoke runs, and any change to the
`present-unsafe` B5/B6/B8 status notes above. The landing page and README SKU
copy still describe the retired paid path; that is B21.

## Local B8 evidence (2026-09-20)

Run from the `feature-base-zk-credits` worktree. `ts` runs set `NODE_ENV=test`;
the sidecar runs used the frozen development bundle installed at
`packages/zk-credits-sidecar/circuits/artifacts` (gitignored, out of band).

| Scenarios | Command | Result |
| --- | --- | --- |
| S16 | `npx vitest run` in `packages/zk-credits-sidecar` | 66 passed, 19 files. Includes `artifact-bundle.test.ts` (shipped manifest pins three digests; missing, tampered, escaped-symlink, remote, and malformed manifests fail closed with fixed categories), `proof-coordinator.test.ts` (serialized proves, 10s deadline termination, self-verification, reordered-signal rejection, retry identity, deadline refusal, aggregate-only metrics), and `slot-ledger.test.ts` (provisional allocation, durable commit, reuse after failure, exhaustion) |
| S12, S13, S16 | `npx vitest run src/base-sidecar-integration.test.ts` in `packages/zk-credits-sidecar` | 2 passed: the real loopback sidecar plus the real prepaid client complete 402 → `PAYMENT-SIGNATURE` → reserve/commit → `PAYMENT-RESPONSE` over real HTTP against a resource server running the package facilitator; the provider receives the exact request bytes; the claim row ends `committed`; `zk-prepaid` is selected when another rail is offered first |
| S16, S24 | `ZK_CREDITS_ARTIFACT_DIR="$PWD/circuits/artifacts" npx vitest run src/pinned-artifacts.artifact.test.ts` in `packages/zk-credits-sidecar` | 3 passed against the frozen bundle through the compiled child-process worker: real `fullProve`, real `groth16.verify` self-check, exact six-signal order, hot-prove p50/p95 recorded, reordered statement rejected, tampered copy refused before proving |
| S16, S21 | `npx vitest run` in `packages/x402-zk-prepaid` | 11 passed; privacy rejection now covers account, commitment, order, secret, tier, wallet, payer, user, and subject at any depth and in any case, plus unknown fields in the payment, payload, proof, resource, and extensions objects; `/supported` advertises exactly one capability |
| S8–S17, S21 | `NODE_ENV=test npx vitest run` in `ts` | 80 passed, 12 skipped across 16 files; `x402-native-fixture.test.ts` drives the real gateway over real HTTP with `x402Client` plus `x402HTTPClient`, registers `zk-prepaid` deliberately, completes the full exchange, selects the scheme from reordered acceptances, and confirms a generic unregistered client fails with an unsupported-scheme error and no fallback rail |
| S17 | route audit in `ts/x402-native-fixture.test.ts` | no gateway route matches `witness`, `merkle`, `membership`, or `leaf`; `/v1/membership/witness`, `/v1/merkle/path`, `/v1/tree/path`, and `/v1/leaves` return 404 `not_found` |
| S34 | `npm run build` and `npm pack --dry-run` in `packages/zk-credits-sidecar`; `npx tsc --noEmit` in `packages/zk-credits-sidecar` and `ts` | passed; the packed file list contains `dist/proof-child.js` and `circuits/manifest.json` |

Scope limits: the proofs in the fixture suites are shaped payloads with
injected crypto, not production proofs. The real bundle path is exercised
only by the opt-in artifact test on the development ceremony artifacts. No
Solidity verifier, deployment, or paid traffic is involved, and none of this
closes B12.

## Local B5 evidence (2026-09-20)

| Scenarios | Command | Result |
| --- | --- | --- |
| S8–S11 | `npm test` in `packages/x402-zk-prepaid` | 8 passed; covers fixed credit wire fields, Base64 envelopes, identifying/unknown-field rejection, mixed-accept selection, cache keys and stale challenges, empty transaction/omitted payer, real core registration and `/supported`, phase injection rejection, and escrow orchestration |
| S8–S11 | `npm run build` in `packages/x402-zk-prepaid` | passed with `@x402/core` v2.26 types |
| S8–S11 | `npm run typecheck` in `ts` | passed |
| S9–S10 | `NODE_ENV=test npx vitest run zk-prepaid-gateway.test.ts` in `ts` | 7 passed |
| S8–S10 | `NODE_ENV=test npx vitest run src/base-sidecar.test.ts src/sidecar.test.ts` in `packages/zk-credits-sidecar` | 7 passed |
| S34 | `npx ai-devkit@latest lint --feature base-zk-credits`; `npx ai-devkit@latest lint`; `git diff --check` | all passed |

These are local adapter and consumer regressions only. Durable reservation
state, gateway status mapping, proof freshness enforcement, and live
facilitator-route migration remain B6; generated proofs, Solidity verification,
deployment, and paid traffic remain B12.

## Local B11 evidence (2026-09-20)

Run from the `feature-base-zk-credits` worktree on top of `20492b0` and
`4d5387e`. Every command below is a fresh run in this session. There is no
Base Sepolia receipt in this section, so nothing here is an onchain or
paid-traffic claim, and B12 keeps the independent review.

| Scenarios | Command | Result |
| --- | --- | --- |
| S1 | `npm test` in `packages/zk-credits-shared` | 29 passed, 8 skipped |
| S16, S24 | `npm run build && npx vitest run` in `packages/zk-credits-sidecar` | 66 passed, 19 files, including the opt-in `src/pinned-artifacts.artifact.test.ts` against the installed frozen bundle: real `fullProve`, real `groth16.verify` self-check, exact six-signal order, reordered statement rejected |
| S8–S11, S21 | `npx vitest run` in `packages/x402-zk-prepaid` | 11 passed, including identifying-field rejection and the single-capability `/supported` response |
| S8–S14, S21 | `NODE_ENV=test npx vitest run` in `ts` | 81 passed, 12 skipped across 16 files |
| S9 | `NODE_ENV=test npx vitest run zk-prepaid-gateway.test.ts` in `ts` | 16 passed. The new case pins the window `[now-300s, now+5s]` with both edges accepted, and rejects `now-301`, `now+6`, a user-selected historical `issuedAt`, and a public timestamp that is not the gateway `issuedAt` (`issued_at_mismatch`), each with no claim row |
| S2–S5 | `CIRCOM=$HOME/.local/bin/circom npm test` in `circuits` | compiled with circom 2.2.2: `public inputs: 0`, `private inputs: 48`, `public outputs: 6`; witness checks passed. S3 covers the negative witness set and S5 the one-transcript/two-transcript pair. The expected-unsatisfying witnesses still print `ERROR: 4 Error in template PrivateCreditSpend_218` |
| S4 | `r1csfile.readR1cs(file, false, false, false)` | new build `{ nOutputs: 6, nPubInputs: 0, nPrvInputs: 48 }`; root fixture `{ nOutputs: 6, nPubInputs: 48, nPrvInputs: 0 }` |
| S5–S7, S23 (local half) | `FOUNDRY_OFFLINE=true forge test` in `contracts` | 42 passed: 26 unit + 2 invariants (256 sequences, ~128,000 calls, 0 reverts each) + 8 `SpendVerifierTest` + 3 `PoseidonParityTest` + 3 `SpendRecoveryTest`. The new suites decode the snarkjs `soliditycalldata` payload, verify both real transcripts of one nullifier through the generated verifier, reject reordered, swapped, altered, out-of-field, and truncated payloads, reproduce the circuit root and the circomlibjs literals with the deployed Poseidon T2/T3/T4, and slash two conflicting transcripts 50/50 against the real verifier with the real Poseidon |
| S19 | `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` in `web` | typecheck and build passed; 12 tests passed; lint 0 errors, 8 warnings (7 in `web/src/archive/stellar`, 1 in `postcss.config.mjs`) |
| S34 | `npx ai-devkit@latest lint --feature base-zk-credits`; `git diff --check` | all checks passed; no whitespace errors |
| S21, S22 | production-surface scan: `console.*` statements in `ts`, `packages`, and `web/src` (tests and archives excluded), plus dashboard and component field names | no production log statement carries a prompt, response, secret, proof, wallet, account, credit, nullifier, or request signal; dashboard views expose no `nullifier`, `requestSignal`, `remainingCredit`, or `encryptedReplay` field; the aggregate metrics snapshot stays token-gated and carries no witness, proof, or field element |

Reading notes. The `ts` suite runs with `NODE_ENV=test` because the gateway
fails closed on billing routes when the ambient `NODE_ENV` is `production`.
The Foundry fixture is generated rather than hand-edited:
`contracts/scripts/generate-spend-fixtures.mjs` re-verified the wasm, zkey, and
verification-key digests against
`packages/zk-credits-sidecar/circuits/manifest.json` before proving and checked
its payload layout against `groth16.exportSolidityCallData`; the parity suite
caught a bad literal in an earlier draft, so the literals are pinned against
`packages/zk-credits-shared/src/base.test.ts` rather than transcribed.

Not covered here and not claimed: the independent cryptographic review, paid
traffic, and any production ceremony. The Base Sepolia verifier and adapter
deployment that this section lacked is recorded in
[Base Sepolia B11 evidence](#base-sepolia-b11-evidence-2026-09-21).
`post-expiry` is enforced by the circuit (`timestamp < expiry`) and by the
bond's proof-context check, not by the gateway, which does not know a
credential's expiry; the gateway's equivalent negative is the
`[now-300s, now+5s]` window above.

## Base Sepolia B11 evidence (2026-09-21)

Run from the `feature-base-zk-credits` worktree at commit `9a596c3e7957` with
the three deployed-from sources clean at HEAD, a dedicated keystore, and the
public `https://sepolia.base.org` RPC. This is the real-chain half of S23: a
generated proof verified by the deployed Solidity verifier and the
`ISpendVerifier` adapter on Base Sepolia. It is not an independent review and
not a paid-traffic claim.

| Scenarios | Command | Result |
| --- | --- | --- |
| S23 (Base Sepolia half) | `forge create src/PrivateCreditSpendVerifier.sol:Groth16Verifier` with `--chain 84532 --broadcast --verify` | deployed `0xC66CC4866f945Ce39c207729CF136fd03d58207E` in block 47,096,589, gas 445,789, cost 2,674,734,000,000 wei; runtime bytecode 1816 bytes, sha256 `572b3914765f05316d56c13448303645614f6ca0de95725f014923ed345fa12b`, identical to the compiled `deployedBytecode`; BaseScan `Pass - Verified` |
| S23 (Base Sepolia half) | `forge create src/SpendVerifier.sol:SpendVerifier` with the verifier address as its only constructor argument | deployed `0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD` in block 47,096,600, gas 386,525, cost 2,319,150,000,000 wei; runtime bytecode 1531 bytes, sha256 `7d855c799850a90d06bff9db3db87791f740aba72719c5d00e44712a49f9b025`, differing from the artifact only by the immutable `verifier()` slot, which reads back the verifier address; BaseScan `Pass - Verified` |
| S23 (Base Sepolia half) | `cast call <adapter> "verifySpend(bytes32,uint256,uint256,uint256,bytes)(bool,bytes32,uint256,bytes32)"` with `COMMITMENT`, `SIGNAL_1`, `NULLIFIER`, `SHARE_1`, `PROOF_1` | `true`, `0x0d246a2afb766521d94437474ef6377058f7987bbe8a588005f37c8e3aa70831`, `1797400000`, `0x00000000000000000000000000000000000000000000000000000000000004d2` |
| S23 (Base Sepolia half) | the same call with `SIGNAL_2`, `SHARE_2`, `PROOF_2` | `true`; the second transcript of the same nullifier verifies on the deployed pair |
| S34 | `FOUNDRY_OFFLINE=true forge test --match-contract SpendVerifierTest` in `contracts` | 8 passed, 0 failed |

Transactions: `0xa38ccbe4650027fc55a2f8459c62b15f94c54ba4243c193f6128b04d1a943183`
(verifier) and
`0x1832be22b0928ec7b3e340b006385ad7652faf91e1b45a62930db0da6b9557c8` (adapter).
Both paid the 0.006 gwei effective price, 4,993,884,000,000 wei in total,
against a pinned 13,200,000 wei max fee and the 0.0001 ETH preflight ceiling.
The preflight that authorized the broadcast required chain ID `84532`, the three
sources tracked and clean at HEAD, a green focused suite, a projection inside
the ceiling, and a balance covering that projection. Redacted excerpts of the
two broadcasts, the focused suite, and the command record are in
`~/.local/state/haze/logs/`; the run's timestamped JSON evidence is
`/private/tmp/haze-b11-base-sepolia-evidence-20260921T032831Z.json`, and the
durable copy of its values is this section.

The two receipts, both runtime bytecodes, the immutable, and the proof call were
re-checked independently from this checkout after the run: both receipts return
status `0x1` with a matching `contractAddress`, `cast code` re-derives the two
hashes above, and the fixture call still returns `true` with the fixture root,
timestamp, and domain.

Not covered here: the independent cryptographic review, the R1CS and
negative-test review packet, paid traffic, and any production ceremony. The
deployed pair runs the development proving material, so S23 stays open on the
paid-traffic gate (B12).

## Local B21 evidence (2026-09-21)

Run from the `feature-base-zk-credits` worktree with the pre-existing dirty
tree preserved. The B21 targets were snapshotted to
`/tmp/b21-copy-freeze-snapshot/` before any edit and re-compared after, so the
scoped diff review below contains only copy-freeze changes and none of the
foundational work. No API, schema, storage, protocol, or runtime change: the
deployed `/supported` capability and the disabled real-payment configuration
remain the source of truth the active copy now matches.

The explicitly active copy set: root `README.md`, `web/README.md`,
`contracts/README.md`, `packages/zk-credits-sidecar/README.md`,
`packages/x402-zk-prepaid/README.md`, `web/src/app/layout.tsx`,
`web/src/app/page.tsx`, `web/src/components/site-footer.tsx`,
`web/src/app/sign-in/page.tsx`, `web/src/app/onboarding/page.tsx`,
`web/src/app/dashboard/page.tsx`,
`web/src/app/dashboard/pilot-onboarding-flow.tsx`, `web/src/app/recover/page.tsx`,
and `web/src/app/recover/recover-credential-form.tsx`. Archives, historical
design documents, backend payment routes, and dormant components are excluded
by construction; the dormant payment components, routes, environment
configuration, and provisioning behavior were left intact.

Fresh validation, all from `web/` unless noted:

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors, 8 pre-existing warnings under `src/archive/**` |
| `npm run typecheck` | exit 0 |
| `npm test -- --run` | 5 files, 47 passed — including 35 new copy-contract assertions in `src/lib/pilot-copy-contract.test.ts` |
| `npm run build` | compiled; 11/11 static pages generated |
| `npm run test:e2e` | 7 passed, including `e2e/landing.spec.ts` |
| `git diff --check` (worktree root) | clean |
| scoped stale-string and unsupported-claim search | no commerce terms on the active set; every unsupported-claim hit is a negation or a code identifier |

The copy-contract test requires the pilot status (invite-only, unpaid,
experimental, Base Sepolia), founder-provisioned test credits, the supported
client distinction (project sidecar `POST /v1/chat/completions` or an
x402-native agent registering the `zk-prepaid` adapter), the deployed
`/supported` advertisement (x402 v2, `zk-prepaid`, `eip155:84532`,
`prepaid-claim`, `escrow`), the named unsupported surfaces, the audit warning,
the telemetry privacy boundary, and the gateway/provider observation
disclosure. It rejects Stripe, checkout, buy/purchase, price/pricing, renewal,
SKU, legacy plan names, fixed 30-day validity, subscription, dollar pricing,
and broad anonymity claims on every active surface.

Scoped diff review (`diff -u` of each snapshot against the final file, 693
lines total), additions/removals per file: `README.md` 57/37; `web/README.md`
37/22; `contracts/README.md` 12/9; `packages/zk-credits-sidecar/README.md`
16/8; `packages/x402-zk-prepaid/README.md` 13/6; `web/src/app/page.tsx` 41/40;
`web/src/app/layout.tsx` 2/1; `web/src/components/site-footer.tsx` 18/5;
`web/src/app/sign-in/page.tsx` 2/1; `web/src/app/onboarding/page.tsx` 13/8;
`web/src/app/dashboard/page.tsx` 19/3;
`web/src/app/dashboard/pilot-onboarding-flow.tsx` 10/7;
`web/src/app/recover/recover-credential-form.tsx` 5/0; `web/e2e/landing.spec.ts`
21/3; new `web/src/lib/pilot-copy-contract.test.ts` 102/0. Each hunk was
reviewed line by line: the changes are copy, test, and evidence only —
semantic elements, focus styles, responsive classes, and the visual system
are unchanged.

Not covered: no invite enforcement, credit provisioning, deployment, or
checkout-disablement change; no claim of production readiness or independent
audit.

## Local B22 launch-control evidence (2026-09-21)

Run from the `feature-base-zk-credits` worktree. The B22 hardening adds the
service-class boundary, the durable launch controls, the readiness surface,
and the aggregate status endpoint described in
[the implementation notes](../implementation/2026-09-18-feature-base-zk-credits.md#service-class-enforcement-b22).

New focused suites, all from `ts/`:

| Suite | Tests | Covers |
| --- | --- | --- |
| `service-class.test.ts` | 34 | forced model, price ceilings, every rejected field and route class, media parts, `n`, output ceiling, byte-conservative input counting |
| `launch-control.test.ts` | 15 | pause/resume, reason bounds, debit/retain/release, daily and rolling caps, UTC-midnight boundary, concurrent admission, restart persistence |
| `launch-routes.test.ts` | 14 | kill switch across inference and funding, health/readiness/recovery reachability, authenticated admin commands, cap exhaustion cancelling the reservation, pre-dispatch release, post-dispatch retention, aggregate status privacy |
| `readiness.test.ts` | 10 | every readiness check, lag limit, liveness independence, fixed privacy-safe details |
| `privacy-scan.test.ts` | 3 | canary prompt/response, nullifier, signal, and response key absent from logs and from the durable claim row; whole-row control-table scan |
| `launch-control.integration.test.ts` | 9 | real Postgres: serialized cap enforcement across two pools, restart persistence, database-clock UTC and rolling windows, released-debit exclusion, column-level privacy assertion |

Full gateway suite with `RUN_DB_TESTS=1` against `postgres://localhost:5432/zk_credits_test`:
22 files, **180 passed, 0 failed**. Of those, 21 tests across four files
require Postgres and are skipped without the flag; `db/migrate.test.ts` carries
one unrelated unconditional skip. Without the flag the suite reports 158 passed
and 22 skipped, so a green local run that omits `RUN_DB_TESTS=1` has not
exercised the durable launch controls at all. `npm run typecheck` exits 0.

Live verification against a booted gateway (`NODE_ENV=production`, managed
Postgres, stub verifying key) on 2026-09-21:

| Probe | Observed |
| --- | --- |
| `GET /health` | `200` with `status: "ok"` |
| `GET /ready` (no root synced) | `503`, `baseRoot: not_synchronized`, `baseRpc: not_configured`, database/verifier/provider `ok` |
| `POST /v1/admin/pause` without a reason | `400` |
| `POST /v1/admin/pause` with a reason | `200`, `state: "paused"` |
| paused `POST /v1/chat/completions` | `503 pilot_paused`, no provider dispatch |
| paused `POST /v1/pilot/funding` and `POST /v1/pilot/invites/redeem` | `503 pilot_paused` |
| paused `GET /health`, `GET /v1/contract-status`, `GET /v1/admin/status` | `200` |
| paused `GET /ready` | `503`, `launchControl: paused` |
| `POST /v1/admin/resume` | `200`, inference returns to a `402` challenge |
| retired Stellar/evaluation/billing/wallet routes (14 probes) | `404` |
| generic x402, `exact`, Bazaar, MCP probes (7) | `404` |
| `POST /x402/facilitator/settle` unauthenticated | `401` |
| `POST /v1/responses` | `400`, no `PAYMENT-REQUIRED` header |
| `POST /v1/models`, `/v1/messages`, `/v1/embeddings` | `404` |
| service-class rejections (streaming, fallback list, routing, plugins, unknown field, `n=2`, output ceiling, image part, empty messages) | `400` with the named code |
| 300,048-byte body | `400 request_too_large` |
| 20,000-character message | `400 input_too_large` |

Full release matrix, all from the worktree root unless noted:

| Command | Result |
| --- | --- |
| `packages/x402-zk-prepaid`: `npm run build && npm test -- --run` | build clean; 11 passed |
| `packages/zk-credits-shared`: `npm run build && npm test -- --run` | build clean; 29 passed, 8 skipped |
| `ts`: `npm run typecheck` | exit 0 |
| `ts`: `RUN_DB_TESTS=1 npm test -- --run` | 22 files, 180 passed |
| `packages/zk-credits-sidecar`: `npm run build && npm test -- --run && npm pack --dry-run` | 19 files, 66 passed; pack lists 43 files |
| `web`: `npm run lint` | 0 errors, 8 pre-existing warnings under `src/archive/**` |
| `web`: `npm run typecheck && npm test -- --run` | exit 0; 47 passed |
| `web`: `npm run test:e2e` | 7 passed |
| `circuits`: `npm test -- --run` | witness checks passed |
| `contracts`: `FOUNDRY_OFFLINE=true forge build && forge test` | build exit 0; 42 passed |

The privacy scan asserts the boundary rather than trusting it: a canary prompt
and response never appear in captured console output or in the durable claim
row, and a whole-row scan of `control_plane.launch_control` and
`spend_plane.dispatch_debits` finds no prompt, response, nullifier, signal, or
identity join. The integration suite additionally pins the exact column set of
both tables, so a future migration cannot add a joinable column unnoticed.

Not covered: no hosted deploy, no npm publication, no operator activation, and
no claim of production readiness, generic x402 compatibility, or independent
audit. The three-operator activation evidence in issue #26 remains outstanding.

## Local B22 launch-automation evidence (2026-09-21)

Run from the `feature-base-zk-credits` worktree. This pass builds the resumable
launch system and closes the release-readiness gaps that would have prevented
three operators from completing an activation. It is described in
[the implementation notes](../implementation/2026-09-18-feature-base-zk-credits.md#resumable-launch-system-b22)
and gated by
[the pre-invite checklist](../deployment/2026-09-18-feature-base-zk-credits.md#b22-launch-controls-before-invitations).

### The activation measurement was replaced, because it could not work

The previous evidence schema reported one cumulative exchange total and one
cumulative proving total, and the operator wizard hardcoded every failure
category to zero. Two consequences followed:

- a warm-up could not be told apart from the activation, because subtracting a
  baseline from a cumulative total cannot show *which* exchange was counted; and
- the recorded failure categories were always zero, so the one artifact meant to
  show what went wrong was structurally incapable of showing it.

Schema version 2 reports three snapshots of the sidecar's authenticated loopback
counters — before the warm-up, after the warm-up, and after the counted
exchange — and derives every exchange counter, every proving counter, and every
failure category as a delta between two of them. Qualification now requires a
fresh sidecar, exactly one successful cold warm-up before the baseline, and
exactly one successful counted exchange after it. The hot-prove sample count is
what separates the two windows: the first prove in a process is the cold sample,
so a clean warm-up leaves it at zero and the counted exchange raises it to one.

| Contamination | Recorded reason |
| --- | --- |
| the sidecar had already served traffic | `stale_traffic_before_warmup` |
| the warm-up window absorbed a second exchange | `cold_warmup_contaminated_by_extra_traffic`, `cold_warmup_not_the_cold_sample` |
| no warm-up happened, so the counted exchange was the cold prove | `cold_warmup_incomplete_exchange`, `hot_exchange_not_a_hot_proof` |
| the counted window absorbed another activation's traffic | `hot_exchange_contaminated_by_extra_traffic` |
| the warm-up or the exchange recorded a failure or a retry | `cold_warmup_recorded_retries`, `hot_exchange_recorded_failures`, `hot_exchange_recorded_failure_categories` |

Serialization is enforced rather than documented: `activation-start` refuses a
slot that already has an open window, and `activation-rehearse` refuses to run
while any window is open, because extra traffic during a window contaminates
that slot's counters and the committed-claim comparison is between two aggregate
integers.

### A valid activation bundle could not have been produced

`scripts/launch-guardrails.sh` and the operator wizard both scanned a bundle for
any field name *containing* `credential`. The evidence schema's own
`credentialStayedLocal` attestation asserts where a credential stayed and
carries no credential, so the scan rejected every legitimate bundle. The
guardrail test only ever fed the scan a hand-written fixture without
attestations, which is why it passed.

Both scans now match key names and exempt exactly that one key, and the tests
pin both directions: the full real bundle including its attestations is
accepted, and `credentialSecret` and a bare `credential` are still refused.

### New suites

| Suite | Tests | Covers |
| --- | --- | --- |
| `ts/activation.test.ts` | 31 | the pinned-bundle vocabulary, unknown keys at every depth, the denylist, the counter shapes, and every contamination case above |
| `ts/launch-environment.test.ts` | 12 | environment resolution, the staging-only cap pair, production refusal, and cap exhaustion at a narrowed ceiling |
| `ts/launch/state.test.ts` | 7 | checkpoint round-trip, mode 0600, refusal of a secret-shaped value, refusal of a tracked path, `unknown` versus `failed` |
| `ts/launch/environment.test.ts` | 18 | value shapes, staged requirements, deferred OAuth pair, the three distinct operator ids, custody-key refusal, file permissions |
| `ts/launch/providers.test.ts` | 28 | Neon/Render/Vercel payloads and live adapters, create/adopt/ambiguous/refuse resolution, owner selection, the JSON-RPC reader, transport timeouts |
| `ts/launch/release.test.ts` | 19 | packed-content digests, already-published-version refusal, the dependency rewrite, the dependency-only commit, the release gate |
| `ts/launch/deploy.test.ts` | 16 | predicted CREATE addresses, receipt/bytecode reconciliation, immutable read-back, the bounded USDC approval |
| `ts/launch/cli.test.ts` | 43 | preflight, status, the redaction of a persisted failure note, and resumption after an interruption at *every* step of the plan |
| `ts/launch/redact.test.ts` | 8 | one sample per secret pattern, redaction, and the secret-free state boundary |
| `scripts/operator-evidence.test.mjs` | 12 | the operator-side warm-up and counted-window checks, and the version-2 bundle it writes |
| `scripts/guardrails.test.sh` | 60 | the secret boundary, including the full real bundle and the exemption's exact edge |

The resumption suite is parameterised over the real plan rather than a
convenient step: the plan is 26 steps across the six stages, six of them
irreversible, and the suite interrupts at each of the 26, asserts the earlier
steps are durably recorded and the interrupted one is `unknown`, asserts a
second resume *refuses to advance* until the unknown is reconciled, and asserts
the run then continues from that step rather than from the beginning. That is
the property that keeps an interrupted broadcast or publish from being repeated.

### Release matrix

| Command | Result |
| --- | --- |
| `ts`: `npm run typecheck` | exit 0 |
| `ts`: `RUN_DB_TESTS=1 npm test -- --run` | 32 files, **369 passed, 0 failed** |
| `packages/x402-zk-prepaid`: `npm run build && npm test -- --run` | build clean; 22 passed |
| `packages/zk-credits-shared`: `npm run build && npm test -- --run` | build clean; 29 passed, 8 skipped |
| `packages/zk-credits-sidecar`: `npm run build && npm test -- --run` | build clean; 19 files, 66 passed |
| `web`: `npm run lint` | 0 errors, 8 pre-existing warnings under `src/archive/**` |
| `web`: `npm run typecheck && npm test -- --run` | exit 0; 47 passed |
| `circuits`: `npm test -- --run` | witness checks passed |
| `contracts`: `FOUNDRY_OFFLINE=true forge build && forge test` | build exit 0; 42 passed, 0 failed |
| `node --test scripts/operator-evidence.test.mjs` | 12 passed, 0 failed |
| `bash scripts/guardrails.test.sh` | 60 passed, 0 failed |
| `for f in scripts/*.sh; do bash -n "$f"; done` | all five parse |

The Postgres-backed suites ran against `postgres://localhost:5432/zk_credits_test`
with `RUN_DB_TESTS=1`; the durable evidence assertion now also pins that the
stored JSONB bundle carries the three counter snapshots, so a migration cannot
quietly drop the warm-up record.

Not covered: no npm publication, no Base Sepolia bond deployment, no hosted
deploy, and no operator activation. Every step that changes something outside a
machine is a checkpoint that stops and asks; the launch system is built and
tested here, and running it is the founder's action with the founder's
credentials.

### Secret scan

`gw_scan_for_secrets` over every new non-test artifact — the two activation
modules, `ts/launch-environment.ts`, the eight `ts/launch/*.ts` modules,
`scripts/launch-pilot.sh`, and `scripts/operator-evidence.mjs` — reports clean:
no private key, provider token, credentialed connection string, PEM block, or
email address.

`ts/launch/cli.test.ts` does trip the scan, and deliberately. It carries
fabricated `npm_…` and `sk-or-v1-…` values and one synthetic
`postgresql://u:p@…` URL, because the redaction test has to prove that a real
secret-shaped value does not survive the output path — the same reason
`scripts/guardrails.test.sh` carries `postgresql://u:hunter2@host/db`. The
difference is what is being asserted: the guardrail suite asserts the scan
refuses those shapes, while here they are inputs to the code under test and the
assertion is that they are redacted before reaching the state file.

`.env.launch.local` and `.launch-state.local.json` are both gitignored
(`.gitignore:4` and `.gitignore:8`) and neither is tracked. The launch refuses
to write into either when git tracks it.

## Scenario catalog

| ID | Scenario | Planning tasks |
| --- | --- | --- |
| S1 | Deterministic Poseidon vectors, BN254 field/range checks, length-prefixed request canonicalization, encrypted credential round trip, wrong-password and tamper failures | B2 |
| S2 | Valid spend for any unused slot in `[0, 250)` under restored algebra and ABI `[root, timestamp, domain, requestSignal, nullifier, share]` | B3, B12 |
| S3 | Circuit rejects altered root, path, tier, expiry, slot, timestamp, domain, signal, nullifier, share; zero secret; zero slot blinding; zero request signal; slot ≥ 250; `timestamp >= expiry`; reordered public signals; malformed field encodings | B3, B12 |
| S4 | Compiled R1CS is 6 public / 48 private; `main` does not also mark challenge values public; verifiers consume `fullProve` `publicSignals` as-is | B3, B12 |
| S5 | One-transcript share does not recover secret or slot blinding; two transcripts same nullifier different signals recover slot blinding then secret | B3, B4, B12, B20 |
| S6 | Foundry: sponsor `fundBundle`, depth-20 roots, known historical roots, single funded tier allowance 250, expiry views, release after expiry+7d, replay protection, terminal exclusivity, USDC accounting, 50/50 slash, verifier failures, fuzz, invariants | B4, B20 |
| S7 | On-chain slash uses restored recovery: `(share1-share2)/(x1-x2)` is slot blinding; `secret = share1 - a * x1`; require `Poseidon(a) == nullifier` and `Poseidon(secret) == commitment`; no live 402 or 300s window | B4, B12, B20 |
| S8 | x402 v2 Base64 envelopes, `amount: "1"`, `asset: "coding-deepseek-v4-flash-v1"`, scheme-based acceptance selection, real `@x402/core` registration, `/supported` negotiation, omitted `payer`, `transaction: ""`, reject identifying payload fields | B5 |
| S9 | Gateway-issued `extra.issuedAt` unix seconds; public timestamp equals it; reject outside `[now-300s, now+5s]`; cached 402 dies when `issuedAt` leaves the window; client-chosen timestamp is rejected | B5, B6 |
| S10 | Request signal binds method, absolute URL, body hash, RFC 8785 requirements digest, nonce, and response key; same nullifier+signal coalesces; different signal is conflict fail-closed | B5, B6 |
| S11 | Resource server does not call `/verify` on the paid path; first `/settle` reserves; second commits; `settleOnCancel` only before a commit attempt; client cannot inject phase | B5, B6 |
| S12 | Reserve before dispatch; commit only after a fully buffered, structurally valid provider 2xx within 1 MiB; local validation, non-2xx, timeout, oversized body, and pre-commit failure cancel and consume no credit | B6, B8 |
| S13 | Streaming request or `stream: true` is rejected before reserve; settlement and replay never diverge | B6, B8 |
| S14 | Exact retry of a committed claim returns the 24h encrypted replay without a second slot or provider dispatch; that ciphertext is not slash evidence | B6, B8 |
| S15 | At most two upstream dispatches per nullifier; after two failures the claim stays cancelled until an explicit operator reset; no model fallback | B6 |
| S16 | A prove miss, 10s abort, hash-pinned artifact mismatch, or failed local self-verify is a proof failure: no claim row, slot unused, sidecar metric only | B8, B16 |
| S17 | Sidecar computes its own Merkle path from public tree data; gateway never serves a path for a named leaf or commitment; control plane never serves WASM/zkey at runtime | B8, B16 |
| S18 | Duplicate Stripe webhooks, opaque order metadata, failed sponsorship, chargeback, refund retry, and durable job idempotency | B7 |
| S19 | Web: credential backup gate before Checkout, Base Sepolia links, no wallet purchase, no remaining-credit or usage history, live SKU $20+$20 / 250 credits only | B9, B21 |
| S20 | Optional SIWE is not a purchase or request prerequisite; GitHub OAuth remains primary | B9 |
| S21 | Privacy: spend-plane rows, logs, dashboard, weekly sidecar export contain no prompts, responses, secrets, proofs, wallets, accounts, remaining-credit, nullifiers, or request signals | B6, B7, B8, B9, B13 |
| S22 | Control plane may know a principal paid and activated; it must not join that identity to nullifiers or request signals | B7, B9, B13 |
| S23 | Independent-review packet, R1CS dump, negative-test set, generated proof verified by the real Solidity verifier+adapter on Base Sepolia, and two-transcript recovery | B12 |
| S24 | Founder unpaid dry-run: discard one cold start, 20 hot prove+self-verify cycles on pinned artifacts, p95 ≤ 2.0s on a normal laptop, nothing submitted to the live gateway | B16 |
| S25 | Partner unpaid dry-run on their sidecar host against the published proving SLO (p50 ≤ 1.5s, p95 ≤ 3.0s); fail → not activated; no lab substitution, remote prove, or loosened cap | B13, B16 |
| S26 | Unit-economics fixture: full-bundle and two-dispatch worst case remain positive contribution at class ceilings; $40/UTC day and $200/30d provider caps pause checkout | B14 |
| S27 | Load: three activated sidecars, one `fullProve` per process, two-agent as two processes; gateway reserve/commit under concurrent exact retries and conflicting signals | B15 |
| S28 | Storage growth: at most 250 first-transcripts per bundle through expiry+7d; 24h replay ciphertext separate; deletion after retention | B17 |
| S29 | Claim-store: uniqueness and fencing generations, lease expiry, commit ambiguity remains fenced, crash between reserve and commit, crash between commit and client return | B18 |
| S30 | Event-cursor: finalized-root lag, `BondSlashed` revocation rebuild of remaining 250-slot nullifiers from chain history, reorg-safe cursor, no skip ahead of confirmation depth | B19 |
| S31 | Slashing path: two valid conflicting transcripts submitted without a live 402; 50/50 split; second slash rejected; release and slash mutually exclusive | B20 |
| S32 | Pilot activation evidence: twelve interviews, week-1 kill bars, at most three live-SKU partners, sidecar-local aggregates, continuation lines | B13 |
| S33 | Archive Stellar/evaluation runtime is not on the paid path; search audit finds no live Stellar spend | B10 |
| S34 | Full local verification matrix and release-gate checklist; mainnet and ceremony remain later-map | B11, B22 |

## B22 launcher resume evidence (2026-09-22)

The release safety regression was written first: with the production fix
temporarily reverted, the focused launcher suite failed exactly two tests — a
commit present only on the wrong remote was accepted, and commit-and-push
named `origin`. With the fix restored, `npm test -- --run launch/cli.test.ts`
passed all 34 tests. The repair resolves the configured upstream and uses
`git merge-base --is-ancestor` for the exact-branch check, then pushes without
hard-coding a remote.

| Surface | Command | Result |
| --- | --- | --- |
| TypeScript + Postgres | `RUN_DB_TESTS=1 TEST_DATABASE_URL=postgres://localhost:5432/zk_credits_test npm test -- --run` in `ts` | 32 files, 371 passed |
| TypeScript types | `npm run typecheck` in `ts` | exit 0 |
| Sidecar | `npm run build && npm test -- --run && npm pack --dry-run` | 66 passed; 43 packed files |
| Shared leaf | `npm run build && npm test -- --run` | 29 passed, 8 skipped |
| x402 adapter leaf | `npm run build && npm test -- --run` | 22 passed |
| Shell guardrails | `bash scripts/guardrails.test.sh` | 68 passed |
| Whitespace | `git diff --check` | clean |

The local launch checkpoint was stale at the former preflight commit and had a
failed dependency-only commit step; the launcher fix is now pushed to
`haze-api/feature-base-zk-credits`, while only the two expected sidecar
manifest/lockfile files remain unstaged. Public registry checks for
`@zk-credits/shared@0.1.0`, `@zk-credits/x402-zk-prepaid@0.1.0`, and
`zk-credits@0.2.0` returned HTTP 404, and npm authentication returned HTTP 401.
No package was published or republished; deployment, hosting, controls, and
operator activation remain blocked at that release credential gate.

## B22 hosted launch checkpoint evidence (2026-09-23)

The resumable launch was continued through the hosted control gates. Production
answered strict `/ready` successfully with the fixed `40000000` / `200000000`
micro-USD caps, the production pause/resume probe returned `503` while paused
and recovered after resume, and the activation rehearsal completed without
issuing an invite or opening a window.

An isolated staging Neon database and `zk-credits-gateway-staging` Render
service were provisioned. The real Postgres launch-control path was exercised
against the separate database with staging caps of `25000` daily and `25000`
rolling micro-USD: the first dispatch debit was retained, the second was
refused with the UTC-day cap outcome, and staging durably entered the paused
state. No production spend or launch state was changed by that exercise.

The staging service has non-secret configuration only; its separate runtime
credentials have not been exported pending explicit authorization. The
launcher is paused before slot A, where GitHub account ownership, invite
handling, sidecar traffic, and redacted operator evidence must be supplied by
the real operator. No activation evidence was fabricated.

The activation rehearsal initially exposed a launcher environment-forwarding
defect. The fix forwards only the three runtime values required by the founder
CLI, and `launch/cli.test.ts` now has 37 passing tests including that boundary;
`npm run typecheck` also passes.

The fresh final checks then recorded strict hosted readiness as green: the
gateway returned `ready: true`, launch control was enabled, and the six
readiness checks were healthy. Playwright against the adopted Vercel
deployment rendered the landing and onboarding routes and confirmed anonymous
dashboard gating. The deployment's `/api/auth/session` returned `500`, however,
because its production environment is empty; adding the OAuth, NextAuth,
gateway, and billing values was blocked pending explicit authorization to send
those secrets to Vercel. Guardrail tests passed `68/68`, operator-evidence
schema tests passed `12/12`, and no activation bundle was fabricated while the
launcher remained paused before slot A.

## Required suites

- Shared crypto (S1).
- Circuits and R1CS (S2–S5, S23).
- Foundry contract accounting and slash (S6, S7, S31).
- x402 custom scheme (S8–S11). Generic-wallet, public-facilitator, MCP, and
  `exact`-rail coverage are out of scope.
- Gateway claim lifecycle (S12–S15, S29).
- Sidecar proving (S16, S17, S24, S25).
- Stripe and durable jobs (S18, S22).
- Web/sidecar UX (S19, S20). Anthropic translation is not a pilot
  acceptance suite.
- Privacy assertions (S21, S22).
- Paid-traffic gate (S23).
- Benchmarks (S24–S31).
- Activation program (S32).
- Archive and release (S33, S34).

## Benchmarks

Record numeric fixtures, not slogans.

| Benchmark | Pass rule | Task |
| --- | --- | --- |
| Proof latency | Founder p95 ≤ 2.0s hot prove time; partner dry-run and soak p95 ≤ written accepted proving latency, never looser than 3.0s; per-attempt abort 10s | B16 |
| Unit economics | Remaining contribution ≥ $8.24 normal and ≥ $2.55 two-dispatch worst case at class ceilings; caps halt new checkout | B14 |
| Load | Concurrent exact retries coalesce; conflicting signals fail closed; one `fullProve` per sidecar process | B15 |
| Storage growth | Evidence vault ≤ 250 first-transcripts/bundle; replay 1 MiB × 24h; first-transcript retention expiry+7d then delete | B17 |
| Claim store | Unique (nullifier, signal) reservations; fencing generation; no slot consume on cancel or proof failure | B18 |
| Event cursor | Slash revocation of remaining slots before cursor advance; finalized-root lag alarm | B19 |
| Slashing path | Restored algebra; no live 402; 50/50; terminal exclusivity | B20 |

## Manual and external evidence

- Independent cryptographic review of the restored statement and implemented
  artifacts (S23).
- Real Base Sepolia verifier+adapter (S23): obtained 2026-09-21 and recorded in
  [Base Sepolia B11 evidence](#base-sepolia-b11-evidence-2026-09-21).
- Partner-written accepted proving latency before first paid claim (S25).
- Interview notes plus pointer, not full transcripts (S32).
- Dated written renewal intent at live SKU (S32).

Do not claim these from local mocks.
