# Founder investigator validation — 2026-10-07

The installed launcher works from a locally packed candidate. Live acceptance
has **not passed**: the bounded paid attempt has one retired slot, unknown
settlement and no model delivery. No replacement payment was authorized.

## Installed candidate

Built the reviewed runtime from `integration/base-investigator-49-55` at
`419d528` into this checkout, preserving the existing shared runtime. The public
command accepts only `--chain base|base-sepolia <transaction-hash>`, uses the
existing OS credential and exclusive canonical ledger, fixes gateway/model,
and limits the task to three requests/slots. Exact purchases remain disabled.

Packed `zk-credits@0.2.11` locally and installed its tarball into the clean
`/private/tmp/haze-founder-installed` project. The package includes
`dist/investigator.mjs` and exposes `prepareLocalX402Agent` through
`zk-credits/x402`; package contents contain zero fixture files. No source
symlink, private policy file or new activation was used. Equal version numbers
do not establish registry parity. Nothing was published or deployed.

The actual paid invocation used source build
`0e6ac139ca065efe7e0c01f9161ef8c4bb7b49de914590dbde585171278cfd31`
and initial candidate tarball SHA-1
`e04ae4f2898b7e9ed3c95122e3901b36b10749cf`.
Later review fixes produce a different candidate; they do not turn the prior
attempt into live acceptance. See the final candidate identity below.

## Actual network attempt

```sh
zk-credits investigate --chain base 0x79c9d880aa711cbfea0f45739850e1a440a0f54274b19cbaef6fdcbf3a7007f1
```

Read-only preflight verified chain 8453, failed receipt and canonical block,
then fetched original public Tenderly execution evidence bound to the same
transaction/block. The installed command fetched these again, with no recorded
fixture substitution. It returned cited observed facts: failed execution and
`Error("p address!")`. It produced no supported model diagnosis or next action.

The [redacted invocation summary](founder-live-attempt-2026-10-07.json) records:

- One accepted 402 challenge and local retirement after proof preparation.
- Zero validated confirmed consumed credits; one retired, unknown outcome.
- No successful model delivery observed; result `partial / inference_unavailable`.
- No exact execution-data payment, new funding, or replacement attempt.

The same task's private journal/artifacts remain in the normal owner-local
investigations directory. Raw proofs, headers, credential identifiers and
funding-to-spend links are excluded from this artifact. Local retirement cannot
establish consumption or failure. Preserve the state and reconcile the existing
outcome through an actually documented nonauthorizing operation; no live claim
status API is asserted here.

A subsequent read-only `/ready` check returned HTTP 503 with `baseRpc` failing
(`behind_head`); provider, database, root and verifier checks passed. This is a
service-readiness finding, **not proof of why the paid attempt failed or whether
the credit committed**. Reproducing the paid failure could authorize another
credit, so it was not attempted. Read-only inspection cannot establish its
root cause or settlement. Current credential funding was not independently
verified during this session; the funding acceptance box remains unchecked.

Investigated evidence is Base **mainnet**. Bundle funding uses Base **Sepolia**
test USDC; model calls consume offchain prepaid credits. The failed paid attempt
cannot support a claim of an entirely Sepolia or successfully paid diagnosis.

## Review and offline checks

Standards review found no hard convention violations. Its root-error attribution
finding was fixed with a regression: a caught child error cannot become the
transaction's returned error. The build resolver is now shared. Invocation-only
accounting is deliberately separate from recovered task counters; the unknown
fresh-proof guard has a regression that failed before the fix.

Spec review's root-error and actionable-error findings were fixed. Reports now
give RPC/model guidance and preserve unknown-outcome guidance during recovery.
The actual example's root error bytes were separately verified read-only after
review; no corrected paid invocation is claimed.

- Sidecar typecheck and package build: passed.
- Full sidecar suite: 142 tests passed.
- Full prepaid adapter suite: 22 tests passed.
- Unified investigator acceptance: controller/live, actual injected transport,
  subprocess ownership/recovery and 35 real service-class cases passed.
- Authentic evidence recordings: passed. They remain offline acceptance.
- Default prepaid smoke: SKIP. Live exact execution-data purchase: DISABLED.

## Remaining gates

[Package the founder command](https://github.com/mangekyou-labs/haze-api/issues/56)
is locally implemented. [Verify the live diagnosis and prepaid exchange](https://github.com/mangekyou-labs/haze-api/issues/57)
remains open pending a useful cited diagnosis, confirmed same-invocation payment,
model delivery, separately verified funding and successful rehearsal.
[Add the verified recording segment](https://github.com/mangekyou-labs/haze-api/issues/58)
remains gated on that verification. The coding demo is preserved, and investigator
recording boxes remain unchecked. Public release is coordinated separately
through [the release gate](https://github.com/mangekyou-labs/haze-api/issues/36).

## Final candidate and recovery

Final local candidate: zk-credits@0.2.11. Tarball SHA-256
`c25ff3b6a62ea75494938421c30aeaa4fe86be4097251f89ebcdb1b326173230`; source build
`c06bffb2c5b3dc440e070a5866d490df12770f6d2f293b6882ac4e9e7bf013cc`. This is the review-fixed candidate, not another
paid success. Installed-command recovery was checked with global network access
forced to throw: exit status 1, zero network calls, zero fresh challenges/credits,
prior unknown outcome retained and factual local evidence recovered. It explicitly
warns that current canonical state was not rechecked.

Final unified run: 144 controller/live checks, 18 injected sidecar checks and
35 service-class checks passed. The full sidecar suite passed 142 checks;
the prepaid adapter suite passed 22. Both review axes have no unresolved
definite implementation findings. Live acceptance remains open.
