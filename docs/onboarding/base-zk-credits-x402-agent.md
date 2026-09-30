# Base ZK Credits: integrate your x402 agent

This guide is for slots B and C. Slot B is the founder's starter agent and
counts as a technical activation. Slot C is an external operator integrating
the adapter into their own agent; C counts toward market validation.

External participants receive a fixed **$25 research honorarium for a
30-minute session**, whether setup or the call succeeds. It is research
compensation, not product revenue or willingness-to-pay evidence. The product
call uses founder-provisioned Base Sepolia test credits and has no product
payment step.

## Local setup

The parent PRD now requires passwordless recovery, OS credential storage,
explicit operator-owned Base Sepolia RPC configuration, and packaged proving
artifacts. Website onboarding, `zk-credits config rpc`, and packaged artifact
delivery are tracked in **Codex developer first use: invite to first call**.
They are not implemented by the published `zk-credits@0.2.7` package. Do not
use that release as a fresh passwordless setup acceptance run. Publication of
the implementation release remains an owner action.

In this checkout, the x402 runtime loads an activated credential from OS secure
storage. macOS uses Keychain, Windows uses Credential Manager, and Linux requires
persistent Secret Service and an unlocked user session.
The OS may ask for credential-store access approval. Unsupported platforms,
missing tools, denied access, or missing entries stop the launch; there is no
plaintext runtime fallback.

The shared onboarding command imports the version-3 passwordless activated
credential downloaded after funding into OS storage:

```sh
zk-credits setup codex
```

Anyone possessing the downloaded file can spend its credits. Keep it private
and never upload it. Setup verifies the secret against the commitment; a
pre-funding recovery file is not an activated credential. Entries are scoped
to `ZK_CREDITS_HOME` (default `~/.zk-credits`).

Existing encrypted exports use the explicit legacy path:

```sh
zk-credits setup codex --legacy
```

Only this legacy import asks for the original password, using a hidden local
prompt. Later x402 launches do not ask for it. Never put the password in an
environment variable, command argument, chat, log, or project file.

Until the first-use dependency lands, existing installations still need their
verified pinned proving artifacts and public witness configuration. Published 0.2.7’s
`setup codex` path uses private repository access and password prompts; it is
not the new passwordless setup path. Configure your own Base Sepolia RPC
endpoint locally and keep embedded API keys out of evidence. A fresh run
against the real gateway remains an acceptance requirement after those setup
prerequisites are delivered.

The package's `zk-credits/x402` entry exposes the existing local proof engine
and request-aware `zk-prepaid` client for an x402-native agent.

## Integrate your own agent

The runtime loads the OS-stored credential in memory, loads the pinned proof
artifacts and public witness, and registers the project adapter. Pass the real
request URL, method, and body to `client.fetch`; those request values are
bound into the payment proof. The model service remains the same bounded,
non-streaming chat completion class.

```ts
import { createLocalX402Agent } from 'zk-credits/x402';

const runtime = await createLocalX402Agent();

try {
  const response = await runtime.client.fetch(
    'https://zk-credits-gateway.onrender.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: taskChosenByTheOperator }],
      }),
    },
  );
  if (!response.ok) throw new Error(`Task failed with HTTP ${response.status}`);
  const result = await response.json();
  await showResultLocally(result);
} finally {
  await runtime.close();
}
```

`taskChosenByTheOperator` and `showResultLocally` are your agent's existing
task and display functions. Never send a participant's
prompt or response to the founder as activation evidence.

The included task-running starter for the founder, and for a local rehearsal,
keeps one runtime alive for the discarded warm-up and counted task:

```sh
zk-credits x402-agent
```

It loads the credential from OS storage, then asks for one task at a time. Each task can spend one test credit. `:quit` closes the local
runtime. Slot C must use their own agent integration rather than this starter.

## Local metrics and qualification

The runtime exposes only authenticated aggregate proof and exchange counters
on loopback at the printed `runtime.metricsUrl`. The owner-only token is stored
under `~/.zk-credits/loopback-token`. Do not share the token or expose this
endpoint outside loopback. Use one fresh runtime for exactly one discarded
cold warm-up and one counted custom task. The counted exchange must complete
local proof self-check, send `PAYMENT-SIGNATURE`, settle through the facilitator,
receive `PAYMENT-RESPONSE`, and create the expected two-claim aggregate gateway
delta. Do not make other calls between snapshots.

Measure active human action from the first setup instruction through the first
counted call. Pause during unattended downloads, proof generation, and model
response wait. More than five minutes is a friction finding, not a protocol
failure.

For valid spends, the proof is designed for payer and credential unlinkability.
The model provider still receives the request and can observe request content
and traffic metadata. The circuit is experimental and not independently
audited. Generic unmodified x402 clients are unsupported; the agent must
deliberately register and call the project adapter.

Only the operator's redacted activation bundle leaves the machine. It carries
aggregate snapshots and bounded setup measurements. It contains no prompts,
responses, credentials, proofs, nullifiers, request signals, or identity-to-
spend join. The $25 research payment is kept separate from product intent.
