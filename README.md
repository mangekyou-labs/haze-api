# Haze · private prepaid API credits

Haze gives coding agents prepaid inference credits through the custom x402 v2
`zk-prepaid` scheme. Activate a bundle on Base Sepolia, keep its credential on your
machine, and spend credits using locally generated zero-knowledge proofs.

![Codex using Haze ZK Credits in the terminal](docs/images/zk-credits-codex.png)

[Sandbox dashboard](https://hazecredits.vercel.app) ·
[CLI setup](packages/zk-credits-sidecar/README.md) ·
[x402 adapter](packages/x402-zk-prepaid/README.md)

## Why we built this

An API key ties every request to the account that bought it. Haze separates
account-linked funding from proof-based spending: a request proves that it can
spend one credit from a funded bundle without including an account or Stripe
identifier in the payment proof.

The current release is an experimental, testnet-only implementation. It supports
one fixed coding service class and 250-credit bundles; it has not been
independently audited. Prompts and request contents remain visible to the gateway
and model provider.

## Quick start

Requires **Node.js 20+**, native OS credential storage, and Codex installed for the
Codex flow.

1. Sign in with GitHub at the [sandbox dashboard](https://hazecredits.vercel.app).
2. Choose a $5, $20, or $100 **simulated USD** top-up using Stripe test Checkout.
   Activation still costs $20 for a 250-credit bundle: $5 contributes toward one,
   and $100 covers five separate bundles. No real money is charged.
3. Generate, download, and re-import your recovery file, then activate the bundle.
4. Install the CLI and import your activated credential:

```sh
npm install --global zk-credits@0.2.12
ZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup codex
zk-credits codex
```

Activation reserves $20 of sandbox balance and deducts it after confirmed funding.
A shared sponsor supplies Base Sepolia test USDC separately. Stripe test payments
do not purchase USDC or move real dollars.

Setup installs the pinned proving artifacts, verifies the bundle witness, stores
the credential in native OS storage, and configures Codex. Keep the recovery file
private: anyone holding it can spend the bundle's credits.

## Usage

### Coding with Codex

```sh
zk-credits codex
zk-credits codex --task-evidence
```

The second command writes aggregate payment evidence for the coding session. Try
[the Base USDC indexer example](examples/base-usdc-indexer/README.md): fix repeated
log handling while preserving distinct transfers within the same transaction,
then run the example's tests.

The sidecar translates supported Codex text and function-tool requests into the
fixed, non-streaming `POST /v1/chat/completions` service class. The current gateway
uses `deepseek/deepseek-v4-flash` through OpenRouter; a client model label does not
select a different upstream model.

### Investigating a Base transaction

```sh
zk-credits investigate --chain base <transaction-hash>
```

The [transaction investigator](examples/base-transaction-investigator/README.md)
builds an evidence-linked report from public chain data and bounded inference.
Its guide explains supported chains, separate inference and trace-payment budgets,
and recovery after an interrupted run.

Use one process at a time with a credential. Stop another active sidecar before
starting an investigation.

### Integrating an x402 agent

```sh
ZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup x402
zk-credits x402-agent
```

An x402-native agent must explicitly register Haze's versioned adapter. Follow the
[adapter integration guide](packages/x402-zk-prepaid/README.md) and the
[sidecar API examples](packages/zk-credits-sidecar/README.md) for library usage.
Generic x402 clients using the standard `exact` scheme cannot spend these credits.

### Diagnostics

```sh
zk-credits doctor
zk-credits status
zk-credits config rpc
zk-credits stop
```

Use `doctor` to check local setup and `config rpc` to replace an unavailable RPC.
The default sidecar port is `3210`; its log is `~/.zk-credits/sidecar.log`.
See [setup and troubleshooting](packages/zk-credits-sidecar/README.md) for details.

## Architecture

| Component | Location | Responsibility |
| --- | --- | --- |
| Dashboard | [`web/`](web/) | GitHub sign-in, sandbox balance, recovery-file flow, activation |
| Gateway | [`ts/`](ts/) | Funding coordination, proof verification, credit claims, inference dispatch |
| Local sidecar | [`packages/zk-credits-sidecar/`](packages/zk-credits-sidecar/) | Credential storage, local proving, agent transport and recovery |
| x402 adapter | [`packages/x402-zk-prepaid/`](packages/x402-zk-prepaid/) | Versioned challenge and payment payloads for the custom scheme |
| Shared crypto | [`packages/zk-credits-shared/`](packages/zk-credits-shared/) | Credential format, commitments and witness helpers |
| Bond contracts | [`contracts/`](contracts/) | Base Sepolia bundle funding and double-spend accountability |
| Spend circuit | [`circuits/`](circuits/) | BN254 Groth16 proof for spending a private credit |
| Examples | [`examples/`](examples/) | Coding tasks and transaction investigation |

A model call follows this lifecycle:

1. The gateway responds with a `402` payment challenge.
2. The sidecar creates a proof locally and retries with `PAYMENT-SIGNATURE`.
3. The gateway verifies the proof and reserves the credit claim.
4. A committed successful response carries `PAYMENT-RESPONSE`.

Credit spending settles offchain. Funding uses Base Sepolia, but each model call
does not require a new onchain transaction. See the
[protocol design](docs/ai/design/2026-09-18-feature-base-zk-credits.md) and
[sandbox billing decision](docs/wayfinder/base-zk-credits-pilot/decisions/004-account-linked-sandbox-billing.md).

## Technology stack

| Area | Technologies |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS, NextAuth |
| Account billing | GitHub OAuth, Stripe test Checkout |
| Gateway | Node.js, Express, PostgreSQL, viem, OpenRouter |
| Payments | x402 v2 with Haze's custom `zk-prepaid` adapter |
| Privacy | Circom, snarkjs, BN254 Groth16, Poseidon commitments |
| Contracts | Solidity 0.8.20, Foundry, Base Sepolia |
| CLI | TypeScript, esbuild, native OS keyring |
| Validation | Vitest, Node test runner, Playwright, Foundry, GitHub Actions |

## Local development and build

For repository development, use the Node version pinned in
[CI](.github/workflows/ci.yml). Install and build the shared packages first:

```sh
git clone https://github.com/mangekyou-labs/haze-api.git
cd haze-api
npm ci --prefix packages/zk-credits-shared
npm run build --prefix packages/zk-credits-shared
npm ci --prefix packages/x402-zk-prepaid
npm run build --prefix packages/x402-zk-prepaid
npm ci --prefix ts
npm ci --prefix packages/zk-credits-sidecar
npm ci --prefix examples/base-transaction-investigator
npm ci --prefix web
npm ci --prefix contracts
```

Configure the gateway using [`.env.example`](.env.example) and the web app using
[`web/.env.example`](web/.env.example). These describe the database, OAuth,
provider, billing and chain settings; use test credentials for sandbox billing.

```sh
npm run dev --prefix ts
# In another terminal:
npm run dev --prefix web
```

The sidecar package build reads a public `BASE_RPC_URL` from the ignored root
`.env.launch.local`. Configure it before building; this URL is embedded in the
package. The investigator also reads the public `BASE_TREASURY_ADDRESS` from that
file when supplied. Keep provider keys and other secrets out of published builds.

```sh
npm run build --prefix packages/zk-credits-sidecar
npm run build --prefix web
forge build --root contracts
```

Contract builds require Foundry; circuit tests require Circom 2.2.2. The
[CI workflow](.github/workflows/ci.yml) records installation and validation steps.

## Testing

Prepare the committed, hash-pinned public proving bundle for gateway proof tests:

```sh
(cd ts && npx --no-install tsx ../scripts/prepare-proof-test-artifacts.mts)
```

Then run the relevant checks:

```sh
npm run typecheck --prefix ts
npm test --prefix ts
npm test --prefix packages/zk-credits-shared
npm test --prefix packages/x402-zk-prepaid
npm test --prefix packages/zk-credits-sidecar
npm test --prefix examples/base-transaction-investigator
npm run lint --prefix web
npm run typecheck --prefix web
npm test --prefix web
npm run test:e2e --prefix web
npm test --prefix circuits
forge test --root contracts
bash scripts/guardrails.test.sh
```

Build the sidecar before running its artifact-dependent tests. The investigator's
standard test command runs offline acceptance checks; live prepaid checks require
an activated credential and are documented separately in its guide.

## Privacy and security

Credential secrets stay local. Account and Stripe identifiers remain linked to
funding history, but are excluded from spend proofs and inference telemetry.
Payment-proof unlinkability does not hide prompts, network metadata, or provider
responses. Recovery files are bearer credentials, so store them privately.

The pinned proving bundle is development material for Base Sepolia. Production
use requires an external proving ceremony and independent security review.

## Contributing

Open an [issue](https://github.com/mangekyou-labs/haze-api/issues) describing the
problem or proposed change. For a pull request, include the relevant issue,
expected behavior, and validation results. Read [AGENTS.md](AGENTS.md) and the
[context map](CONTEXT-MAP.md) before changing domain behavior.

## License

[AGPL-3.0-or-later](LICENSE).
