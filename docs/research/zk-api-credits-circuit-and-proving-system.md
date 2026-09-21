# ZK API credits: circuit correctness and production proving system

**Research date:** 2026-09-20
**Scope:** compare the current Base circuit and bond contract with the original
ZK API Usage Credits proposal, assess production-readiness, and choose between
Circom/Groth16 and Noir/Barretenberg for a future Base mainnet release.
**Source policy:** primary sources and repository source code only.

## Executive conclusion

Do **not** run a production ceremony or deploy this circuit yet. The protocol
shape is a reasonable fixed-price specialization of the Ethereum Research
proposal, but the current share equation reveals the credential secret from a
single normal request. With public `x = request_signal`, `N = nullifier`, and
`y = share`, the circuit defines `y = secret*x + N`; therefore anyone computes
`secret = (y - N) / x` for every nonzero `x` in the BN254 field. This defeats
unlinkability, exposes every slot nullifier, and enables credential theft.

Independently, the currently compiled R1CS makes every intended private input
public. It reports 48 public inputs, zero private inputs, and six outputs. The
sidecar and gateway transport only six public signals, so the built circuit is
also incompatible with the verification envelope.

There is a second release blocker: the gateway rejects proofs more than 30
seconds in the future but has no lower freshness bound. Because historical
roots remain accepted and the prover chooses `timestamp_in`, a proof generated
with an old pre-expiry timestamp can be presented after the bundle expires.

After those findings are fixed, audited, and benchmarked, retain
**Circom + BN254 Groth16 for the first production version**. The implementation
already uses that stack; its small proofs and simple EVM verifier are a good fit
for the rare two-proof slashing transaction. Run a public circuit-specific
phase-2 ceremony only after the circuit, public-signal ABI, compiler, verifier
adapter, and deployment manifest are frozen. Do not migrate to Noir merely to
avoid a ceremony: Barretenberg's KZG-based BN254 system also uses a toxic-waste
SRS, although it is universal rather than circuit-specific
([Barretenberg trusted setup](https://github.com/AztecProtocol/aztec-packages/blob/next/barretenberg/trusted_setup.md),
[KZG documentation](https://github.com/AztecProtocol/aztec-packages/blob/next/barretenberg/cpp/src/barretenberg/commitment_schemes/kzg/README.md)).
Moreover, the current official Noir README explicitly says the implementation
has not been reviewed or audited and is not suitable for production
([Noir README](https://github.com/noir-lang/noir)).

This should remain a Base Sepolia design-partner pilot until the release
blockers and product demand are resolved. Mainnet does not help validate the
core user need.

## What the original proposal actually specifies

The original proposal has four essential properties:

1. A user deposits once, commits to a secret identity in a Merkle tree, and
   makes many unlinkable requests.
2. A ticket index contributes to an RLN slope; reusing an index for two
   different messages exposes enough algebraic information to recover the
   identity secret and slash it.
3. Variable-price requests use a maximum up-front charge plus privately
   accumulated server-signed refunds, proving
   `(i + 1) * C_max <= deposit + refunds`.
4. A separate policy stake may be burned for policy violations so the server
   cannot profit from fabricating them.

The proposal explicitly calls fixed-cost APIs a simpler special case. Its
published equations are `a = Hash(k, i)`, `x = Hash(message)`,
`y = k + a*x`, and `nullifier = Hash(a)`
([Crapis and Buterin, ZK API Usage Credits](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104/1)).

Comment 30 narrows the most credible product boundary: ordinary x402 wallet
sessions can be much simpler when linkability is acceptable; ZK is most useful
when agents funded by the same principal must not be correlated. It also warns
that request content, latency, and token counts remain a separate fingerprint
([WGlynn, comment 30](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104/30)).

## How the current design compares

| Property | Original proposal | Current Base design | Assessment |
|---|---|---|---|
| Accounting | Variable cost, refund accumulator, solvency proof | Fixed call bundles and `slot < tierAllowance` | Valid intentional specialization; substantially simpler. |
| Economic value | Deposit funds usage and guarantees provider payment | Stripe service fee pays provider; Base holds a refundable anti-double-spend bond | Different economic model, not a faithful implementation of the paper's payment guarantee. Document it as a variant. |
| Identity | `ID = Hash(k)` in Merkle tree | `commitment = Poseidon(secret)`, leaf binds tier and expiry | Sound shape under Poseidon collision resistance and exact cross-implementation compatibility. |
| Double-spend algebra | `a = Hash(k,i)` and `y = k + a*x`; two signals recover `a`, then `k` | `y = secret*x + N`, while `x`, `N`, and `y` are public | **Critically broken:** one proof reveals `secret = (y-N)/x` whenever `x != 0`. This is not a secure RLN variant. |
| Nullifier | `Hash(Hash(k,i))` | `Poseidon(secret, slot, domain)` | Reasonable domain-separated slot nullifier, but a deviation from the proposal. |
| Ticket order | Strictly increasing counter | Any slot below the tier allowance; local client chooses the next slot | Safe if nullifier uniqueness is globally enforced; allows concurrency. |
| Variable refunds | Core mechanism | Omitted | Correct for a fixed-price MVP. |
| Policy stake | Separate burn-only stake | Omitted | Correctly out of current scope; do not imply policy enforcement. |
| Settlement | Server checks spent tickets | Off-chain reserve/commit/cancel with encrypted replay | Strong operational addition for exact retries, but correctness depends on one authoritative claim store. |
| Privacy boundary | Payment/request unlinkability, not necessarily content secrecy | Same; OpenRouter and gateway see prompt/timing | Correctly caveated in the design. |

The fixed allowance avoids the proposal's most complex refund circuits. It is
therefore a good startup simplification. It should be marketed as **private
fixed-price prepaid authorization backed by a slashable bond**, not as a full
implementation of the proposal's variable-cost payment-guarantee protocol.

## Circuit and integration review

### Blocker 1: one proof reveals the secret

The circuit publishes `request_signal`, `nullifier`, and `share` and constrains:

```text
N = Poseidon(secret, slot, domain)
y = secret*x + N  (mod BN254 field)
```

Since all three of `x`, `N`, and `y` are public, a verifier or passive observer
does not need a double spend. For any nonzero request signal it computes:

```text
secret = (y - N) * inverse(x)  (mod BN254 field)
```

The contract's two-proof calculation obscures this because subtracting the two
shares also recovers the coefficient `secret`, but the public intercept `N`
already makes one equation sufficient. A zero signal is not a mitigation: the
request hash is normally nonzero, and security cannot depend on it being zero.

Restore a reviewed RLN construction rather than patching around this equation.
The original proposal uses hidden `a = Hash(k, i)`, public
`N = Hash(a)`, and `y = k + a*x`. From two shares with the same nullifier and
different `x`, the reporter computes:

```text
a = (y1 - y2) / (x1 - x2)
k = y1 - a*x1
```

and checks both `Hash(a) == N` and `Hash(k) == commitment`. One share does not
expose `a` because only its hash is public. The production construction should
also domain-separate `a` by deployment and slot, specify Poseidon arities and
encodings exactly, and receive independent cryptographic review. The circuit,
contract recovery code, client helper, fixtures, and tests must change together.

### Blocker 2: the current R1CS has no private inputs

The source labels `secret`, `tier_id`, `expiry`, `slot`, and both Merkle-path
arrays as private witnesses, but ends with:

```circom
component main = PrivateCreditSpend(20);
```

The worktree currently builds with global Circom `0.5.46`. Fresh inspection of
the resulting artifact produced:

```text
Curve: bn-128
# of Wires: 10638
# of Constraints: 10621
# of Private Inputs: 0
# of Public Inputs: 48
# of Outputs: 6
```

Therefore the proof statement contains the secret, tier, expiry, slot, 40 path
values/directions, four challenge inputs, and six outputs. The transport then
throws away the prover's returned public-signal array and constructs a new
six-element array manually. A verifying key generated from this R1CS cannot
verify that six-element statement.

Current Circom documentation says non-listed main inputs are private and
outputs are always public, but that is not the behavior of the old compiler
used for this artifact
([Circom main component documentation](https://github.com/iden3/circom/blob/master/mkdocs/docs/circom-language/the-main-component.md)).
The production fix must include all of the following, not merely a comment:

- pin a reviewed Circom 2 compiler version and add a matching `pragma`;
- make the public/private declaration explicit;
- rebuild and assert exactly six public outputs and 48 private inputs (or
  redesign the ABI deliberately);
- use the `fullProve` result's public signals and compare them byte-for-byte to
  locally expected values instead of discarding them;
- generate the verifier only from the audited R1CS hash.

The existing witness tests check constraint satisfaction but not public/private
visibility, which is why they do not catch this failure.

### Blocker 3: expired credentials can use stale timestamps

The circuit proves only `timestamp_in < expiry`; it does not prove that the
timestamp is current. The gateway checks:

```text
timestamp <= gateway_now + 30 seconds
```

but imposes no `timestamp >= gateway_now - maxProofAge`. Because the contract
retains all historical roots, an old proof timestamp remains compatible with
an old known root after expiry. The request signal binds the request but does
not make the prover-selected timestamp fresh.

Add a short, explicit maximum proof age at the gateway and test rejection at
expiry and after expiry. The on-chain slashing verifier may continue accepting
historical evidence during the challenge window; spend authorization and
conflict evidence need separate timestamp policies.

### Blocker 4: the real on-chain verifier path does not exist yet

`PrivateCreditBond` depends on an `ISpendVerifier` adapter, while contract tests
use a deterministic mock. There is no generated Solidity Groth16 verifier or
production adapter in `contracts/src`. This means current tests establish the
bond state machine, not proof-to-contract correctness.

Before deployment, add end-to-end vectors that:

- generate a proof with the exact production R1CS/zkey;
- verify the same six public signals in snarkjs and the Solidity adapter;
- reject every reordered, omitted, non-canonical, or out-of-field signal;
- verify both proofs in `slashBundle`, recover the expected secret, and bind it
  to the funded commitment;
- prove the Circom Poseidon constants and the deployed T2/T3/T4 bytecode agree
  for commitments, leaves, nullifiers, zero hashes, and non-zero tree paths.

### Important protocol risks after the blockers

- **Global uniqueness is operational, not on-chain.** Normal calls are settled
  in a database. Independent gateways can accept the same nullifier unless
  they share claims/evidence or reconcile conflicts. This is acceptable for a
  single-gateway beta, not permissionless portability without an explicit
  cross-gateway risk model.
- **Exact-signal reuse is intentionally not slashable.** Shared replay storage
  must be authoritative across gateway replicas so a duplicated exact request
  cannot obtain service twice.
- **Historical roots require revocation.** After slashing, enumerating up to
  75,000 slot nullifiers is bounded but should be benchmarked so event-cursor
  processing cannot become a denial-of-service point.
- **Evidence retention is a scaling cost.** One encrypted first proof per used
  nullifier retained through expiry plus seven days can become tens of
  gigabytes at startup traffic. Store compact binary proofs, define deletion
  evidence, and load-test the vault independently of the claim database.
- **The 20-level tree caps registrations at 1,048,576 bundles.** That is ample
  for validation and early scale but is a fixed deployment limit because the
  contract is immutable.

## Groth16 versus Noir/Barretenberg

| Criterion | Circom + Groth16 | Noir + Barretenberg UltraHonk | Decision for this product |
|---|---|---|---|
| Setup | Universal Powers of Tau plus a circuit-specific phase 2 | Universal BN254 KZG SRS; no app-specific phase 2, but still a toxic-waste assumption | Groth16's ceremony is extra work, but manageable once after circuit freeze. |
| Proof/EVM shape | Groth16 uses three proof group elements; snarkjs exports a compact Solidity verifier | Honk Solidity generation deploys verifier libraries and a verifier contract | Groth16 is the simpler and likely cheaper rare-slash path; benchmark exact artifacts before final claims. |
| Existing implementation | Circuit, JS proving, JS verification, payload ABI all target it | Requires rewriting the circuit, proof envelope, gateway verifier, sidecar, adapter, tests, and audit scope | Groth16 wins decisively for shipping speed and change risk. |
| Maturity signal | snarkjs documents the complete MPC, verification, beacon, proof, and Solidity-export workflow | Current Noir README says unaudited/not production-suitable; Barretenberg README labels the code highly experimental | Do not make a mainnet launch depend on a migration now. |
| Circuit changes | Any constraint change requires a new phase 2 and verifier | Universal SRS avoids circuit-specific ceremony | Revisit only if frequent post-launch circuit changes become a demonstrated need. |
| Per-call scale | Proof generation occurs client-side; verification is off-chain per call | Same architecture, with different prover/runtime characteristics | Benchmark browser/mobile p50/p95 before deciding; framework labels are not performance evidence. |

snarkjs documents that Groth16 requires a ceremony for each circuit, whereas its
PLONK/FFLONK modes reuse universal Powers of Tau. It also warns that a fresh
Groth16 zkey with no contribution is unsafe for production and documents
contributions, transcript verification, a final beacon, verification-key
export, and Solidity-verifier generation
([snarkjs documentation](https://github.com/iden3/snarkjs)). Groth16's original
construction has a three-group-element proof
([Groth16 paper](https://eprint.iacr.org/2016/260)).

Barretenberg does not remove setup trust. Its official KZG documentation says
verification uses a trusted SRS of powers of secret `tau`; its setup document
describes 100.8 million BN254 G1 points and a G2 point produced by participant
updates. The current Noir Solidity example generates an EVM-targeted key and
proof, then deploys transcript/relation libraries plus the Honk verifier
([Noir Solidity verifier example](https://github.com/noir-lang/noir/blob/master/examples/solidity_verifier/solidity_verifier.sh)).

### Recommended production ceremony

Only after the blockers are fixed and an external review accepts the circuit:

1. Freeze and publish hashes for the compiler binary, source tree, R1CS, WASM,
   constraint/public-signal report, and test vectors.
2. Select and verify a known BN254 Powers of Tau transcript large enough for
   the **final** constraint count; do not size it from today's broken artifact.
3. Generate the phase-2 initial zkey reproducibly and prove it belongs to the
   exact frozen R1CS.
4. Collect multiple independent, geographically/organizationally diverse
   contributions with public transcript hashes and contributor attestations.
5. Apply a future, publicly committed random beacon; verify the complete final
   transcript and final zkey from clean environments.
6. Export the verification key and Solidity verifier, then run cross-language
   and on-chain positive/negative vectors. Record deployed verifier bytecode,
   VK, circuit, zkey, and ceremony transcript hashes in one signed manifest.
7. Treat any circuit, compiler, public-signal order, or verifier change as a
   new release requiring review and a new phase 2.

Do not call an internally generated development zkey a ceremony, and do not run
the ceremony before the audit is stable enough that circuit changes are
unlikely.

## Startup-scale assessment

The cryptography is not the likely first scaling limit once corrected:

- normal API calls do not transact on Base;
- clients generate proofs, distributing proving CPU;
- gateways verify off-chain and can scale horizontally around one strongly
  consistent claim store;
- on-chain proof verification occurs only when reporting a double spend.

The first limits are more likely browser proving latency/memory, proof
verification CPU, claim-store contention, encrypted evidence retention,
OpenRouter cost/latency, and slash-revocation rebuild time. Establish a load
envelope before mainnet with measured p50/p95/p99 for proof generation on
representative laptops, gateway verification throughput per core, concurrent
reservation contention, database storage per million settled calls, replay
vault growth, and 75,000-nullifier revocation time.

For fast validation, cap the pilot at one gateway, one protected endpoint, one
fixed-cost tier, and a small number of design partners. The current three-tier
and 75,000-slot maximum can remain in code, but scale claims should be based on
those measurements rather than proving-system reputation.

## Release gates in order

1. Replace the single-proof secret-leaking share/nullifier equations with a
   reviewed RLN construction and update circuit, client, and contract recovery.
2. Pin/upgrade Circom and fix the private/public signal ABI.
3. Add proof freshness and expiry enforcement to the gateway.
4. Implement the real Solidity verifier adapter and cross-implementation tests.
5. Obtain an independent cryptographic review and contract/circuit audit.
6. Benchmark browser proving, gateway verification, evidence storage, and
   revocation enumeration on Base Sepolia.
7. Validate paid demand with design partners using Sepolia.
8. Freeze artifacts, run the Groth16 phase-2 ceremony, verify/deploy artifacts,
   and only then consider Base mainnet.

## Primary sources

- [ZK API Usage Credits: LLMs and Beyond](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104/1)
- [Comment 30: x402 sessions and the multi-agent privacy boundary](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104/30)
- [Circom main component and public/private signals](https://github.com/iden3/circom/blob/master/mkdocs/docs/circom-language/the-main-component.md)
- [snarkjs proving systems, MPC, Groth16 ceremony, and Solidity export](https://github.com/iden3/snarkjs)
- [Groth16 paper](https://eprint.iacr.org/2016/260)
- [Noir official repository](https://github.com/noir-lang/noir)
- [Noir Solidity verifier example](https://github.com/noir-lang/noir/blob/master/examples/solidity_verifier/solidity_verifier.sh)
- [Barretenberg trusted setup format](https://github.com/AztecProtocol/aztec-packages/blob/next/barretenberg/trusted_setup.md)
- [Barretenberg KZG documentation](https://github.com/AztecProtocol/aztec-packages/blob/next/barretenberg/cpp/src/barretenberg/commitment_schemes/kzg/README.md)
