# zk-credits 0.2.10 publication handover

Published on 2026-09-30 at 12:56:55 UTC. The public registry integrity exactly
matches the prepared tarball below.

**Invitation checks remain unresolved:** the current leaf-package source differs from published
`0.1.0` contents, hosted readiness is unavailable, and the gateway real-proof
regression times out. Do not invite participants until
the [release verification report](../evidence/issue-32-release-verification.md)
is reconciled. The publish command below is historical handoff context; this immutable version
has already been published and must not be republished.

This revision replaces the public RPC default with BASE_RPC_URL read from repository
.env.launch.local at build time. Only that value is baked into the runtime module
and bundled package. Runtime environment and saved overrides retain precedence.
Any provider key in the endpoint is readable by package installers. The endpoint
is intentionally included as requested; it is omitted from source control and
this handoff. Builds require the launch file; CI supplies a synthetic endpoint.

Build/typecheck and 108 sidecar tests passed. Baked runtime and CLI values match
the launch setting. Fresh tarball installation and Codex setup passed using the baked RPC without
overrides. A real Codex task passed functional checks and settled successfully.
Reusing the credential in fresh local state triggered four claim conflicts before
recovery; one new claim committed and one dispatch succeeded. The earlier run
completed two settlements using a saved alternate RPC. Publish dry-run passed. See [acceptance evidence](../evidence/issue-29-live-browser-onboarding.md).

Artifact SHA-256: `4ffb8a0e49d48656d56015b02c98039d3adb8e3d7b54175fc37825e28f173e85`.
Registry integrity: `sha512-NawqvZHncroGKPIU9i9/P5g+gWn9xBxjldvYM+Q+aIbteViegwzi/+X5P9+zvMF7Pg+Of2V0SEcsIZHnhO1Xdw==`.

Historical publication handoff:

```sh
cd /Users/kyler/repos/feature-zk-api-credits/output/releases/zk-credits-0.2.10
LC_ALL=C shasum -a 256 -c SHA256SUMS
npm publish ./zk-credits-0.2.10.tgz --access public --tag latest --registry https://registry.npmjs.org
```

After publication, verify a clean registry installation and a real gateway request
before updating participant installation instructions. Independent participant evidence remains in the pilot tickets; Codex technical
acceptance is complete.
