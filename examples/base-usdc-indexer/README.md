# Base USDC indexer coding task

This deliberately broken, dependency-free sample double-counts repeated RPC
logs. Copy this directory into a fresh local demo repository so the coding
agent edits only the sample. No RPC access or chain write is needed.

Run `npm test`: duplicate-log and hash-casing tests fail; distinct transfers
and chains pass. After the founder publishes the prepared `zk-credits@0.2.12`
tarball, install it and use the existing configured credential. From the copied
sample directory:

```sh
npm install --global zk-credits@0.2.12
zk-credits codex --task-evidence
```

The package supplies the supported model and reasoning defaults. No manual model
flags or checkout entrypoint are needed. Import a credential privately with
`zk-credits setup codex` only on an unconfigured device. See the
[publication handover](../../docs/releases/zk-credits-0.2.12.md) and
[ordered founder checklist](../../docs/onboarding/grant-demo-founder-checklist.md).

Ask: “Fix the Base Sepolia USDC transfer indexer. Deduplicate logs by chain ID,
transaction hash, and log index; preserve distinct transfers in the same
transaction. Run the tests and explain the change.”

Exit Codex after reviewing its diff and passing tests. The wrapper prints a
redacted aggregate summary from that run’s dedicated sidecar. It contains no
prompt, code, proof, credential, account, or payment payload. A nonzero committed
claim count means the coding session settled credits; it does not independently
prove that the agent completed the task. Review the actual diff and test output.
Version 0.2.12 is prepared, not yet published; public 0.2.11 lacks the evidence flag.
