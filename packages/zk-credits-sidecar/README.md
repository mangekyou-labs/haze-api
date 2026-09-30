> The updated pilot PRD requires passwordless first use. The source x402
> runtime now uses OS credential storage; see
> [the x402 guide](../../docs/onboarding/base-zk-credits-x402-agent.md).
> The setup instructions below describe the legacy encrypted/private-bundle
> path. Published 0.2.7 does not implement the new onboarding requirements.

# zk-credits

Loopback sidecar that attaches a hash-pinned BN254 Groth16 proof to each
coding-agent LLM request through the experimental x402 `zk-prepaid` scheme.
Built for the invite-only experimental Base Sepolia pilot. Product calls use
founder-provisioned test credits and have no product payment step; the circuit
is not independently audited. External research participants in slots A and C
receive $25 for a 30-minute session regardless of setup success. That payment
is not product revenue or willingness-to-pay evidence.

```bash
npm install --global zk-credits@0.2.7
```

## Pinned pilot versions

The pilot supports exactly these versions. Do not substitute another, and do
not mix versions between the sidecar, the adapter package, and the gateway:

| Package | Version |
| --- | --- |
| `zk-credits` (this sidecar) | `0.2.7` |
| `@zk-credits/x402-zk-prepaid` (adapter) | `0.1.0` |
| `@zk-credits/shared` | `0.1.0` |

The pinned Base Sepolia trial version is `0.2.7`. It uses the non-streaming
`POST /v1/chat/completions` path below, includes the narrow loopback Responses
bridge for supported Codex text and function-tool requests, and acquires the
pinned private proving bundle through the local GitHub CLI session. It also
synchronizes V2 Base events and checks the gateway known root before local
setup completes. The proving artifacts are available only from the private
immutable release pinned by `circuits/manifest.json`.

Verify the shipped artifacts before your first prove. The package's
`circuits/manifest.json` fixes the SHA-256 of the frozen
`private_credit_spend.wasm`, `private_credit_spend.zkey`, and
`verification_key_private_credit.json`; compute the digest of each delivered
file and compare it to the manifest. A mismatch is a proof failure, and the
sidecar refuses to prove rather than sending a payment. The founder compares
the same digests against the delivered set before inviting you.

## What one credit buys

One credit buys one successfully committed response from the single service
class `coding-deepseek-v4-flash-v1` (`deepseek/deepseek-v4-flash`). It is not
an arbitrary API call, and the gateway enforces the class before it reserves
the credit:

- text messages, tool definitions, and tool calls, with one generated choice;
- no provider streaming, images, files, audio, web search, model fallback,
  client-selected routing, or unknown cost-affecting fields;
- input capped at 128,000 UTF-8 byte units (counted conservatively, never below the
  provider's token count), output at 4,000 tokens, request body at 256 KiB,
  encrypted replay at 1 MiB, and upstream timeout at 120 seconds.

The requested `model` field is ignored: the gateway always dispatches the
class model, so an OpenAI-compatible client configured with any model name
still receives the class. A rejected request consumes no credit.

## First run

1. Redeem the founder-prepared invite and download the encrypted V2 credential
   export. The founder grants access to the private bundle repository
   `mangekyou-labs/zk-credits-base-sepolia-v2-bundle` before the session.
2. Give Codex the single setup instruction in the
   [first-use guide](../../docs/onboarding/base-zk-credits-codex-first-use.md).
   Codex checks local GitHub CLI authentication and repository access, installs
   this pinned release, downloads and verifies the bundle, and runs setup.
   The human signs in if needed, enters the recovery password at the hidden
   prompt, gives consent, and chooses their own task. No product payment is
   involved. The sidecar uses the local GitHub CLI session and never receives
   or stores the GitHub token.
3. The setup command sets the credential, gateway, and Base Sepolia RPC
   endpoint:

   ```bash
   export ZK_CREDITS_CREDENTIAL_PATH="$HOME/Downloads/zk-credits-credential.json"
   export ZK_CREDITS_GATEWAY_URL="https://zk-credits-gateway.onrender.com"
   export BASE_RPC_URL="https://sepolia.base.org"
   ```

   `zk-credits setup codex` searches the standard local folders first. If it
   finds no valid bundle, it downloads the pinned release, verifies the
   release id, tag, immutability, archive digest, and all three file digests,
   then atomically installs the bundle under `~/.zk-credits/artifacts` with
   owner-only permissions. Missing GitHub access or any mismatch stops setup.
   It syncs public Base events from the pinned V2 bond and deployment block,
   validates that the resulting witness resolves the activated credential,
   and asks the gateway's public `POST /v1/root-known` endpoint whether the
   resulting root is known. This check sends no admin token and returns only
   `{ "known": boolean }`; the protected admin endpoints remain unavailable
   to setup. The witness and event cache remain local. The package does not
   accept a supplied witness file for this V2 deployment.

   The package ships `circuits/manifest.json`, which fixes the immutable
   release identity, the SHA-256 of the archive and each proving artifact, and
   the V2 Base deployment pins. `BASE_PRIVATE_CREDIT_BOND_ADDRESS` and
   `BASE_DEPLOYMENT_BLOCK` are optional checks; if set, they must match the
   manifest. V2 setup rejects `ZK_CREDITS_WITNESS_PATH` because it builds the
   witness from the pinned public Base events. The local setup config is
   owner-readable only and never stores the credential password. If the RPC
   URL contains a provider key, it remains in that local config file.

   A missing, relocated, symlinked-out, or altered artifact fails closed
   before the first prove. A hash mismatch is a proof failure: no payment
   leaves, and the local slot stays reusable. The gateway never serves a path
   for a named leaf or commitment.

4. Start setup. It verifies the credential, pinned artifact hashes, and
   witness locally, then prompts for the backup password without echo:

   ```bash
   zk-credits setup codex
   ```

   No gateway admin token is required. Then run `zk-credits codex` to open
   Codex with the local sidecar. A/C first-use measurement targets five
   minutes of active human work; unattended download, proving, and provider
   waits are measured separately. More than five minutes is a friction finding.

The sidecar binds `127.0.0.1:3210` only. It does not modify `~/.cline` or
`~/.codex`.

## Supported route

The pilot serves one bounded upstream spend path: non-streaming
`POST /v1/chat/completions`, either through this sidecar or through an
x402-native agent that explicitly registers the project `zk-prepaid` adapter.
The sidecar also accepts Codex `POST /v1/responses` requests with text input
and function tools, translates them to that bounded chat request, and converts
the committed result into Responses SSE events. It rejects unsupported fields
before starting a proof. Generic x402 clients, public facilitators, Bazaar,
MCP, and the standard `exact` rail are unsupported; the sidecar never falls
back to another rail.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness for the local launcher |
| `GET /v1/models` | local token | Codex model discovery |
| `GET /metrics` | local token | Aggregate proof metrics (below) |
| `POST /v1/chat/completions` | local token | The only proving and spend path |
| `POST /v1/responses` | local token | Codex bridge to the bounded chat spend path |

The chat route rejects streaming bodies (`stream`, `stream_options`) and a
missing `model` with a `4xx` before any proof. The Responses route requires
`stream: true`, text-only message/function-call input, and the known Codex
metadata fields; it rejects images, unsupported tools, and unknown controls
before any proof. Its upstream request is always `stream: false`. Anthropic
`/v1/messages` and unknown paths return `404 unsupported_openai_path`. The
sidecar never substitutes a model and never falls back to another rail.

### Gateway responses and retries

| Response | Meaning | What to do |
| --- | --- | --- |
| `402` | No usable authorization, or a stale or invalid one | Re-prove against the fresh challenge |
| `409 claim_already_committed` | Your exact request already succeeded | Read `encryptedReplay` from the response, or fetch it from `POST /x402/replay`; do not re-prove |
| `409 claim_commit_ambiguous` | The commit outcome is unknown | Retry the same request; never re-prove a different one |
| `503 pilot_paused` | The operator paused the pilot | Wait. This is retryable, consumes no credit, and is not a proof failure |
| `503 provider_spend_cap_exhausted` | The provider-spend cap paused the pilot | Wait for the operator to review. No credit was consumed |
| `503 claim_store_unavailable` | Transient gateway fault | Retry with backoff |

The gateway never asks you to re-prove for its own account. A `503` is
retryable and free; a proof failure is local and never reaches the gateway.

## Proof path

- Local artifacts only, hash-pinned against the shipped manifest.
- One prove at a time per sidecar process, in a terminable child-process
  worker with a 10-second deadline. (snarkjs cannot run inside a Node
  `worker_threads` worker: its `web-worker` polyfill re-enters itself there.)
- Every proof is self-verified locally with the pinned verification key
  before `PAYMENT-SIGNATURE` can be emitted, and its six public signals must
  exactly match `[root, timestamp, domain, requestSignal, nullifier, share]`.
- A failed attempt retries with the same slot, request signal, nonce,
  response key, and gateway `issuedAt` while more than ten seconds remain in
  the challenge window.
- A slot is provisional during proving and recorded in the durable local
  ledger (`$ZK_CREDITS_HOME/base-slots.json`) only after self-verification.
  Proof misses, timeouts, hash failures, and verification failures release
  it.

## `GET /metrics`

Aggregate only, authenticated with the same local token:

```json
{
  "attempts": 12,
  "successes": 11,
  "failures": 1,
  "retries": 1,
  "failuresByCategory": { "timeout": 1, "artifact_hash_mismatch": 0, "...": 0 },
  "hotProve": { "samples": 11, "p50Ms": 1180.4, "p95Ms": 1902.7 },
  "updatedAt": "2026-09-20T14:00:00.000Z"
}
```

The first prove in a process is the cold sample and is excluded from the hot
percentiles. Proofs, public signals, nullifiers, credentials, requests, and
any identifying label are never recorded or exposed.

## Commands

```
zk-credits cline [cline arguments...]
zk-credits setup codex [--model <model>]
zk-credits codex [codex arguments...]
zk-credits status
zk-credits serve [--port <port>] [--internal-trial-one-proof]
zk-credits x402-agent
zk-credits founder-demo-agent
zk-credits trial-registered-adapter
eval "$(zk-credits env)"
```

`serve --internal-trial-one-proof` is an opt-in maintainer mode for the
internal Base Sepolia trial. During that process lifetime, one authenticated,
valid spend request may reach the prepaid transport and the proof factory may
attempt one proof. A later valid request receives HTTP 409 with
`internal_trial_limit_reached`; ordinary `serve` behavior is unchanged without
the flag.

`trial-registered-adapter` is a maintainer-only internal trial command. It
requires the locally recovered credential and pinned proving bundle, prompts
for the credential password and gateway admin token without echo when they are
not already configured, and requires an explicit confirmation before sending
one billable request. It checks gateway readiness, authenticated admin status,
Base root agreement, Codex profile/sidecar status, and remaining local slot
capacity, then reports only the exchange phases and aggregate counter deltas.
Run it only after recovery is complete and with the same `ZK_CREDITS_HOME`
used by the sidecar; it registers `zk-prepaid` directly through the official
x402 client adapter and reuses the durable slot ledger.

Codex SDK:

```ts
import { buildCodexSdkOptions, buildCodexThreadOptions } from 'zk-credits/codex';
```

`zk-credits/x402` exports `createLocalX402Agent` for an operator who is
integrating the adapter into their own x402 agent. It loads the same local
credential, pinned proof artifacts, public witness, proof engine, and slot
ledger used by the sidecar. The request-aware client binds the actual method,
URL, and body into each spend; its metrics endpoint exposes authenticated
aggregate counters on loopback. See
[`docs/onboarding/base-zk-credits-x402-agent.md`](../../docs/onboarding/base-zk-credits-x402-agent.md)
for integration and measured-call steps. The included `zk-credits x402-agent`
command is a small task-running starter for the founder demo and local
rehearsal; external slot C uses their own agent.

The credential secret is decrypted only in local memory. The sidecar cache
contains public Base event leaves and never stores the secret, prompt, response,
proof, account, or wallet.

## Validation

```bash
npm test                                      # unit + fixture suites
npm run build                                 # tsc + bundled CLI
ZK_CREDITS_ARTIFACT_DIR="$PWD/circuits/artifacts" \
  npx vitest run pinned-artifacts             # opt-in real fullProve + self-verify
```

The opt-in artifact test needs an installed bundle and the built
`dist/proof-child.js`. CI stays deterministic through injected worker and
crypto fixtures; the default suites stay green with no bundle installed.

Base Sepolia only. The circuit is experimental and not independently audited.
Development proving material is not suitable for mainnet; the repository's
release gates require an audited production circuit and ceremony.
