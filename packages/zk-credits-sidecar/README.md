# zk-credits

Loopback sidecar that attaches a ZK-RLN proof to each coding-agent LLM request.

```bash
npm install --global zk-credits
```

## First run

1. Fund an identity at the [web app](https://feature-zk-api-credits-gadillacers-projects.vercel.app)
   (GitHub sign-in → generate 24-word phrase → buy Starter $1.00 / 100 tickets).
2. Import the phrase (hidden TTY, OS keychain):

   ```bash
   zk-credits import-mnemonic
   ```

3. Run:

   ```bash
   zk-credits cline "summarize this repository"
   zk-credits claude -p "summarize this repository"
   zk-credits setup codex && zk-credits codex "summarize this repository"
   ```

The sidecar binds `127.0.0.1:3210` only. It does not modify `~/.cline`,
`~/.claude`, or `~/.codex`.

## Commands

```
zk-credits cline [cline arguments...]
zk-credits claude [claude arguments...]
zk-credits setup codex [--model <model>]
zk-credits codex [codex arguments...]
zk-credits status
zk-credits import-mnemonic
zk-credits serve [--port <port>]
eval "$(zk-credits env)"
```

Codex SDK:

```ts
import { buildCodexSdkOptions, buildCodexThreadOptions } from 'zk-credits/codex';
```

`ZK_CREDITS_MNEMONIC` is for a headless process only and is not persisted.

Testnet only. See the [repo README](https://github.com/mangekyou-labs/haze-api)
for caveats, tree capacity, and cold-start notes.
