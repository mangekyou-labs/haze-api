const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snarkjs = require('snarkjs');
const { g1ToHex, g2ToHex } = require('../../scripts/vk-convert.js');

const CIRCUITS_DIR = path.join(__dirname, '..');
const FIXTURES_DIR = path.join(CIRCUITS_DIR, '..', 'test_fixtures');
const MERKLE_PATH_ELEMENTS = ['0', '0', '0'];
const MERKLE_PATH_INDICES = ['0', '0', '0'];
const SECRET_K = '12345';
const VERIFICATION_KEY_NAMES = {
  rln_nullifier: 'rln',
  membership_removal: 'membership_removal',
  slash: 'slash',
};

function fieldToHex(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function proofToFixture({ proof, publicSignals }) {
  return {
    proof_a: g1ToHex(proof.pi_a),
    proof_b: g2ToHex(proof.pi_b),
    proof_c: g1ToHex(proof.pi_c),
    public_signals: publicSignals.map(fieldToHex),
  };
}

async function prove(name, input) {
  const result = await snarkjs.groth16.fullProve(
    input,
    path.join(CIRCUITS_DIR, `${name}.wasm`),
    path.join(CIRCUITS_DIR, `${name}_final.zkey`),
  );
  const vk = JSON.parse(
    fs.readFileSync(
      path.join(CIRCUITS_DIR, `verification_key_${VERIFICATION_KEY_NAMES[name]}.json`),
      'utf8',
    ),
  );
  assert.equal(
    await snarkjs.groth16.verify(vk, result.publicSignals, result.proof),
    true,
    `${name} fixture must verify before it is persisted`,
  );
  return result;
}

function writeFixture(name, result) {
  const output = path.join(FIXTURES_DIR, `${name}_proof_fixture.json`);
  fs.writeFileSync(output, `${JSON.stringify(proofToFixture(result), null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), output)}`);
}

async function main() {
  const rlnOne = await prove('rln_nullifier', {
    secret_k: SECRET_K,
    ticket_index: '9',
    request_digest: '1',
    merkle_path_elements: MERKLE_PATH_ELEMENTS,
    merkle_path_indices: MERKLE_PATH_INDICES,
  });
  const rlnTwo = await prove('rln_nullifier', {
    secret_k: SECRET_K,
    ticket_index: '9',
    request_digest: '2',
    merkle_path_elements: MERKLE_PATH_ELEMENTS,
    merkle_path_indices: MERKLE_PATH_INDICES,
  });
  const membership = await prove('membership_removal', {
    secret_k: SECRET_K,
    merkle_path_elements: MERKLE_PATH_ELEMENTS,
    merkle_path_indices: MERKLE_PATH_INDICES,
  });
  const slash = await prove('slash', {
    share1_x: rlnOne.publicSignals[2],
    share1_y: rlnOne.publicSignals[3],
    share2_x: rlnTwo.publicSignals[2],
    share2_y: rlnTwo.publicSignals[3],
    merkle_path_elements: MERKLE_PATH_ELEMENTS,
    merkle_path_indices: MERKLE_PATH_INDICES,
  });

  assert.equal(rlnOne.publicSignals.length, 4, 'RLN signal layout changed');
  assert.equal(membership.publicSignals.length, 3, 'membership signal layout changed');
  assert.equal(slash.publicSignals.length, 9, 'slash signal layout changed');
  assert.equal(slash.publicSignals[0], SECRET_K, 'slash did not recover the fixture secret');
  assert.equal(slash.publicSignals[1], membership.publicSignals[0], 'commitment mismatch');
  assert.equal(slash.publicSignals[3], rlnOne.publicSignals[0], 'slash root does not match RLN root');
  assert.equal(slash.publicSignals[3], membership.publicSignals[1], 'slash root does not match withdrawal root');
  assert.equal(slash.publicSignals[4], membership.publicSignals[2], 'removal roots differ');
  assert.notEqual(slash.publicSignals[3], slash.publicSignals[4], 'removal must change the root');

  writeFixture('rln', rlnOne);
  writeFixture('membership_removal', membership);
  writeFixture('slash', slash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
