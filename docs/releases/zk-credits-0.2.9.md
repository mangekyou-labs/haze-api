# zk-credits 0.2.9 publication handover

Status: prepared, not published. Registry latest checked on 2026-09-30: 0.2.8.

This release adds passwordless activated-credential import and shared OS-store
runtime access, packaged hash-pinned proving artifacts, x402-only setup, the
public Base Sepolia RPC default with private local overrides, and isolated
self-verification workers that exit cleanly.

## Reviewed artifact

Local tarball: `output/releases/zk-credits-0.2.9/zk-credits-0.2.9.tgz`.
SHA-256:
`decfcc018576c7ddbdb761ebbd6eba9638ff223c1a324c09fb12dbd6e372fa0f`.

Build/typecheck, 108 sidecar tests, publish dry-run, required-file checks,
private-environment-value inspection, fresh tarball installation, and CLI help
passed. The runtime implementation passed real x402 exchange and shutdown
checks before this version-only release preparation; see
[technical evidence](../evidence/issue-30-x402-passwordless-validation.md).

A fresh 0.2.9 setup attempted twice during release preparation stopped because
the hosted gateway could not confirm the credential's current root. Local
chain synchronization ran; setup failed closed at gateway root confirmation.
This hosted readiness issue remains unresolved. It prevents a claim of complete
fresh live setup validation for 0.2.9 and should be resolved before invitations.
The two scoped dependencies remain at 0.1.0; they do not need republishing for
this package's bundled passwordless runtime.

## Owner publication

Publish the reviewed tarball, rather than rebuilding from a changing checkout:

```sh
cd /Users/kyler/repos/feature-zk-api-credits/output/releases/zk-credits-0.2.9
shasum -a 256 -c SHA256SUMS
npm publish ./zk-credits-0.2.9.tgz --access public --tag latest --registry https://registry.npmjs.org
```

If npm requests authentication, run `npm login --registry https://registry.npmjs.org`
and repeat publish. Complete npm's browser authentication or two-factor step
locally. Do not put authentication codes or tokens in chat or saved commands.

## After publication

```sh
npm view zk-credits@0.2.9 version dist.integrity --registry https://registry.npmjs.org
npm install --global zk-credits@0.2.9 --registry https://registry.npmjs.org
zk-credits --help
```

Expected registry integrity:
`sha512-IyiuspQbMcMPlXtLAsBLBzrmRU9K+NBlJcwYs14Yk7EYPov5Cd7W/tAT+vZbMSvozajJDbGvf9v2ah3iSt0qZw==`.

Have the agent verify a clean registry install, gateway-known-root setup, and a
real request before pinning participant install instructions to the published
release. Publication alone does not establish hosted readiness.
