# zk-credits

Anonymous API credits for coding agents. Buy 100 tickets, import a 24-word
phrase, run Cline / Claude Code / Codex. The gateway never sees your identity.

**Testnet only. No real money.**

```bash
npm install --global zk-credits
```

## First run

### 1. Fund an identity

1. Open https://feature-zk-api-credits-gadillacers-projects.vercel.app
2. Sign in with GitHub
3. Generate identity and write down the **24-word recovery phrase**
4. Buy **Starter — $1.00 / 100 tickets** (Stripe test card `4242…`)
5. Wait until the dashboard shows an **active** deposit

The phrase is the proving identity. It never leaves your machine.

### 2. Import it locally

```bash
zk-credits import-mnemonic
# paste the 24-word phrase (hidden TTY, saved to OS keychain)
```

### 3. Run an agent

```bash
zk-credits cline "summarize this repository"
zk-credits claude -p "summarize this repository"
zk-credits setup codex && zk-credits codex "summarize this repository"
```

Each command starts a loopback sidecar on `127.0.0.1:3210`, proves the request
locally, and launches the agent against that sidecar. Your default
`~/.cline` / `~/.claude` / `~/.codex` profiles are not modified.

## Commands

| Command | What it does |
|---|---|
| `zk-credits import-mnemonic` | Hidden-TTY import of the 24-word phrase into OS keychain |
| `zk-credits cline [args…]` | Launch Cline through the proof-aware sidecar |
| `zk-credits claude [args…]` | Launch Claude Code through the sidecar (`ANTHROPIC_BASE_URL`) |
| `zk-credits setup codex` | Write an isolated Codex profile |
| `zk-credits codex [args…]` | Launch Codex CLI through the sidecar |
| `zk-credits status` | Identity + sidecar state |
| `zk-credits serve` | Sidecar only, for any OpenAI-compatible client |
| `eval "$(zk-credits env)"` | Print `OPENAI_BASE_URL` + loopback bearer |

Other clients:

```bash
zk-credits serve
eval "$(zk-credits env)"
# OPENAI_BASE_URL=http://127.0.0.1:3210/v1
```

TypeScript (Codex SDK):

```ts
import { Codex } from '@openai/codex-sdk';
import { buildCodexSdkOptions, buildCodexThreadOptions } from 'zk-credits/codex';

const codex = new Codex(buildCodexSdkOptions({
  loopbackBaseUrl: 'http://127.0.0.1:3210',
  token,
  codexHome,
}));
const thread = codex.startThread(buildCodexThreadOptions({ model: 'openai/gpt-4o-mini' }));
await thread.run('summarize this repository');
```

`ZK_CREDITS_MNEMONIC` is for a headless process only. It is not persisted.

## How it works

1. Browser derives `secret_k` from a 24-word phrase and a public commitment
2. Starter checkout deposits 1 USDC testnet against that commitment
3. Sidecar imports the phrase, fetches the public Merkle snapshot, and attaches
   a fresh body-bound ZK-RLN proof to each LLM request
4. Gateway verifies the proof, forwards to OpenRouter, returns the response
5. Ticket fork (same ticket, different request) slashes the deposit on-chain

The gateway cannot link a call to a deposit. ZK enforced.

Live surfaces:

- Web: https://feature-zk-api-credits-gadillacers-projects.vercel.app
- Gateway: https://zk-credits-gateway.onrender.com
- Contract: `CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT`

## Before you try it

- **Testnet Stripe + GitHub** are required. No anonymous CLI-only signup.
- **Membership tree capacity is 8.** If Buy Credits fails or the gateway
  returns `Tree is full`, a slot must be freed (withdraw/slash) before a new
  identity can deposit.
- **Render free-tier cold start.** First `/health` after idle can take ~30s or
  return 503; retry.
- **Node 20+.** `keytar` needs a working OS keychain (macOS Keychain, libsecret
  on Linux, Credential Manager on Windows).
- Sidecar binds **only** `127.0.0.1`. It does not install a plugin, intercept
  TLS, or replace your default agent profile.

## Honest caveats

1. **Testnet only.** No real money. USDC is testnet faucet.
2. **100-ticket specialization.** Starter is exactly ticket indices `0..99`.
3. **Variable-cost refunds deferred.** Fixed per-call ticket price.
4. **Single-contributor trusted setup.** Groth16 BLS12-381 ceremony is dev-only.
5. **Custodial gateway-mediated withdrawal.** Gateway co-signs. It can block by
   disappearing; it cannot redirect funds without the membership-removal proof.
6. **Async on-chain audit.** Proofs verify off-chain for latency, then settle
   to Soroban `spend()` asynchronously.
7. **Single gateway timing.** No cryptographic link from call to deposit, but
   one operator can observe request timing.
8. **Proving latency.** First proof ~1.5s per session, then cached.
9. **IP is not hidden.** Payment identity is hidden; network identity is not.
10. **Validated clients.** `zk-credits cline`, `zk-credits claude`, and
    `zk-credits codex` / `zk-credits/codex`. Other clients need a custom
    OpenAI-compatible base URL.

## Build from source

For protocol contributors only. End users should stop at **First run**.

Prerequisites: Node 20+, Rust 1.94+, Stellar CLI 27+, Circom 0.5.46+.

```bash
git clone https://github.com/mangekyou-labs/haze-api.git
cd haze-api
cp .env.example .env   # STELLAR_*, OPENROUTER_API_KEY, GATEWAY_SECRET, STRIPE_*, GITHUB_*

cd ts && npm install && cd ..
cd web && npm install && cd ..
cd circuits && npm install && cd ..

# circuits (trusted setup is single-contributor, dev-only)
cd circuits
circom deposit_membership.circom --r1cs --wasm -p bls12381
circom rln_nullifier.circom --r1cs --wasm -p bls12381
circom slash.circom --r1cs --wasm -p bls12381
node scripts/setup.js && cd ..

cd ts && npm run dev          # gateway :3001
cd web && npm run dev         # web :3000
```

Contract, slash demo, and E2E scripts live in `zk-credits-contract/` and
`scripts/`.

## License

MIT
