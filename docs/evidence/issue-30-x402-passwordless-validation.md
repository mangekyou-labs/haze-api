# Passwordless x402 technical validation

Date: 2026-09-30 UTC. This is founder technical acceptance for
[x402 operator first use: own agent and request-aware adapter](https://github.com/mangekyou-labs/haze-api/issues/30).
It is an uncounted rehearsal, not slot B qualification, external operator
validation, or market evidence. No participant setup-time claim is made.

## Website and credential setup

The passwordless website update was deployed to production with explicit owner
authorization: https://hazecredits.vercel.app. Deployment:
https://zk-credits-rcltm4z94-gadillacers-projects.vercel.app.

The browser completed real GitHub authentication, redeemed a founder-generated
invite, downloaded the passwordless recovery capsule, reimported that file,
and downloaded the funded activated credential. Files were moved outside the
checkout into an owner-only directory; browser-created duplicate files were
removed. Neither credential contents nor their commitment are recorded here.

Funding required founder infrastructure assistance. The configured sponsor had
no test USDC or bond allowance. The agent obtained Circle faucet test USDC,
approved exactly one bundle's funding amount, and funded the pinned Base
Sepolia bond. When hosted provisioning remained in reconciliation-pending,
the agent used the existing sponsor reconciliation and provisioning-store
completion interfaces to record the actual finalized BundleFunded event.
No funding receipt, settlement, or credits were fabricated. This assistance
means the hosted funding flow was not independently frictionless.

## Fresh package and live exchange

A tarball built from this checkout was installed into a fresh directory outside
the repository. It contains the passwordless runtime and pinned proving bundle;
it is an unpublished candidate using the existing package version, not a claim
that the npm registry release has been updated.

The first setup imported the activated credential into macOS Keychain. A second
`zk-credits setup x402` invocation used the OS-stored credential without the
import-file environment variable or a recovery-password prompt. Setup validated
the pinned artifacts, chain witness, and gateway-known root.

The built-in public Base Sepolia RPC passed eth_chainId but failed during witness
synchronization. Setup returned redacted provider guidance. The agent configured
the owner's existing RPC locally in owner-only storage and continued; its key
was not embedded in the package, published, or pushed to Vercel.

A fresh-package own-agent integration sent a throwaway task to the real gateway
through `createLocalX402Agent().client.fetch`. HTTP 200, PAYMENT-RESPONSE, and the
expected local task result were verified. The packaged interactive
`zk-credits x402-agent` starter also completed a real task and displayed its
correct result locally. Request bodies and model responses are omitted.

A successful live request exposed retained snarkjs verification workers after
runtime shutdown. Self-verification now runs in a bounded child process against
the pinned key; a subsequent successful exchange exited cleanly after
`runtime.close()`.

## Redacted aggregate evidence

For the final fresh runtime:

| Check | Result |
| --- | --- |
| Gateway response | 200 |
| Payment receipt present | yes |
| Expected task result verified locally | yes |
| Metrics without authentication | 401 |
| Metrics with local bearer authentication | 200 |
| Proof attempts / successes / failures / retries | 1 / 1 / 0 / 0 |
| Challenges / payments prepared / settlements / successful exchanges | 1 / 1 / 1 / 1 |
| Exchange failures | 0 |
| Parent exits after successful proof and runtime close | yes |

Metrics contained only aggregate counts, bounded timing summaries, categories,
and update timestamps. No request, proof, credential, nullifier, or identity
fields were present. Protected raw aggregate snapshots remain on the operator's
machine.

An unmodified `@x402/core` client received the real HTTP 402 challenge and rejected
payment creation without the custom adapter. No payment was submitted. Generic
x402 compatibility remains unsupported.

## Automated verification

The package build/typecheck, sidecar suite, and adapter suite pass. The shutdown
regression additionally exercises malformed verification input, silent child
output, fail-closed rejection, and child exit; the real successful exchange
checks the worker-pool lifecycle that originally retained the parent process.
