# Base ZK Credits: Codex first use

For invited operators on Base Sepolia. The target is five minutes of active
human setup, including obtaining an RPC endpoint and OS access approvals.
Record unattended downloads, installation, proof, and provider waits separately.
External research participants receive a fixed $25 research honorarium for a
30-minute session even if setup fails. This is separate from product payment.

## Before setup

Obtain **your own Base Sepolia RPC endpoint (chain ID 84532)** from a
[Base node provider](https://docs.base.org/base-chain/node-operators/node-providers).
Choose Base Sepolia in the provider dashboard and copy its HTTP endpoint into
the local hidden prompt described below. Keep API keys out of chat and evidence.
Public Base endpoints are rate-limited; setup does not silently select one.

Sign in with GitHub on the website and redeem your invite. Download the
passwordless recovery file and re-import it locally before funding. Anyone
possessing the file can spend its credits. Keep it private. Fund your pilot
credential, then download the activated credential. No credential password is
created or entered. Files and secrets are never uploaded to the service.

## Release availability

The current published `zk-credits@0.2.8` does **not** implement this passwordless
journey. Use the reviewed local package for development acceptance until the
owner publishes and pins the implementation release here. Publication is an
owner action. Do not install an unpinned latest package to claim acceptance.
The new package includes its pinned proving archive; private GitHub repository
access and GitHub CLI authentication are not setup prerequisites.

## Give Codex this one instruction

Give only the activated credential's local path and the reviewed package path.

```text
Set up my invited Base Sepolia zk-credits pilot with the reviewed local package.
Before setup, guide me to obtain my own Base Sepolia RPC endpoint (chain ID
84532), then run `zk-credits config rpc` and let me paste it into the hidden
local prompt. Do not print its URL or API key. Set ZK_CREDITS_CREDENTIAL_PATH
to my downloaded activated credential's path and ZK_CREDITS_GATEWAY_URL to
https://zk-credits-gateway.onrender.com. Run `zk-credits setup codex`.
Confirm setup verified the packaged archive and artifact hashes, synchronized the public Base witness, and checked its known root with the gateway. Import
my credential into OS secure storage; fail clearly if storage is unavailable.
Do not show my credential or secret in chat/logs or make a model request during
setup. Stop after reporting setup checks so I can review consent and choose
my own task. OS storage approval may be needed; no credential password is needed.
```

After successful import, the downloaded file is a recovery backup. Runtime reads
OS storage; subsequent launches and restarts need no credential password.
Legacy encrypted exports require the explicit `--legacy` setup option and their
original password in the local hidden prompt.

## Change the RPC later

Run `zk-credits config rpc` anytime, including before setup. It validates
connectivity and chain ID and stores the endpoint with owner-only access.
`BASE_RPC_URL` overrides saved settings. A running sidecar keeps its current
endpoint: stop that process, then run `zk-credits serve` or `zk-credits codex`
to use the updated setting. Configuration does not unlock a credential.

## First call

Review consent and choose your own coding task. Run `zk-credits codex`.
A counted activation requires a committed call from your agent loop; warm-ups,
retries and smoke calls do not count. Record failed checkpoints, assistance,
active human seconds and unattended waits. Automation is technical evidence,
not independent external market validation. Share only redacted aggregate
measurements: exclude RPC keys, files, secrets, request text, proofs, nullifiers,
request signals and identity-to-spend joins.

For valid spends, the proof is designed for payer and credential unlinkability.
The model provider receives requests; the gateway and provider can observe
content and traffic metadata. The circuit is experimental and not independently
audited. Generic unmodified x402 clients are unsupported. Codex's local Responses
bridge supports only the bounded text/function-tool service class.
