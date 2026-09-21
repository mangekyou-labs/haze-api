# zk-credits

Loopback sidecar that attaches a hash-pinned BN254 Groth16 proof to each
coding-agent LLM request through the experimental x402 `zk-prepaid` scheme.
Built for the invite-only, unpaid, experimental Base Sepolia pilot; credits
are founder-provisioned test credits, and the circuit is not independently
audited.

```bash
npm install --global zk-credits
```

## First run

1. Redeem an invite to the unpaid, experimental Base Sepolia pilot and
   download the password-encrypted credential backup. Credits are
   founder-provisioned test credits; there is no payment step.
2. Install the pinned proving artifacts. The package ships
   `circuits/manifest.json`, which fixes the SHA-256 of the frozen
   `private_credit_spend.wasm`, `private_credit_spend.zkey`, and
   `verification_key_private_credit.json`. The bytes are installed out of
   band; the sidecar never fetches proving material at runtime:

   ```bash
   export ZK_CREDITS_ARTIFACT_DIR="$PWD/private-credit-bundle"
   ls "$ZK_CREDITS_ARTIFACT_DIR"   # the three pinned files
   ```

   A missing, relocated, symlinked-out, or altered artifact fails closed
   before the first prove. A hash mismatch is a proof failure: no payment
   leaves, and the local slot stays reusable.

3. Configure the credential and a witness source:

   ```bash
   export ZK_CREDITS_CREDENTIAL_PATH="$PWD/credential.json"
   export ZK_CREDITS_CREDENTIAL_PASSWORD='use-a-long-local-password'
   ```

   Set `ZK_CREDITS_WITNESS_PATH` to a local witness artifact — either a
   prepared witness (`root`, `pathElements`, `pathIndices`) or a public tree
   (`leaves: [{ index, leaf, expiry? }]`, optional `root`) from which the
   sidecar derives the depth-20 path — or configure `BASE_RPC_URL`,
   `BASE_PRIVATE_CREDIT_BOND_ADDRESS`, and optionally
   `BASE_DEPLOYMENT_BLOCK` so the sidecar synchronizes public `BundleFunded`
   events and builds a local Merkle witness. The gateway never serves a path
   for a named leaf or commitment.

4. Run:

   ```bash
   zk-credits cline "summarize this repository"
   zk-credits setup codex && zk-credits codex "summarize this repository"
   ```

The sidecar binds `127.0.0.1:3210` only. It does not modify `~/.cline` or
`~/.codex`.

## Supported route

The pilot serves one spend path: non-streaming `POST /v1/chat/completions`
on the loopback listener, either through this sidecar (the supported
OpenAI-compatible client) or through an x402-native agent that explicitly
registers the project `zk-prepaid` adapter. Generic x402 clients, unmodified
agents, public facilitators, Bazaar, MCP, and the standard `exact` rail are
unsupported; the sidecar never falls back to another rail.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness for the local launcher |
| `GET /v1/models` | local token | Codex model discovery |
| `GET /metrics` | local token | Aggregate proof metrics (below) |
| `POST /v1/chat/completions` | local token | The only proving and spend path |

`/v1/responses`, Anthropic `/v1/messages`, streaming bodies (`stream`,
`stream_options`), and a missing `model` are rejected with a `4xx` before any
proof is attempted. Unknown paths return `404 unsupported_openai_path`. The
sidecar never substitutes a model and never falls back to another rail.

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
zk-credits serve [--port <port>]
eval "$(zk-credits env)"
```

Codex SDK:

```ts
import { buildCodexSdkOptions, buildCodexThreadOptions } from 'zk-credits/codex';
```

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
