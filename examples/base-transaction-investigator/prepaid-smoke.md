# Configured prepaid smoke

No live smoke was run for this handoff. Default SKIP occurs before config,
transport import, OS storage and network. Enabling the gate authorizes at most
one fresh prepaid slot including unknown retirement. Obtain separate owner
consumption authorization; use a dedicated credential and fresh private state.
Existing journals are refused to avoid mistaking recovery for a live smoke.
Unknown exposure is preserved, never retried here. Up to three model requests
and five fresh provisional proof attempts may occur if prior proofs are released;
only one unreleased/retired allocation is permitted.

Private JSON shape (replace all placeholders):

```json
{
  "sourceCommit": "40-lowercase-hex-reviewed-source-commit",
  "transportModule": "/absolute/local-build/dist/local-x402-agent.js",
  "transportSha256": "64-lowercase-hex-entry-module-sha256",
  "stateDir": "/absolute/private/fresh-investigator-state",
  "runtimeOptions": { "stateDirectory": "/absolute/authoritative-credential-state" },
  "policy": {
    "executionDataPaymentChain": 84532,
    "inference": {
      "gateway": "https://YOUR-PINNED-GATEWAY/v1/chat/completions",
      "deploymentDomain": "84532",
      "contract": "PINNED-BOND-CONTRACT",
      "recipient": "PINNED-RECIPIENT",
      "serviceClass": "coding-deepseek-v4-flash-v1",
      "circuit": "PINNED-CIRCUIT",
      "verifyingKey": "PINNED-VERIFYING-KEY",
      "credentialExpiry": 2000000000
    }
  }
}
```

Review and pin complete source/dependency lock and verified artifacts. The hash
checks only the entry module; sourceCommit is an operator assertion, not a full
transitive attestation. Equal version does not establish parity. The module must
expose this source's `prepareLocalX402Agent`. Sidecar setup documents activated
native-store credentials and witness RPC/file. Never publish private config/env.

After approval:

```sh
INVESTIGATOR_AUTHORIZE_PREPAID_CONSUMPTION=yes INVESTIGATOR_SMOKE_CONFIG=/absolute/private/config.json npm run smoke:prepaid --prefix examples/base-transaction-investigator
```

The digest-pinned module is imported directly; its credential lease precedes
journal/ledger access. Existing investigator authorization binds exact bytes and
fixed HTTPS gateway path/POST/class/terms before proof. No trace provider or exact
signer is configured. The transport validates settlement before committed events;
HTTP success alone is insufficient. Output separates execution-data USDC from
allocated/retired/confirmed/unknown inference, with request digests and redacted
commit state; it excludes slot/attempt/reservation identity and prompt contents.

The observer exposes no raw receipt bytes, so validated commit observations
cannot be advertised as independently archived receipt evidence. Save redacted
output and private journal after an authorized run and disclose unknown/refused
outcomes. Default SKIP is not integration success. This cannot establish paid
trace delivery, released-package parity or the future live exact-payment gate.
