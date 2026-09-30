# Issue 29 operator validation — 2026-09-30

The operator session validates implementation mechanics. It is not independent
external adoption evidence. Parent specification: haze-api issue 25; journey:
haze-api issue 29.

## Verified locally

- Production web build and typecheck pass.
- 11 Chromium onboarding/recovery tests pass. Funding and invite endpoints are
  fixtures: no live transaction or counted gateway call is claimed.
- New onboarding and recovery require no credential password. Browser storage
  does not retain the new bearer secret. Legacy encrypted recovery is explicit.
- 74 web unit tests, 104 sidecar tests, and 16 active shared tests pass.
- An isolated install of the local sidecar tarball starts the CLI and verifies
  the packaged archive and all proving-artifact hashes without GitHub access.
- Native macOS OS storage write/read/delete passes using a temporary nonsecret
  marker. No operator credential was imported during this check.
- RPC tests cover chain 84532, reachability failure redaction, owner-only storage,
  changing configuration before setup, and explicit environment precedence.
- x402 setup validates inputs without starting the Codex sidecar on its port.

## Remaining live acceptance

The signed-in `hazecredits.vercel.app` dashboard still has the older password
form. The published 0.2.8 package does not implement the new flow. The local
tarball retains the checkout's 0.2.7 version; it is a validation artifact, not a
release candidate version or published replacement.

Owner release work must choose a new package version and publish the package,
then deploy the matching website. Package publication was explicitly excluded
from this operator session. Keep issue 29 open until the deployed journey passes.

After deployment, obtain an operator-owned Base Sepolia RPC endpoint, enter it
locally with `zk-credits config rpc`, redeem a valid invite, download/reimport
the recovery capsule, fund, import the activated credential with setup, restart
without its export, and complete an operator-chosen Codex or x402 task. Record
redacted elapsed time, assistance, and one committed counted gateway call.

Do not paste recovery files, endpoint keys, invite capabilities, tasks, responses,
or OS-store contents into issue comments or acceptance logs.
