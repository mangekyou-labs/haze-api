# zk-credits 0.2.12 — founder publication handover

Prepared on 2026-10-08. **Published and registry integrity verified on
2026-10-10.** Registry version 0.2.12 matches the reviewed tarball integrity
below. Hosted pilot launch and grant submission remain separate.

This candidate packages the coding-task evidence wrapper and transaction
investigator missing from public 0.2.11. `zk-credits codex --task-evidence`
now supplies `openai/gpt-4o-mini` and `model_reasoning_effort="none"` itself,
alongside the isolated local provider. Recording no longer needs a checkout
entrypoint or manual model flags. Existing profile and credential setup are reused.

## Artifact

Directory: `/Users/kyler/repos/feature-zk-api-credits/output/releases/zk-credits-0.2.12`.

- File: `zk-credits-0.2.12.tgz` (11,234,012 bytes; 74 files).
- SHA-256: `4c718f3efd7a4894d4bc1b126d8cac086f79f0cef47261c71a486de86dbac2f2`.
- npm integrity: `sha512-wDQwJZlOejin9/w4scbwaH+aFRh6wGy3ek7e29HjObjIA3yG4ymXEvLaMf63FENtvXfKtzh3rB7punRukYgOOA==`.
- Adjacent evidence: `SHA256SUMS`, `pack.json`, `publish-dry-run.json`.

This was packed from the current working candidate, which includes existing
uncommitted pilot work. It is not represented as a clean tagged commit. Publish
this tarball; rebuilding from a directory produces a different review artifact.
The package includes the configured release RPC as intended by the existing
release configuration. No credential home, `.env` file or private run log is
included in the tarball.

## Validation and limits

- Package build and bundle: passed.
- Sidecar suite: 142 tests passed, including the supported task defaults.
- Investigator controller suite: 144 tests passed.
- Fresh disposable installation of this tarball outside the checkout: passed;
  published leaf dependencies resolved without workspace links.
- Installed help exposes `codex --task-evidence` and `investigate`; both public
  library exports load, and the pinned proving archive matches its manifest.
- `npm publish <tarball> --dry-run --access public --tag latest`: passed.
- Registry check at preparation: latest was 0.2.11; 0.2.12 was available.

A fresh paid coding rehearsal used the installed tarball with no manual model
flags. Only `indexer.mjs` changed and all four unchanged tests passed. The run
also encountered an upstream 502, then exceeded the harness's 240-second limit
without printing a final aggregate summary. **This is not a passing end-to-end
payment-evidence rehearsal.** No owned rehearsal process remains; installed
`status` reports configured credential/profile and stopped sidecar. Canonical
accounting was retained, with no reset or replacement. Do not infer settlement
or delivery counts from the ledger total or attach earlier counters to this run.
Recording must meet the fresh-run checks in the founder checklist.

The earlier successful paid coding rehearsal is separately documented in
`docs/onboarding/grant-demo-live-preflight-2026-10-08.md`. No fresh paid
investigator run was attempted for this release. Its existing validated report
is prior-run evidence; repeating known hashes can recover a stopped partial task.

## Founder: publish and verify

Run privately with your npm publishing account. Complete login/2FA if requested.

```sh
cd /Users/kyler/repos/feature-zk-api-credits/output/releases/zk-credits-0.2.12
LC_ALL=C shasum -a 256 -c SHA256SUMS
npm publish ./zk-credits-0.2.12.tgz --access public --tag latest --registry https://registry.npmjs.org
npm view zk-credits@0.2.12 version dist.integrity --registry https://registry.npmjs.org
```

Proceed only when checksum says `OK` and registry integrity exactly matches the
value above. If 0.2.12 already exists, compare integrity and stop on a mismatch.
An npm dry-run did not publish it.

```sh
npm install --global zk-credits@0.2.12 --registry https://registry.npmjs.org
npm ls --global zk-credits --depth=0
zk-credits --help
zk-credits status
zk-credits doctor
```

Confirm version and PATH, retain the existing credential and journals, then
follow [the step-by-step founder checklist](../onboarding/grant-demo-founder-checklist.md)
and [the live ticket](https://github.com/mangekyou-labs/haze-api/issues/35).
From the fresh broken sample, launch `zk-credits codex --task-evidence`, paste
the task, review its changes, and exit with `/exit` to collect the session summary.
The investigator command is `zk-credits investigate --chain base <transaction-hash>`.
Use the checklist's explicit fresh/prior-run path and its own payment evidence.
