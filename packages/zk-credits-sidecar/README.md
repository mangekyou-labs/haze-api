# zk-credits

API credits for Codex, Cline, and x402 agents. The local sidecar proves each
spend and forwards your request to the gateway.

Requires Node.js 20 or later. Runs on Base Sepolia.

## Quick start

1. [Activate your credits](https://hazecredits.vercel.app) and download your activated credential.
2. Install the package and configure a Base Sepolia RPC endpoint:

   ```sh
   npm install --global zk-credits
   zk-credits config rpc
   ```

3. Import your credential and connect Codex:

   ```sh
   ZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup codex
   zk-credits codex
   ```

Setup stores your credential in OS secure storage. Keep your recovery file
private: anyone with it can spend your credits.

## Commands

| Command | Purpose |
| --- | --- |
| `zk-credits setup codex` | Import a credential and configure Codex |
| `zk-credits setup x402` | Prepare an x402 agent |
| `zk-credits codex [args...]` | Start Codex with the local sidecar |
| `zk-credits codex --task-evidence` | Run a coding task and show its aggregate payment evidence on exit |
| `zk-credits investigate --chain base <transaction-hash>` | Investigate a failed Base transaction using prepaid inference |
| `zk-credits cline [args...]` | Start Cline with the local sidecar |
| `zk-credits x402-agent` | Run the included x402 agent |
| `zk-credits serve` | Run the sidecar in the foreground |
| `zk-credits doctor` | Inspect the service, PID, setup, RPC source, and log location |
| `zk-credits stop` | Stop the local sidecar |
| `zk-credits status` | Check the Codex configuration and sidecar |
| `zk-credits config rpc` | Save or change your Base Sepolia RPC endpoint |
| `zk-credits --help` | Show command and troubleshooting guidance |

`doctor` and `stop` are available in version 0.2.11. They work before setup.
The default port is `3210`; set `ZK_CREDITS_SIDECAR_PORT` to select another port.
Automatic startup logs are saved to `~/.zk-credits/sidecar.log`, or
`$ZK_CREDITS_HOME/sidecar.log` when set.

## Troubleshooting

**Sidecar stopped or setup missing:** Run `zk-credits doctor`. If setup is
missing, import your activated credential with the setup command above.
Otherwise run `zk-credits serve` and read its output.

**Port occupied or “Server is not running”:** `x402-agent` starts its own local
server. Run `zk-credits stop` before switching from `serve` to `x402-agent`.
For older versions, inspect the listener before stopping it:

```sh
lsof -nP -iTCP:3210 -sTCP:LISTEN
ps -p <PID> -o pid,ppid,etime,command
kill -TERM <PID>
```

Check the PID and command to confirm it is your sidecar. For a foreground
process, press Ctrl+C. `stop` authenticates the service and lets active requests
finish before exit.

**Base witness synchronization failed:** Run `zk-credits config rpc` and enter
a Base Sepolia endpoint (chain ID `84532`). Stop and restart the sidecar, or
retry setup if it failed. `BASE_RPC_URL` overrides the saved endpoint.
A missing funded credential or rejected root can require activation checks;
changing the RPC may not resolve it.

## Clients and privacy

Codex and Cline use the local OpenAI-compatible transport. Your own x402 agent
must register the custom `zk-prepaid` adapter; generic x402 clients do not
support this scheme automatically. See the [x402 integration guide](https://github.com/mangekyou-labs/haze-api/blob/main/docs/onboarding/base-zk-credits-x402-agent.md).

Your credential stays on your device. Proofs are sent to authorize each spend. The gateway and model provider receive request content and
can observe traffic metadata. This does not hide your IP address.

Base Sepolia test credits only. The circuit is not independently audited.

### Coding-task evidence (0.2.12 candidate)

After setup, `zk-credits codex --task-evidence` launches Codex against a fresh,
dedicated local sidecar and prints aggregate payment counters when Codex exits.
The provider and profile are fixed for attribution. The summary contains no
prompts, bearer credentials, proofs, or payment headers. `exchange_verified`
confirms a successful agent exit and an observed settled response; inspect the
code diff and tests separately to judge the coding task. The supported model and
reasoning defaults are selected automatically, including with older setups:

```sh
zk-credits codex --task-evidence
```

Enter your task, review the change and tests, then exit Codex to see the summary.
Version 0.2.12 includes this command; 0.2.11 lacks it.
See the [indexer sample](https://github.com/mangekyou-labs/haze-api/tree/main/examples/base-usdc-indexer).

### Transaction investigator (0.2.12 candidate)

After closing Codex, run `zk-credits investigate --chain base <transaction-hash>`
with the same configured credential. It fetches public execution evidence and
uses the custom x402 `zk-prepaid` adapter for model inference. Base mainnet is
the investigated chain; credit funding remains on Base Sepolia and consumption
is offchain. It does not purchase external traces. Keep missing-evidence notices
visible and distinguish observed errors from model hypotheses.

Repeating a transaction hash recovers its existing local task; it need not make
a new paid call or return a complete report. Do not delete task journals or reset
credential accounting to force a fresh exchange. Unknown payment outcomes must
be reconciled before another paid task. A saved report must be labeled as a prior
run, with its own payment summary.
