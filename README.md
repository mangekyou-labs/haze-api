# zk-credits

Invite-only, experimental pilot on Base Sepolia (`eip155:84532`) for private
prepaid API credits with the custom x402 v2 `zk-prepaid` scheme. Product calls
use founder-provisioned test credits and have no product payment step.

- **Access is invite-only.** A founder issues a single-use invite bound to one
  GitHub account. There is no open registration.
- **External research sessions are compensated.** Slots A and C receive a
  fixed $25 honorarium for a 30-minute session regardless of setup success.
  This is not product revenue or willingness-to-pay evidence; measure product
  payment intent separately.
- **Everything is experimental and testnet-only.** The circuit has not been
  independently audited, and none of this is production software.

## Supported clients

The pilot serves one spend path: non-streaming `POST /v1/chat/completions`
through the project sidecar, or an x402-native agent that explicitly registers
the project's versioned `zk-prepaid` adapter.

The deployed resource server advertises exactly one capability at
`/supported`:

| Field | Value |
| --- | --- |
| x402 version | `2` |
| scheme | `zk-prepaid` |
| network | `eip155:84532` (Base Sepolia) |
| asset transfer method | `prepaid-claim` |
| payment flow | `escrow` |

Not supported: generic x402 clients, unmodified agents, public facilitators,
Bazaar, MCP, the standard `exact` rail, and any production or audited-privacy
claim. A generic x402 client that does not register the adapter fails closed
with an unsupported-scheme result.

The local sidecar includes a narrow Codex Responses bridge: supported text and
function-tool requests translate to the fixed non-streaming Chat Completions
service class, then return as Responses events. This is not a general Responses
gateway. For a first-use walkthrough see
[`docs/onboarding/base-zk-credits-codex-first-use.md`](docs/onboarding/base-zk-credits-codex-first-use.md);
x402 operators can use
[`docs/onboarding/base-zk-credits-x402-agent.md`](docs/onboarding/base-zk-credits-x402-agent.md).

See `packages/zk-credits-sidecar/README.md` for the supported client install
path and `packages/x402-zk-prepaid/README.md` for adapter registration.

## Run the local services

```sh
cd ts && npm ci && npm run typecheck && cd ..
cd web && npm ci && npm run typecheck && cd ..
cd packages/x402-zk-prepaid && npm ci && npm test -- --run && cd ../..
cd packages/zk-credits-sidecar && npm ci && npm test -- --run && cd ../..
```

The gateway needs `OPENROUTER_API_KEY` and a configured Base contract/verifying
key in a real environment. Its local fallback claim store is for development;
pilot runs use the isolated `spend_plane.claims` Postgres table.

## Operating the pilot

Three endpoints carry the operational surface:

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness. Never depends on a downstream dependency |
| `GET /ready` | none | Postgres, Base root freshness and lag, verifier assets, provider configuration, and launch state |
| `GET /v1/admin/status` | `BILLING_INTERNAL_TOKEN` | Aggregate counters, spend and headroom, claim counts, Base lag |

A kill switch and provider-spend caps are durable Postgres state, so a restart
cannot clear a pause or reset spend:

```sh
cd ts
npm run launch:status
npm run launch:pause -- --reason "provider incident"
npm run launch:resume
```

While paused, inference and invite funding return `503 pilot_paused` and
consume no credit; health, readiness, and the recovery paths stay reachable.
Provider spend is bounded by a per-UTC-day cap and a longer rolling-window
cap, and exhausting either cap pauses the pilot for operator review. The exact
limits, the release matrix, and the `Deploy Smoke` probes are recorded in
`docs/ai/deployment/2026-09-18-feature-base-zk-credits.md`.

## Provisioning and activating

The founder launch wizard, internal demo wizard, and operator wizard cover
separate steps of the rollout:

| Wizard | Runs on | Captures |
| --- | --- | --- |
| `scripts/launch-wizard.sh` | the founder's machine | infrastructure values into `.env.launch.local` |
| `scripts/operator-wizard.sh` | each operator's machine | local values into `.env.operator.local` |
| `scripts/founder-demo-wizard.sh` | the founder's machine | redacted record of the uncounted Base Sepolia demo |

The launch and operator wizards source `scripts/launch-guardrails.sh`, which
refuses operator variables in the launch env and deployer, sponsor, database,
admin-token, and provider variables in the operator env, and refuses to write
into a tracked, unignored, or world-readable file. `bash scripts/guardrails.test.sh`
exercises those boundaries. The founder demo wizard runs before external
launch and records the demo as internal and uncounted. Follow the
[founder demo walkthrough](docs/onboarding/base-zk-credits-founder-demo.md)
for the reviewed candidate, exchange checks, and safe recording.

The launch env is the only place infrastructure secrets live. The refund and
treasury vault is configured **by address**; its private key is never supplied
to a script. Each operator creates and keeps their own credential, password,
and proving artifacts; the project team never handles them.

## Activating an operator

One slot per operator, assigned once:

| Slot | Participant | Integration |
| --- | --- | --- |
| A | External Codex developer | Codex through the local sidecar |
| B | Founder | Founder task-running x402 agent and adapter |
| C | External x402 operator | Their own agent and the adapter |

Slots A and C are the only market-validation participants. B is a technical
activation only. Run A first; its qualifying activation starts the 14-day UTC
window. Run a fresh B after A, then C. Each counted exchange has exactly one
discarded warm-up and one custom `zk-prepaid` task call. Continue only when
both A and C make a real call on another calendar day and show credible
product payment intent before the window closes. A five-minute human-action
target applies to first use; longer setup is recorded as friction, not a
protocol failure.

External sessions last 30 minutes and receive the fixed $25 honorarium even
when setup or the call fails. Keep that research payment separate from product
revenue and payment intent.

The founder drives the four commands below: the first prewarms the free
instance, requires a fully ready `/ready`, records the baseline aggregate
committed-claim count, and issues exactly one invite. The last validates the
operator's redacted bundle, re-reads aggregate status, and confirms the
committed count increased across the window — comparing two global integers,
so no read creates an identifier join.

```sh
cd ts
npm run activation:start    -- --slot A --github-id <github account id>
npm run activation:assist   -- --slot A
npm run activation:evidence -- --slot A --file <redacted bundle>
npm run activation:status
```

The evidence bundle is a fixed vocabulary: an enum, a pinned version, an ISO
timestamp, or a bounded integer. It has no field wide enough to hold a prompt,
a response, a proof, a public signal, a nullifier, an invite or funding token,
a credential identifier, an identity, a remaining balance, or a spend-plane
identifier. `ts/activation-evidence.ts` holds the schema and the privacy
denylist; only a bundle that validates may be committed.

The redacted bundle contains no prompts, responses, credentials, proofs,
nullifiers, request signals, or identity-to-spend joins. For valid spends, the
payment proof is designed for payer and credential unlinkability. The model
provider still receives each request, and the gateway and provider can observe
request content and traffic metadata.

## Local credential proxy

The sidecar reads an encrypted browser export and generates the BN254 Groth16
proof locally. It then follows x402 v2 over the gateway:

```sh
npm install --global zk-credits@0.2.7
export ZK_CREDITS_CREDENTIAL_PATH="$HOME/Downloads/zk-credits-credential.json"
export ZK_CREDITS_GATEWAY_URL="https://zk-credits-gateway.onrender.com"
export BASE_RPC_URL="https://sepolia.base.org"
zk-credits setup codex
```

Setup prompts for the credential backup password without echo. Before the
session, the founder grants access to the pinned proving-bundle repository
`mangekyou-labs/zk-credits-base-sepolia-v2-bundle`. Codex checks local GitHub
CLI authentication and repository access, installs the pinned release,
downloads and verifies the bundle, and runs local setup. The human handles
GitHub sign-in if needed, enters the recovery password locally, gives consent,
and chooses their own task. See the one-instruction
[Codex first-use guide](docs/onboarding/base-zk-credits-codex-first-use.md).
Setup downloads the immutable release pinned in
`packages/zk-credits-sidecar/circuits/manifest.json`,
checks its release identity and file digests, synchronizes the V2 witness from
public Base events, and asks the gateway to recognize the resulting root. The
bundle, witness, and event cache stay on the local machine; V2 setup does not
accept a manually supplied witness file.

`POST /v1/chat/completions` is protected by the experimental custom x402
scheme `zk-prepaid`. A missing or stale `PAYMENT-SIGNATURE` receives a 402
with base64 `PAYMENT-REQUIRED`; the sidecar retries with a proof-bound
signature. Settlement is a durable escrow claim, not a per-request chain
transaction, so `PAYMENT-RESPONSE.transaction` is intentionally empty.

The reusable implementation is in `packages/x402-zk-prepaid/`. The sidecar
exports `createLocalX402Agent` from `zk-credits/x402`, so an operator can use
the same local proof engine, request-aware adapter, and authenticated local
aggregate metrics in their own agent. `zk-credits x402-agent` is a small
task-running starter for founder demos and local rehearsal; slot C integrates
the adapter into their own agent. It is not
automatically supported by generic x402 clients: integrations must register
this custom scheme and use the published requirements/payload format. See
`docs/ai/design/2026-09-18-feature-base-zk-credits.md` for the protocol
boundary and security model.

## Contract and circuits

The immutable `PrivateCreditBond` contract is under `contracts/src/` and the
BN254 circuit is `circuits/private_credit_spend.circom`. No deployment is
performed by tests. Use the configuration-only wizard and checkpointed
launcher for Base Sepolia; they collect the reviewed USDC, sponsor, refund
vault, treasury, keystore, and deployment-domain inputs before any operator
command is shown:

```sh
(cd contracts && FOUNDRY_OFFLINE=true forge test)
scripts/launch-wizard.sh
scripts/launch-pilot.sh --check
```

The launcher runs a no-broadcast simulation, predicts Poseidon T2/T3/T4 and
`PrivateCreditBond`, and requires fresh human authorization before displaying
the dotenv-wrapped, keystore-backed broadcast command. It never handles or
prints the password, runs the broadcast, or treats bond address/block values as
wizard inputs. Resume reconciliation and post-deploy immutable/root checks
must complete before the launcher writes deployment outputs; explorer
verification is independent and retryable.

The sponsor funds the Base Sepolia USDC bond for each pilot credential;
participants never deposit funds. Mainnet is blocked until an external
contract/circuit audit, a production Groth16 ceremony, legal and payment-risk
review, protected keys, monitoring, and recovery drills are complete.

## Privacy and product boundaries

- Pilot telemetry does not collect prompts, responses, secrets, proofs,
  nullifiers, request signals, or payer/spend-plane joins.
- The gateway and the upstream inference provider can still observe request
  content and traffic metadata. The pilot does not hide them.
- The credential secret and the recovery password are created and used only in
  the participant's browser and sidecar; the service never receives either.
- The dashboard shows the funded tier, expiry, and chain links; it does not
  show remaining-call counts or usage history.
- Encrypted response replays are retained for 24 hours. A buffered provider
  response above 1 MiB is refused before the claim is committed.
- Two settled transcripts that share a nullifier and differ in request signal
  recover the secret and settle the sponsor-funded bond. The pilot uses test
  assets on Base Sepolia.

The former Stellar/Soroban implementation is retained under `archive/stellar/`
and historical documentation only. It is not part of the active runtime.

## License

AGPL-3.0-or-later. See `LICENSE`.
