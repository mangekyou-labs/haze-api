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

The founder grants access to the private proving-bundle repository and sends a
prepared invite before the session. Check local GitHub CLI authentication and
repository access, install the pinned package, and run setup:

```sh
gh auth status
gh repo view mangekyou-labs/zk-credits-base-sepolia-v2-bundle
npm install --global zk-credits@0.2.7
zk-credits setup codex
```

Setup downloads the immutable proving release identified by the package
manifest, verifies its archive and artifact hashes, synchronizes the public
Base witness, and checks that the gateway knows the resulting root. It prompts
for the recovery password in a hidden local terminal prompt and stores only
owner-readable local configuration. Never put the password in an environment
variable, command argument, chat, log, or project file.

`setup codex` is the existing local setup command; it does not require you to
use Codex. The package's `zk-credits/x402` entry exposes the same local proof
engine and request-aware `zk-prepaid` client for an x402-native agent.

## Integrate your own agent

The runtime decrypts the local credential in memory, loads the pinned proof
artifacts and public witness, and registers the project adapter. Pass the real
request URL, method, and body to `client.fetch`; those request values are
bound into the payment proof. The model service remains the same bounded,
non-streaming chat completion class.

```ts
import { createLocalX402Agent } from 'zk-credits/x402';

// Read this from a hidden local prompt or your own local secret provider.
// Do not source it from an environment variable or command-line argument.
const credentialPassword = await readCredentialPasswordLocally();
const runtime = await createLocalX402Agent({ credentialPassword });

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
  const result = await response.json();
  await showResultLocally(result);
} finally {
  await runtime.close();
}
```

`readCredentialPasswordLocally`, `taskChosenByTheOperator`, and
`showResultLocally` are your agent's existing local prompt, task, and display
functions. Keep the password in process memory only. Never send a participant's
prompt or response to the founder as activation evidence.

The included task-running starter for the founder, and for a local rehearsal,
keeps one runtime alive for the discarded warm-up and counted task:

```sh
zk-credits x402-agent
```

It asks for the recovery password through a hidden prompt, then asks for one
task at a time. Each task can spend one test credit. `:quit` closes the local
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
