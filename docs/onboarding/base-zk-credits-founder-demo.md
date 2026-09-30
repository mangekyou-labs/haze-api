# Founder internal x402 demo

This repeatable walkthrough is for the founder's **internal, uncounted** Base
Sepolia rehearsal before external launch. It does not activate slot B, start
the 14-day window, or count toward market validation. After external slot A
qualifies, B needs a fresh measured run using the
[x402 agent guide](base-zk-credits-x402-agent.md) and the serialized activation
procedure. Do not import this demo record into activation evidence.

Run the guided procedure from the repository root:

```sh
bash scripts/founder-demo-wizard.sh
```

The wizard guides installation, one genuine task, local redaction, and a
fixed-shape safe record. It captures only outcome/check enums, date, candidate,
network, counting boundaries, and funding-route fit. No credential, admin token,
task, response, or arbitrary log text is captured. It does not publish, deploy,
submit a funding application, or write activation records.

## Prepare a fresh local installation

Use Node 20 or newer and an unlocked native OS credential store. Follow the
[0.2.9 release handover](../releases/zk-credits-0.2.9.md) to obtain the reviewed
tarball and verify its SHA256SUMS. This is a local candidate; do not substitute
registry 0.2.8 or infer publication from these instructions.

From the repository root, install into a private directory outside the checkout:

```sh
(cd output/releases/zk-credits-0.2.9 && shasum -a 256 -c SHA256SUMS)
DEMO_INSTALL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zk-founder-demo.XXXXXX")"
chmod 700 "$DEMO_INSTALL_DIR"
npm install --prefix "$DEMO_INSTALL_DIR" "$PWD/output/releases/zk-credits-0.2.9/zk-credits-0.2.9.tgz"
cd "$DEMO_INSTALL_DIR"
./node_modules/.bin/zk-credits --help
ZK_CREDITS_CREDENTIAL_PATH="/absolute/path/to/activated-credential.json" ./node_modules/.bin/zk-credits setup x402
```

Before setup, complete founder invite onboarding at
https://hazecredits.vercel.app: sign in, redeem the prepared invite, download
and locally re-import the passwordless recovery capsule, fund it with founder
Base Sepolia test credits, and download the activated credential. Set `ZK_CREDITS_CREDENTIAL_PATH` to its
local absolute path for the setup invocation above. This variable supplies a
path, never the credential contents. Later commands use OS storage without it. Anyone possessing that file can spend its
credits; keep it outside the checkout in owner-only storage. New imports use
OS credential storage; encrypted historical exports require explicit `--legacy`.
Do not create a new credential home for an existing credential or reset its slot
ledger: setup and every subsequent spend must share the same `ZK_CREDITS_HOME`.

The candidate verifies packaged proving artifacts, synchronizes the public
Base witness, and checks the gateway-known root. No private proving-repository
access is needed. If the default public RPC is rate-limited, configure an
owner-only override with `./node_modules/.bin/zk-credits config rpc`; never copy
endpoint keys into evidence. Keep any gateway override a plain HTTPS origin.

The release handover records a hosted gateway-root setup failure. **Stop if
setup fails**, resolve readiness through the existing operator/launch procedure,
and repeat setup before sending a task. Do not bypass root or artifact checks.
A blocked setup can be noted locally using the record fields below without
claiming a completed exchange.

## Perform one genuine task

Stop any running sidecar and avoid concurrent gateway traffic during snapshots.
From the fresh installation directory run:

```sh
./node_modules/.bin/zk-credits founder-demo-agent
```

Choose a small useful task without secrets or participant data. The command
reads it locally, asks permission to spend one test credit, and asks for the
gateway admin token using hidden input. Do not place that token in arguments,
recordings, or the demo record. The command deliberately registers the
request-aware `zk-prepaid` adapter and binds the actual method, URL, and body
through the local proof engine. An unmodified generic x402 client is unsupported.
The result is displayed locally. Do not capture the full terminal output.

Inspect the final aggregate summary locally. Success requires:

- A real 402 challenge, one local proof and mandatory self-check, and
  `PAYMENT-SIGNATURE` sent.
- Successful response and facilitator settlement confirmed by `PAYMENT-RESPONSE`.
- Local proof attempts/successes, challenges, payments prepared, settlements,
  successful exchanges, and committed slots each increase by one; failures stay zero.
- Authenticated gateway snapshots return 200, with `challenge_issued`,
  `proof_valid`, `reservation_new`, `claim_committed`, and `dispatch_ok` each
  increasing by one, committed claims increasing by one, and other deltas zero.
- No `failurePhase` or stopped status. Verify the task result locally.

The demo command takes authenticated aggregate snapshots itself. Never retain
raw admin responses, payment headers, proofs, signals, or credentials. A
nonzero failure phase is a blocked or failed demo, even if a response appeared.
For ambiguous settlement, preserve the existing ledger and investigate before
retrying; another invocation can spend another credit.

## Safe recording and funding fit

Prefer the wizard's owner-only Markdown record under `~/.zk-credits/demo-records`
(or `ZK_CREDITS_DEMO_RECORD_DIR` outside the checkout). It accepts only bounded
outcomes/checks and funding-fit choices. Check every field before sharing.
If you made a screen/audio recording, redact task/request and response content,
credentials, bearer files, tokens, endpoint keys, proofs, nullifiers, request
signals, identities, and any identity-to-spend join **locally before retaining
or sharing**. Review every frame and audio track. Do not append transcript excerpts
to the safe record. Record aggregate checks, never payment headers or identifiers.

Official route checked **2026-09-30**:

- The [Base Ecosystem Fund](https://docs.base.org/get-started/base-ecosystem-fund)
  backs pre-seed/seed onchain businesses on Base, including payments and AI
  agents. Its [live application](https://www.base.org/ecosystem-fund/apply)
  is for investment, not a Builder Grant. This project's Base prepaid bond and
  adapter-enabled agent path plausibly fit those themes; actual stage, business
  readiness, team information, and eligibility require founder review.
- [Base Batches 004](https://www.base.org/batches) targets pre-product through
  post-MVP teams without a formal Seed round and with Base as their primary
  network. Applications closed September 10, 2026; it is not a live route today.

Recheck these sources before preparing funding materials. Neither thematic fit
nor this demo guarantees eligibility or funding. No submission is claimed.
The next human ticket is
[Run the uncounted founder demo and prepare truthful funding materials](https://github.com/mangekyou-labs/haze-api/issues/35).
