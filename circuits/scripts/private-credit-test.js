// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Constraint-level tests for the Base private-credit circuit.
 *
 * A proving key is intentionally not checked into the repository.  CI runs
 * these witness tests on every change; the Sepolia release job adds a pinned
 * development zkey and verification key produced by the ceremony workflow.
 *
 * Root compiled artifacts (circuits/private_credit_spend.{r1cs,wasm}) are
 * negative fixtures for the rejected algebra and must not be overwritten.
 * They are gitignored, so a clean checkout legitimately lacks them.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const snarkjs = require('snarkjs');
const { readR1cs } = require('r1csfile');
const { buildPoseidon } = require('circomlibjs');

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const BUILD_DIR = path.join(__dirname, '..', 'build', 'private-credit');
const R1CS = path.join(BUILD_DIR, 'private_credit_spend.r1cs');
const WASM = path.join(BUILD_DIR, 'private_credit_spend.wasm');
const WASM_JS = path.join(BUILD_DIR, 'private_credit_spend_js', 'private_credit_spend.wasm');
const CIRCUIT_SRC = path.join(__dirname, '..', 'private_credit_spend.circom');
const NEGATIVE_R1CS = path.join(__dirname, '..', 'private_credit_spend.r1cs');

function poseidonField(poseidon, inputs) {
  return BigInt(poseidon.F.toObject(poseidon(inputs.map((input) => BigInt(input)))));
}

function mod(value) {
  const result = value % FIELD;
  return result < 0n ? result + FIELD : result;
}

function modInverse(value) {
  let t = 0n;
  let newT = 1n;
  let r = FIELD;
  let newR = mod(value);
  if (newR === 0n) throw new Error('Value is not invertible');
  while (newR !== 0n) {
    const quotient = r / newR;
    [t, newT] = [newT, t - quotient * newT];
    [r, newR] = [newR, r - quotient * newR];
  }
  return mod(t);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function wasmPath() {
  try {
    await fs.access(WASM);
    return WASM;
  } catch {
    return WASM_JS;
  }
}

async function witnessSatisfies(input) {
  const output = path.join(os.tmpdir(), `private-credit-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wtns`);
  try {
    await snarkjs.wtns.calculate(input, await wasmPath(), output);
    return await snarkjs.wtns.check(R1CS, output);
  } catch {
    return false;
  } finally {
    await fs.rm(output, { force: true });
  }
}

async function publicSignals(input) {
  const output = path.join(os.tmpdir(), `private-credit-pub-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wtns`);
  try {
    await snarkjs.wtns.calculate(input, await wasmPath(), output);
    if (!(await snarkjs.wtns.check(R1CS, output))) throw new Error('witness did not satisfy the circuit');
    const values = await snarkjs.wtns.exportJson(output);
    return values.slice(1, 7).map((value) => BigInt(value));
  } finally {
    await fs.rm(output, { force: true });
  }
}

function merkleFromLeaf(poseidon, leaf) {
  const pathElements = Array(20).fill('0');
  const pathIndices = Array(20).fill('0');
  let node = leaf;
  for (let level = 0; level < 20; level += 1) {
    node = poseidonField(poseidon, [node, 0n]);
  }
  return { pathElements, pathIndices, root: node };
}

function fundedInput({ secret, tierId, expiry, slot, domain, requestSignal, poseidon }) {
  const commitment = poseidonField(poseidon, [secret]);
  const leaf = poseidonField(poseidon, [commitment, tierId, expiry]);
  const tree = merkleFromLeaf(poseidon, leaf);
  return {
    secret: secret.toString(),
    tier_id: tierId.toString(),
    expiry: expiry.toString(),
    slot: slot.toString(),
    merkle_path_elements: tree.pathElements,
    merkle_path_indices: tree.pathIndices,
    root_in: tree.root.toString(),
    timestamp_in: '1800000000',
    domain_in: domain.toString(),
    request_signal_in: requestSignal.toString(),
    expected: {
      commitment,
      leaf,
      root: tree.root,
      slotBlinding: poseidonField(poseidon, [secret, slot, domain]),
    },
  };
}

async function main() {
  const source = await fs.readFile(CIRCUIT_SRC, 'utf8');
  if (!/pragma circom 2\./u.test(source)) {
    throw new Error('spend circuit must declare Circom 2');
  }
  if (/component\s+main\s*\{/u.test(source)) {
    throw new Error('main must not also mark challenge values public');
  }

  const r1cs = await readR1cs(R1CS, { loadConstraints: false, loadMap: false });
  if (r1cs.nOutputs !== 6 || r1cs.nPubInputs !== 0 || r1cs.nPrvInputs !== 48) {
    throw new Error(`R1CS must be 6 public / 48 private (got outputs=${r1cs.nOutputs} pub=${r1cs.nPubInputs} prv=${r1cs.nPrvInputs})`);
  }

  // The root fixtures are gitignored, so a clean checkout has none. Check them
  // only when present, and say so either way: a missing fixture must never be
  // reported as an unchanged one.
  if (await fileExists(NEGATIVE_R1CS)) {
    const negative = await readR1cs(NEGATIVE_R1CS, { loadConstraints: false, loadMap: false });
    if (negative.nOutputs !== 6 || negative.nPubInputs !== 48 || negative.nPrvInputs !== 0) {
      throw new Error(
        `root compiled artifacts must remain the Circom 0.5 negative fixture (6 outputs / 48 public / 0 private, got outputs=${negative.nOutputs} pub=${negative.nPubInputs} prv=${negative.nPrvInputs})`,
      );
    }
    console.log('root negative fixture present and unchanged (6 outputs / 48 public / 0 private)');
  } else {
    console.log('root negative fixtures absent (gitignored); negative-fixture check skipped');
  }

  const poseidon = await buildPoseidon();
  const secret = 123456789n;
  const tierId = 0n;
  const expiry = 1_900_000_000n;
  const slot = 42n;
  const domain = 84532n;
  const requestSignal = 987654321n;
  const built = fundedInput({ secret, tierId, expiry, slot, domain, requestSignal, poseidon });
  const { expected, ...input } = built;
  const slotBlinding = expected.slotBlinding;
  const nullifier = poseidonField(poseidon, [slotBlinding]);
  const share = mod(secret + slotBlinding * requestSignal);
  const rejectedShare = mod(secret * requestSignal + poseidonField(poseidon, [secret, slot, domain]));

  if (!(await witnessSatisfies(input))) throw new Error('valid witness did not satisfy the circuit');

  const signals = await publicSignals(input);
  const [rootOut, timestampOut, domainOut, signalOut, nullifierOut, shareOut] = signals;
  if (rootOut !== expected.root) throw new Error('public root drifted');
  if (timestampOut !== 1_800_000_000n) throw new Error('public timestamp drifted');
  if (domainOut !== domain) throw new Error('public domain drifted');
  if (signalOut !== requestSignal) throw new Error('public request signal drifted');
  if (nullifierOut !== nullifier) throw new Error('public nullifier is not Poseidon(slotBlinding)');
  if (shareOut !== share) throw new Error('public share is not secret + slotBlinding * requestSignal');
  if (shareOut === rejectedShare) throw new Error('circuit still implements the rejected share equation');

  const slotZero = fundedInput({ secret, tierId, expiry, slot: 0n, domain, requestSignal, poseidon });
  delete slotZero.expected;
  if (!(await witnessSatisfies(slotZero))) throw new Error('slot 0 in [0, 250) did not satisfy');

  const slotLast = fundedInput({ secret, tierId, expiry, slot: 249n, domain, requestSignal, poseidon });
  delete slotLast.expected;
  if (!(await witnessSatisfies(slotLast))) throw new Error('slot 249 in [0, 250) did not satisfy');

  const invalidFixtures = [
    ['altered root', { ...input, root_in: (expected.root + 1n).toString() }],
    ['altered path', { ...input, merkle_path_elements: ['1', ...input.merkle_path_elements.slice(1)] }],
    ['altered tier', { ...input, tier_id: '1' }],
    ['altered expiry', { ...input, expiry: (expiry + 1n).toString() }],
    ['slot at allowance', { ...input, slot: '250' }],
    ['slot above the byte range', { ...input, slot: '256' }],
    ['expired timestamp', { ...input, timestamp_in: expiry.toString() }],
    ['zero secret', { ...input, secret: '0' }],
    ['zero request signal', { ...input, request_signal_in: '0' }],
    ['malformed field encoding', { ...input, request_signal_in: FIELD.toString() }],
  ];
  for (const [label, altered] of invalidFixtures) {
    if (await witnessSatisfies(altered)) throw new Error(`${label} unexpectedly satisfied the circuit`);
  }

  const otherTier = fundedInput({ secret, tierId: 1n, expiry, slot, domain, requestSignal, poseidon });
  delete otherTier.expected;
  if (await witnessSatisfies(otherTier)) throw new Error('non-funded tier unexpectedly satisfied the circuit');

  const otherSignal = 42n;
  const second = fundedInput({ secret, tierId, expiry, slot, domain, requestSignal: otherSignal, poseidon });
  delete second.expected;
  const firstSignals = signals;
  const secondSignals = await publicSignals(second);
  const share1 = firstSignals[5];
  const share2 = secondSignals[5];
  const x1 = firstSignals[3];
  const x2 = secondSignals[3];
  if (firstSignals[4] !== secondSignals[4]) throw new Error('same slot must keep the same nullifier');
  if (x1 === x2) throw new Error('recovery fixture needs distinct request signals');
  const recoveredBlinding = mod((share1 - share2) * modInverse(x1 - x2));
  const recoveredSecret = mod(share1 - recoveredBlinding * x1);
  if (recoveredBlinding !== slotBlinding) throw new Error('two-transcript recovery did not yield slot blinding');
  if (recoveredSecret !== secret) throw new Error('two-transcript recovery did not yield secret');
  if (poseidonField(poseidon, [recoveredBlinding]) !== nullifier) throw new Error('recovered blinding does not hash to nullifier');
  if (poseidonField(poseidon, [recoveredSecret]) !== expected.commitment) throw new Error('recovered secret does not hash to commitment');

  const oldRecovered = mod((share1 - firstSignals[4]) * modInverse(x1));
  if (oldRecovered === secret) throw new Error('one transcript under the rejected equation must not recover the secret');
  if (share1 === secret || share1 === slotBlinding) throw new Error('one share must not equal secret or slot blinding');

  console.log(`private-credit circuit witness checks passed (root ${expected.root.toString().slice(0, 12)}…)`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
