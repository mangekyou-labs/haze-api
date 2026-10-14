# RPC recovery QA evidence

Local verification of the RPC recovery changes on 2026-10-14:

- Shared: `npm run build` and `npm test -- --run`: 34 tests passed.
- Gateway: targeted Base-chain, event-sync, sponsor, activation, and billing suites: 56 tests passed; `npm run typecheck` passed.
- Web: `npm run typecheck` and Base recovery suite: seven tests passed.
- Sidecar: `npm run build` and full `npm test -- --run`: 158 tests passed, three skipped. Tests ran outside the sandbox because localhost listeners and the runtime registry are required.
- `git diff --check` passed; `graphify update .` completed. Generated graph files are intentionally excluded from the commit.
- Standards and spec reviews completed; follow-up review found no remaining blockers.
- Installable client artifact: `/tmp/zk-credits-0.2.13.tgz`, built with the public Base Sepolia default. No npm publication or global installation was performed.

Read-only live diagnosis found an owner-only saved custom RPC, different from the legacy setup setting, and a successful Base Sepolia chain-ID response. The gateway health request timed out after 20 seconds, then returned HTTP 200 in 0.248 seconds. The reported root-confirmation error came from a gateway check limited to ten seconds with no retry. This supports a gateway availability delay, but does not establish its cause or prove the user's Infura quota is exhausted.

Saved RPC settings load in new sessions unless BASE_RPC_URL overrides them. An already running sidecar must restart to load a changed endpoint. The final Codex HTTP 402/reconnect remains unconfirmed: no signed funding or paid request was performed. Provider quota errors and gateway payment errors must remain separate.

The exact tested commit and remote CI/deployment outcomes are recorded separately in `/tmp/haze-rpc-qa-verification.json` after committing.

Follow-up startup regression: a real gateway process with a stalled local RPC
failed to listen within five seconds before the fix; after moving history sync
after listen, its public health endpoint answered successfully in about half a
second. Startup and event-sync suites passed five tests; gateway typecheck passed.
The live rollout logged a nine-minute initial-sync delay before opening its port,
confirming a startup dependency separate from the user's local RPC setting.
