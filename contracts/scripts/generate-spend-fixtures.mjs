// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Regenerate the real-proof fixture the Foundry spend suites consume.
 *
 *   node scripts/generate-spend-fixtures.mjs
 *
 * The script proves two transcripts for one throwaway credential against the
 * frozen development bundle in `packages/zk-credits-sidecar/circuits/artifacts`
 * and writes `test/fixtures/PrivateCreditSpendFixture.sol`. Foundry cannot
 * produce Groth16 proofs, so this fixture is the only way the generated
 * Solidity verifier is exercised with real proving material.
 *
 * The credential is the deterministic byte ramp pinned in
 * `packages/zk-credits-shared/src/base.test.ts`; it funds nothing and exists
 * only so the Foundry literals and the JS literals describe one credential.
 *
 * Payload convention: `PROOF_*` is the snarkjs `soliditycalldata` word list —
 * eight words for the Groth16 points followed by the six public signals in
 * canonical order `[root, timestamp, domain, requestSignal, nullifier, share]`.
 * `SpendVerifier` decodes exactly this layout.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { groth16 } = require(join(root, '..', 'circuits', 'node_modules', 'snarkjs'));
const {
  computeCreditLeaf,
  computeNullifier,
  computeShare,
  computeSlotBlinding,
  createCredential,
  deriveSparseCreditWitness,
  secretToField,
} = await import(join(root, '..', 'packages', 'zk-credits-shared', 'dist', 'base.js'));

const ARTIFACTS = join(root, '..', 'packages', 'zk-credits-sidecar', 'circuits', 'artifacts');
const MANIFEST = join(root, '..', 'packages', 'zk-credits-sidecar', 'circuits', 'manifest.json');
const WASM = join(ARTIFACTS, 'private_credit_spend.wasm');
const ZKEY = join(ARTIFACTS, 'private_credit_spend.zkey');
const VK = join(ARTIFACTS, 'verification_key_private_credit.json');
const OUT = join(root, 'test', 'fixtures', 'PrivateCreditSpendFixture.sol');

const TIER_ID = 0;
const CIRCUIT = 'private-credit-spend-bn254-dev';
const SLOT = 7;
const DOMAIN = '1234';
const EXPIRY = 1_800_000_000;
const TIMESTAMP = 1_797_400_000;
const SIGNALS = ['42', '99'];
const SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function toWords(proof, publicSignals) {
  // snarkjs `soliditycalldata` order: each Fp2 pair of pi_b is swapped
  // relative to the proof JSON, which is what the generated verifier consumes.
  return [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
    ...publicSignals,
  ].map((word) => BigInt(word));
}

/**
 * The payload layout is a convention, so it is checked against snarkjs itself
 * rather than trusted.
 */
async function assertCanonical(words, proof, publicSignals) {
  const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
  const canonical = [...calldata.matchAll(/0x[0-9a-f]+/g)].map((match) => BigInt(match[0]));
  if (canonical.length !== words.length || canonical.some((word, index) => word !== words[index])) {
    throw new Error('payload layout drifted from snarkjs soliditycalldata');
  }
}

/**
 * Proving material is accepted only if it matches the shipped manifest, so the
 * Foundry fixture cannot silently describe a different bundle.
 */
async function assertPinnedArtifacts() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  for (const file of [WASM, ZKEY, VK]) {
    const expected = manifest.artifacts.find((artifact) => artifact.file === basename(file))?.sha256;
    const actual = createHash('sha256').update(await readFile(file)).digest('hex');
    if (!expected || actual !== expected) throw new Error(`${basename(file)} is not the pinned bundle artifact`);
    console.log(`pinned ${basename(file)} ${actual}`);
  }
}

function encodeWords(words) {
  return `hex"${words.map((word) => word.toString(16).padStart(64, '0')).join('')}"`;
}

const verificationKey = JSON.parse(await readFile(VK, 'utf8'));
await assertPinnedArtifacts();
const credential = await createCredential(SECRET, TIER_ID, EXPIRY, DOMAIN);
const leaf = await computeCreditLeaf(credential.commitment, TIER_ID, EXPIRY);
const witness = await deriveSparseCreditWitness(new Map([[0, leaf]]), 0);
const secretField = secretToField(SECRET);
const slotBlinding = await computeSlotBlinding(SECRET, SLOT, DOMAIN);
const nullifier = await computeNullifier(slotBlinding);

const transcripts = [];
for (const signal of SIGNALS) {
  const input = {
    secret: secretField,
    tier_id: String(TIER_ID),
    expiry: String(EXPIRY),
    slot: String(SLOT),
    merkle_path_elements: witness.pathElements,
    merkle_path_indices: witness.pathIndices.map(String),
    root_in: witness.root,
    timestamp_in: String(TIMESTAMP),
    domain_in: DOMAIN,
    request_signal_in: signal,
  };
  console.log(`proving signal ${signal}`);
  const { proof, publicSignals } = await groth16.fullProve(input, WASM, ZKEY);
  console.log(`proved signal ${signal}; self-verifying`);
  if (!await groth16.verify(verificationKey, publicSignals, proof)) {
    throw new Error(`self-verification failed for signal ${signal}`);
  }
  const expected = [witness.root, String(TIMESTAMP), DOMAIN, signal, nullifier];
  if (publicSignals.length !== 6 || expected.some((value, index) => publicSignals[index] !== value)) {
    throw new Error(`unexpected public signals for signal ${signal}: ${publicSignals.join(',')}`);
  }
  transcripts.push({
    signal,
    share: await computeShare(SECRET, signal, slotBlinding),
    words: toWords(proof, publicSignals),
  });
  await assertCanonical(transcripts[transcripts.length - 1].words, proof, publicSignals);
}

const source = `// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Generated by contracts/scripts/generate-spend-fixtures.mjs - do not edit.
 *
 * One throwaway funded credential proved twice against the frozen development
 * bundle (circuit ${CIRCUIT}). The zkey, wasm, and verification key digests were
 * checked against packages/zk-credits-sidecar/circuits/manifest.json before
 * proving. Each proof is the snarkjs soliditycalldata word list, checked against
 * groth16.exportSolidityCallData at generation time: the two Fp2 pairs of pi_b
 * are swapped relative to the proof JSON, followed by the six public signals in
 * canonical order [root, timestamp, domain, requestSignal, nullifier, share].
 * The public signals are the same in both transcripts except for requestSignal:
 *   root ${witness.root}
 *   timestamp ${TIMESTAMP}
 *   domain ${DOMAIN}
 *   nullifier ${nullifier}
 *   shares ${transcripts.map(({ signal, share }) => `${signal} -> ${share}`).join(', ')}
 */
pragma solidity ^0.8.20;

library PrivateCreditSpendFixture {
    uint8 internal constant TIER_ID = ${TIER_ID};
    uint256 internal constant SLOT = ${SLOT};
    uint64 internal constant EXPIRY = ${EXPIRY};
    uint256 internal constant TIMESTAMP = ${TIMESTAMP};
    uint256 internal constant DOMAIN = ${DOMAIN};
    uint256 internal constant SECRET_FIELD = ${secretField};
    uint256 internal constant COMMITMENT = ${credential.commitment};
    uint256 internal constant LEAF = ${leaf};
    uint256 internal constant ROOT = ${witness.root};
    uint256 internal constant SLOT_BLINDING = ${slotBlinding};
    uint256 internal constant NULLIFIER = ${nullifier};
${transcripts
  .map(
    ({ signal, share, words }, index) => `    uint256 internal constant SIGNAL_${index + 1} = ${signal};
    uint256 internal constant SHARE_${index + 1} = ${share};
    bytes internal constant PROOF_${index + 1} = ${encodeWords(words)};`,
  )
  .join('\n')}
}
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, source);
console.log(`wrote ${OUT}`);
process.exit(0);
