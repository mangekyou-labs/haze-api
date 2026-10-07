# First investigation

Run from the checkout root with Node 20+ and installed/built shared, x402,
sidecar and ts dependencies. Shared/x402 export generated `dist` files, so
installing the example alone is insufficient for unified lower-level checks.
The handoff reused installed checkout dependencies and exercised these builds:

```sh
npm run build --prefix packages/zk-credits-shared
npm run build --prefix packages/x402-zk-prepaid
npm ci --prefix examples/base-transaction-investigator
npm test --prefix examples/base-transaction-investigator
node examples/base-transaction-investigator/cli.mjs 8453 0x79c9d880aa711cbfea0f45739850e1a440a0f54274b19cbaef6fdcbf3a7007f1 /tmp/haze-first-investigation
```

For a clean checkout first install each package's locked dependencies (`npm ci`
in shared, x402, sidecar and ts, in that order); this installation requires
network. Offline acceptance then uses no network or credential. The handoff did
not reinstall the shared checkout's dependencies or establish registry parity.
Use a fresh private directory for a fresh investigation; repeating after restart
returns a factual recovered report without RPC/model authorization. The CLI
supports the included mainnet hash only; other hashes are unavailable.

## Actual fixture result

The exercised fresh command returns `coverage: supported`, `completion: partial`,
`diagnosis: insufficient_evidence`, `stoppingReason: missing_revert_evidence`.
`e1` transaction, `e2` failed receipt and `e3` canonical block agree on chain 8453,
block `0xc8b54b` and recorded hash. `e4` decodes historical end-of-block replay
`Error("p address!")`; this does not establish original execution cause. Facts
cite IDs, missing evidence and uncertainty explain the partial answer. Five tools,
zero purchases and zero inference requests/allocated/retired/confirmed/unknown
slots are reported. Journal and digest-bound artifacts are private local files.

## Necessary trace, skipped purchase and unresolved delivery

```sh
node --test --test-name-pattern='one bounded simulated trace|validated original public error skips trace purchase|partial explanation' examples/base-transaction-investigator/purchase.test.mjs
```

All three exercised tests pass. The necessary-evidence case records its named
question before quote/exposure, acquires one synthetic nested call tree, validates
tx/block and decoding and cites `calls.0`. It asserts a supported failure location
without inventing underlying cause, 1000 confirmed simulated minor units
(0.001000 USDC), zero live cost, validated delivery, journal agreement, one quote,
one acquisition and zero signatures. No inference runs in this case.
The public original-error case skips purchase. The partial case retains 1000 held
minor units with unknown settlement independently of missing delivery; its
explanation reports both. These assertions are controlled faults, not authentic
provider delivery. Model hypotheses must label missing evidence and a check;
reorganization clears old findings. The unified suite verifies unsupported claims,
retired slots, crash recovery, explicit reconciliation and subprocess exclusion.

## Reviewable first coding-task fix

The exact initial sample is in the [root README](../../README.md). Running
`node --test indexer.test.mjs` initially fails duplicate-log (2 instead of 1),
while distinct-log passes. Replace only `index` with:

```js
function index(logs) {
  const unique = new Map();
  for (const log of logs) {
    const key = JSON.stringify([log.chainId, log.transactionHash.toLowerCase(), log.logIndex]);
    if (!unique.has(key)) unique.set(key, log);
  }
  return [...unique.values()];
}
```

Keep original assertions; add:

```js
test('hash casing', () => assert.equal(index([a, { ...a, transactionHash: '0xAB' }]).length, 1));
test('different chains', () => assert.equal(index([a, { ...a, chainId: 8453 }]).length, 2));
```

All four exercised local tests pass, retaining first-seen logs and distinct
chain/log-index entries. No Codex launch or prepaid consumption ran here.

## Authentic recorded evidence

```sh
node --test examples/base-transaction-investigator/authentic-fixtures.test.mjs
```

Five checks exercise byte digests/binding and the four authentic fixture cases:
original nested failure, original out-of-gas execution error, an explicitly
unverified contract, and unavailable original trace. See the
[execution manifest](fixtures/execution-manifest.json) and [provenance notes](fixtures/README.md).
The nested report cites `calls.0.calls.0.calls.0` and decodes `p address!` without
claiming a token balance/allowance/policy cause. The execution-error report cites
the original root call's `out of gas`, independently bound to a failed receipt
and block. The missing-trace case remains partial with zero authorization.
Tenderly's unverified label is provider-local and current at recording time.
Each trace case uses 1000 simulated minor units and no live signing or inference;
recorded authentic execution data and simulated payment outcomes are distinct.

## Checks that remain separate

The [manifest](acceptance-manifest.json) lists all 13 offline controller cases
and actual transport/service-class checks, plus the four authentic cases above.
The exercised unified command reports authentic fixture acceptance as PASS after
all suites pass. This covers recorded evidence, not live purchased delivery.
Configured smoke defaults SKIP; native
activation, live proofs/model quality, registry parity and provider delivery were
not established. No deployment/publication/payment/exact signing occurred.
Providers see content/metadata, wallet purchases may link users, and copied
credentials on another device escape local exclusion. See [integration](README.md).
