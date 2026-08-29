# Proof-Aware OpenAI Sidecar

**Date:** 2026-08-11
**Status:** Implemented; extended by `2026-08-11-codex-companion-design.md`
**Scope:** First-party local sidecar and Render gateway extensions for proof-backed OpenAI-compatible calls.

## Goal

Let a developer configure any client that accepts an OpenAI-compatible base URL to call ZK Credits with no per-request application changes. The client sends an ordinary request to a loopback endpoint; the sidecar produces a fresh, request-bound, indexed-ticket ZK proof and relays the request to the existing Render gateway.

The first release exposes both `POST /v1/chat/completions` and `POST /v1/responses`. It preserves the strongest protocol-level privacy invariant: Render and the upstream provider never receive `secret_k`, a mnemonic, a commitment-linked bearer, or a stable session token.

## Non-goals

- Do not create a second hosted LLM proxy. Render remains the sole public gateway.
- Do not issue users OpenRouter keys or allow direct OpenRouter calls.
- Do not reuse one proof for multiple requests or introduce a session credential.
- Do not implement Codex support as a plugin, TLS interceptor, or mutation of the user's default profile. Codex integration uses its supported custom model-provider profile.
- Do not attempt network-layer anonymity. This design provides cryptographic unlinkability from deposits and credentials; IP address, timing, and prompt content remain observable by the gateway unless a separate anonymity network is used.

## User experience

Codex CLI users get a one-time setup and one daily command:

```sh
zk-credits setup codex
zk-credits codex
```

The companion starts the loopback server on demand and supplies the random
local bearer through Codex command-backed authentication. Other
OpenAI-compatible clients can use the lower-level flow:

```sh
zk-credits import-mnemonic
zk-credits serve
eval "$(zk-credits env)"
# OPENAI_BASE_URL=http://127.0.0.1:<port>/v1
# OPENAI_API_KEY=zk-local-<random-loopback-token>
```

The sidecar binds only `127.0.0.1` by default. `zk-credits env` emits a random loopback token so another local process cannot silently spend tickets. The token is only local transport authentication and is never sent to Render. The CLI may launch a configured base-URL-compatible agent as a convenience, but the agent never needs to learn ZK details.

`import-mnemonic` accepts the 24-word recovery phrase on a non-echoing terminal and stores the derived identity in the operating system credential store. It never writes the mnemonic to logs, shell history, source-controlled configuration, or the ticket ledger. Headless environments may supply `ZK_CREDITS_MNEMONIC` for the process lifetime only; persistence remains opt-in.

The npm package ships the version-pinned RLN WASM, proving key, verification key, and a SHA-256 manifest. The sidecar verifies the manifest before proving and never downloads executable proving resources at runtime. This keeps the installed component auditable and avoids a mutable third-party circuit download.

## Architecture

```text
OpenAI-compatible client
  Authorization: Bearer zk-local-…
          |
          v
127.0.0.1 ZK Credits sidecar
  identity + ticket ledger + local prover
          |
          | Authorization: Bearer shared compatibility credential
          | X-ZK-Proof: fresh proof bound to the exact canonical body
          v
Render gateway
  verify proof + enforce active root + durable ticket replay handling
          |
          v
OpenRouter /chat/completions or /responses
```

### Sidecar package

Create an independently buildable `packages/zk-credits-sidecar` package with a `zk-credits` executable. It consumes the existing `@zk-credits/shared` package rather than reimplementing hashing, field reduction, proof serialization, or Groth16 self-verification.

The sidecar owns four small components:

1. **Identity store** — imports and retrieves `secret_k` from the OS credential store; computes the deposit commitment locally.
2. **Membership client** — obtains an active public Merkle-tree snapshot from Render, locates the locally computed commitment, derives the authentication path locally, and rejects a snapshot whose root disagrees with the current on-chain root. The request carries no commitment or candidate leaf to Render.
3. **Ticket ledger** — a sidecar-owned, permission-restricted durable ledger serializes ticket reservation. It records `(ticketIndex, canonicalRequestDigest, state)` before proving. An exact retry reuses the reservation; a new request gets the next index. A request that is known to have reached gateway acceptance is consumed only after its response is durably obtainable. Ambiguous failures remain reserved, never silently reused for a different body.
4. **Loopback server** — accepts JSON OpenAI requests, authenticates the local random token, rejects unsupported paths before spending a ticket, locally generates and verifies the proof, and forwards the original body unchanged to Render with `X-ZK-Proof`.

The server supports only loopback addresses. It explicitly rejects public bind addresses unless a future, separately reviewed security mode is introduced.

### Render gateway additions

1. `GET /v1/membership-tree` returns `{ root, depth, leaves, generatedAt }` for the active tree. It accepts no commitment, leaf index, API key, or proof. The sidecar calculates the witness locally from this public snapshot. Render must publish a snapshot that reconstructs exactly to its current root.
2. `POST /v1/responses` applies the same proof parsing, local-root verification, canonical request binding, durable replay logic, settlement enqueueing, and privacy-safe persistence as `/v1/chat/completions`. It passes the original Responses body to OpenRouter’s `/api/v1/responses` endpoint.
3. Refactor the shared authenticated-spend pipeline so Chat Completions and Responses cannot drift in proof validation, idempotency, or persistence behavior.

The existing all-zero browser witness is removed. The dashboard uses the same tree-snapshot/witness module as the sidecar. Membership-removal circuit artifacts are explicitly tracked in source control so CI and deployed browser recovery/withdrawal paths can load them.

### Streaming and replay

Responses and Chat Completions requests with `stream: true` must be treated as paid calls before upstream forwarding. Render relays upstream SSE bytes without transforming event data. It buffers each completed SSE transcript within a bounded, configured limit and stores it against the accepted ticket tuple. An exact retry replays the completed transcript instead of spending or forwarding again.

If a process failure leaves an accepted stream incomplete, the sidecar resubmits the identical JSON body with the same reserved ticket. Render recognizes the same public ticket tuple and returns either the completed replay transcript or `202` while the original accepted call remains unresolved. The sidecar retries with bounded backoff and never uses that ticket for a different request. Bounded response size and expiry controls prevent the replay store from becoming an unbounded transcript archive.

## Privacy and security rules

- `secret_k`, mnemonic, private ticket index, and local loopback token never leave the user machine.
- The public gateway bearer is shared compatibility metadata only; a proof is the authorization.
- Sidecar requests are body-bound using the shared canonical request digest. Any change to a request—including model, tool arguments, or stream flag—requires a new ticket.
- Gateway durable tables remain free of commitment, checkout identity, mnemonic, and local token. They store only public proof signals, request digest, and response/replay data required for idempotency.
- The membership snapshot request must not reveal the caller’s commitment. This avoids creating a direct request-time commitment lookup.
- Each distribution release publishes source, package integrity hash, circuit manifest hash, and reproducible build instructions.

## Compatibility limits

The sidecar is compatible with clients that allow a custom OpenAI-compatible base URL, including standard SDK consumers and agents with `OPENAI_BASE_URL`-style configuration. It exposes the Responses API so it is technically suitable for a client that can point Responses traffic at it.

Codex CLI is supported through an isolated custom Responses model-provider profile and command-backed authentication. The companion does not claim that Codex plugins or apps intercept model traffic. Other clients still require a configurable OpenAI-compatible base URL.

## Validation

- Unit-test identity import boundaries, no-secret logging, local-token rejection, ledger serialization, exact retry, and ticket exhaustion.
- Unit-test local witness derivation against trees with at least two active members and root changes.
- Gateway tests prove that Chat Completions and Responses share the same rejection and replay behavior.
- Integration-test non-streaming and SSE forwarding with a mock OpenRouter adapter, including exact stream replay and interrupted-stream recovery.
- End-to-end test a real testnet deposit followed by a sidecar-generated proof-backed Responses request; assert one ticket is consumed and no commitment appears in accepted-call records.
- Run TypeScript checks, package tests, existing gateway/web tests, production builds, and a loopback-only socket test before release.

## Delivery sequence

1. Fix and test membership snapshot/witness derivation, including tracked circuit artifacts.
2. Add and test the shared gateway spend pipeline plus `/v1/responses` and safe streaming replay.
3. Build the sidecar package, credential import, ticket ledger, and loopback server.
4. Publish install/configuration documentation and validate against a base-URL-compatible client.
5. Add the isolated Codex provider profile, automatic sidecar lifecycle, command-backed auth, and clean-install package acceptance described in the companion design.
