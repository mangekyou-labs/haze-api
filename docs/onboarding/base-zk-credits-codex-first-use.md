# Base ZK Credits: Codex first use

This guide is for invited external Codex developers in slot A. The founder
prepares the invite, provisions the Base Sepolia test credential, and grants
read access to `mangekyou-labs/zk-credits-base-sepolia-v2-bundle` before the
session. The target is five minutes of active human setup. Bundle downloads,
installation, proof generation, and model response time are recorded
separately from human action time.

External participants receive a fixed **$25 research honorarium for a
30-minute session**, even if setup or the call fails. It is not product revenue
or evidence of willingness to pay. The product call uses founder-provisioned
Base Sepolia test credits and has no product payment step.

## Give Codex this one instruction

Save the encrypted credential export from the invite flow as
`~/Downloads/zk-credits-credential.json`, then paste this instruction into
Codex in the Haze API repository:

```text
Set up my invited Base Sepolia zk-credits pilot on this machine. First check
`gh auth status` and confirm I can read
`mangekyou-labs/zk-credits-base-sepolia-v2-bundle`. If GitHub CLI sign-in or
repository access is missing, stop and ask me to complete it locally; do not
copy, print, or store a GitHub token. Install exactly `zk-credits@0.2.7` from
npm, then set `ZK_CREDITS_CREDENTIAL_PATH` to
`~/Downloads/zk-credits-credential.json`, set `ZK_CREDITS_GATEWAY_URL` to
`https://zk-credits-gateway.onrender.com`, and set `BASE_RPC_URL` to
`https://sepolia.base.org`. Run `zk-credits setup codex` and wait for me to
enter my recovery password in its hidden local prompt. Confirm that setup
downloaded the immutable bundle pinned in
`packages/zk-credits-sidecar/circuits/manifest.json`, checked every artifact
hash, synchronized the public Base witness, and completed the gateway
known-root check. Do not read or echo my credential export, put my recovery
password in chat, a command argument, an environment variable, or a file, or
make an API request during setup. Stop after reporting local setup checks as
pass or fail; I will review consent and choose my own task before any call.
```

If the invite flow saved the export under a different name, give Codex only
the local file path. Enter the recovery password directly into the hidden
terminal prompt. Never paste the password into Codex or a shell command.

## After setup

1. Read the consent text and confirm that you want to take part.
2. Start the operator wizard with slot `A`:

   ```sh
   scripts/operator-wizard.sh
   ```

3. Follow the wizard's authenticated local counter snapshots. It asks for one
   discarded warm-up call, then one counted call using a task you choose.
   Don't make other calls between snapshots.
4. Record active human action time only. Pause the timer during unattended
   downloads, proof generation, and provider response waits. Time above five
   minutes is a friction finding, not grounds to reject an otherwise valid
   protocol exchange.
5. Send the founder only the generated redacted activation bundle. It contains
   aggregate exchange/proving counters and bounded setup measurements, never
   task text or output.

For valid spends, the proof is designed for payer and credential unlinkability.
The model provider still receives the request, and the gateway and provider
can observe request content and traffic metadata. The circuit is experimental
and not independently audited. Codex's existing `/v1/responses` bridge is
limited to supported text and function-tool requests translated into the
fixed non-streaming `/v1/chat/completions` service class; it is not a general
Responses gateway.

