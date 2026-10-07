<!-- THROWAWAY README CANDIDATE: owner review only; does not replace README.md. -->
# Haze · private prepaid API credits

Use prepaid inference credits from a coding agent on Base Sepolia.
The local sidecar proves each spend with Haze's custom x402 `zk-prepaid` scheme.
Available today: the Codex bridge and a prompt-and-answer x402 starter.
The Base transaction investigator described below is proposed, not available.

## Before you start

You need Node.js 20+, npm, Codex CLI installed and on PATH, an interactive
terminal, native OS credential storage, and an already activated credential.
Linux requires a working Secret Service credential store.
Setup needs internet access to the gateway and a working Base Sepolia RPC.
Keep your recovery file private: anyone holding it can spend its credits.

## Connect your coding agent

```sh
npm install --global zk-credits@0.2.11
zk-credits --help
ZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup codex
```

Replace the credential path with your local download. Setup imports it into
OS storage, verifies the packaged proving artifacts, synchronizes the Base
witness, checks its root, and writes the Codex profile. Allow OS access if asked.
Run `zk-credits doctor` for diagnostics. If the RPC is unavailable, run
`zk-credits config rpc` and retry setup. Legacy encrypted files use `--legacy`.

## First useful task: fix a duplicate transfer count

Create an isolated, dependency-free sample; no RPC or wallet is needed for it:

```sh
mkdir haze-first-task
cd haze-first-task
cat > indexer.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
function index(logs) { return logs; }
const a = { chainId: 84532, transactionHash: '0xab', logIndex: 0 };
test('duplicate log', () => assert.equal(index([a, { ...a }]).length, 1));
test('distinct log', () => assert.equal(index([a, { ...a, logIndex: 1 }]).length, 2));
JS
node --test indexer.test.mjs
zk-credits codex
```

The duplicate test should fail initially. Ask Codex:
“Fix `index` to deduplicate by chain ID, case-insensitive transaction hash,
and log index. Preserve distinct transfers. Keep the existing assertions,
add cases for hash casing and different chains, run the tests, and explain the diff.”
Review the diff and passing tests. Agent model calls consume prepaid credits;
test execution is local. This sample demonstrates coding with prepaid inference.

## Proposed next task: explain a failed Base transaction

Input: a Base mainnet or Sepolia network and a mined, failed transaction hash.
The planned investigator collects public evidence first, buys a missing trace
only for a named diagnostic question, then returns an evidence-linked report.
It separates observed facts, supported diagnoses, and labelled LLM hypotheses.
Rehearsal uses fixtures and simulated purchases; live paid delivery is unverified.
Bounds: one trace, three inference requests, eight tool calls, 120 active seconds.
Budgets: 0.01 simulated USDC total, 0.005 per purchase, five prepaid credit slots.
Purchase costs and inference credits stay separate; unresolved costs stay held.
Read the [illustrative walkthrough](walkthrough.prototype.md); no investigator command exists yet.

## Compatibility and privacy

Codex text and function-tool requests use a bounded bridge to non-streaming
`POST /v1/chat/completions`. Generic x402 clients need Haze's custom adapter;
the published inference path does not accept standard `exact` USDC payments.
Credential secrets stay local. The gateway and model provider can observe
request content and traffic metadata. Standard wallet purchases can be linkable.
Inference settlement is offchain; it is not one chain transaction per model call.
Base Sepolia inference only. Experimental; the circuit has no independent audit.

- [Setup and diagnostics](https://github.com/mangekyou-labs/haze-api/blob/main/packages/zk-credits-sidecar/README.md)
- [Adapter integration](https://github.com/mangekyou-labs/haze-api/blob/main/packages/x402-zk-prepaid/README.md)
- [Protocol and privacy](https://github.com/mangekyou-labs/haze-api/blob/main/docs/ai/design/2026-09-18-feature-base-zk-credits.md)

AGPL-3.0-or-later; see [LICENSE](https://github.com/mangekyou-labs/haze-api/blob/main/LICENSE).
