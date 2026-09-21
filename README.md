# zk-credits

Invite-only, unpaid, experimental pilot on Base Sepolia (`eip155:84532`) for
private prepaid API credits with the custom x402 v2 `zk-prepaid` scheme.

- **Access is invite-only.** A founder issues a single-use invite bound to one
  GitHub account. There is no open registration.
- **The pilot is unpaid.** Every credential receives founder-provisioned test
  credits. There is no payment step, no card or wallet flow, no paid plan, no
  plan selection, and no recurring charge.
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

## Local credential proxy

The sidecar reads an encrypted browser export and generates the BN254 Groth16
proof locally. It then follows x402 v2 over the gateway:

```sh
export ZK_CREDITS_CREDENTIAL_PATH=/path/to/credential.zkcred
export ZK_CREDITS_CREDENTIAL_PASSWORD='use-a-local-secret'
export ZK_CREDITS_ARTIFACT_DIR=/path/to/pinned-artifacts
export ZK_CREDITS_WITNESS_PATH=/path/to/witness.json
zk-credits serve --gateway http://127.0.0.1:3001 --port 3210
```

`ZK_CREDITS_ARTIFACT_DIR` holds the frozen proving artifacts whose SHA-256
digests are pinned in `packages/zk-credits-sidecar/circuits/manifest.json`.
The bytes are installed out of band; a missing, relocated, or altered
artifact fails closed before any prove.

`POST /v1/chat/completions` is protected by the experimental custom x402
scheme `zk-prepaid`. A missing or stale `PAYMENT-SIGNATURE` receives a 402
with base64 `PAYMENT-REQUIRED`; the sidecar retries with a proof-bound
signature. Settlement is a durable escrow claim, not a per-request chain
transaction, so `PAYMENT-RESPONSE.transaction` is intentionally empty.

The reusable implementation is in `packages/x402-zk-prepaid/`. It is not
automatically supported by generic x402 clients: integrations must register
this custom scheme and use the published requirements/payload format. See
`docs/ai/design/2026-09-18-feature-base-zk-credits.md` for the protocol
boundary and security model.

## Contract and circuits

The immutable `PrivateCreditBond` contract is under `contracts/src/` and the
BN254 circuit is `circuits/private_credit_spend.circom`. No deployment is
performed by tests. Use the Base Sepolia deployment script only after setting
the reviewed USDC, sponsor, refund vault, treasury, Poseidon, verifier, and
deployment-domain addresses:

```sh
cd contracts
FOUNDRY_OFFLINE=true forge test
forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url "$BASE_RPC_URL" --broadcast --verify
```

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
