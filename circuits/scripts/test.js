const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const CIRCUITS_DIR = path.join(__dirname, "..");
const VERIFIERS = {
  deposit: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_deposit.json"))),
  rln: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_rln.json"))),
  slash: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_slash.json"))),
};

function randField() {
  const hex = crypto.randomBytes(31).toString("hex");
  return BigInt("0x" + hex);
}

async function fullProve(input, wasm, zkey) {
  return snarkjs.groth16.fullProve(input, wasm, zkey);
}

async function testDeposit() {
  console.log("\n=== T-circuit-1: Valid deposit_membership proof verifies ===");
  const sk = randField();
  const { proof, publicSignals } = await fullProve(
    {
      secret_k: sk.toString(),
      merkle_path_elements: ["0", "0", "0"],
      merkle_path_indices: ["0", "0", "0"],
    },
    path.join(CIRCUITS_DIR, "deposit_membership.wasm"),
    path.join(CIRCUITS_DIR, "deposit_membership_final.zkey")
  );
  const valid = await snarkjs.groth16.verify(VERIFIERS.deposit, publicSignals, proof);
  console.log(`  root: ${publicSignals[0]}, commitment: ${publicSignals[1]}`);
  console.log(`  valid: ${valid}`);
  if (!valid) throw new Error("T-circuit-1 FAILED");
  console.log("  T-circuit-1 PASSED");
}

async function testRln() {
  console.log("\n=== T-circuit-3: Valid rln_nullifier proof verifies ===");
  const sk = randField();
  const sig = randField();
  const epoch = randField();
  const { proof, publicSignals } = await fullProve(
    {
      secret_k: sk.toString(),
      signal_value: sig.toString(),
      epoch: epoch.toString(),
      merkle_path_elements: ["0", "0", "0"],
      merkle_path_indices: ["1", "0", "1"],
    },
    path.join(CIRCUITS_DIR, "rln_nullifier.wasm"),
    path.join(CIRCUITS_DIR, "rln_nullifier_final.zkey")
  );
  const valid = await snarkjs.groth16.verify(VERIFIERS.rln, publicSignals, proof);
  console.log(`  root: ${publicSignals[0]}, nullifier: ${publicSignals[1]}`);
  console.log(`  share: (${publicSignals[2]}, ${publicSignals[3]})`);
  console.log(`  epoch (input): ${epoch}`);
  console.log(`  valid: ${valid}`);
  if (!valid) throw new Error("T-circuit-3 FAILED");
  console.log("  T-circuit-3 PASSED");
  return { epoch, publicSignals };
}

async function testSlash() {
  console.log("\n=== T-rln-2: Valid slash proof verifies ===");
  const sk = randField();
  const epoch = randField();

  const proof1 = await fullProve(
    { secret_k: sk.toString(), signal_value: "1", epoch: epoch.toString(), merkle_path_elements: ["0", "0", "0"], merkle_path_indices: ["0", "0", "0"] },
    path.join(CIRCUITS_DIR, "rln_nullifier.wasm"),
    path.join(CIRCUITS_DIR, "rln_nullifier_final.zkey")
  );

  const proof2 = await fullProve(
    { secret_k: sk.toString(), signal_value: "2", epoch: epoch.toString(), merkle_path_elements: ["0", "0", "0"], merkle_path_indices: ["0", "0", "0"] },
    path.join(CIRCUITS_DIR, "rln_nullifier.wasm"),
    path.join(CIRCUITS_DIR, "rln_nullifier_final.zkey")
  );

  // publicSignals: [root, nullifier, share_x, share_y]
  const share1_x = proof1.publicSignals[2];
  const share1_y = proof1.publicSignals[3];
  const share2_x = proof2.publicSignals[2];
  const share2_y = proof2.publicSignals[3];

  console.log(`  Share 1: (${share1_x}, ${share1_y})`);
  console.log(`  Share 2: (${share2_x}, ${share2_y})`);

  const { proof, publicSignals } = await fullProve(
    {
      share1_x, share1_y, share2_x, share2_y,
      epoch: epoch.toString(),
    },
    path.join(CIRCUITS_DIR, "slash.wasm"),
    path.join(CIRCUITS_DIR, "slash_final.zkey")
  );

  const valid = await snarkjs.groth16.verify(VERIFIERS.slash, publicSignals, proof);
  console.log(`  Extracted secret_k: ${publicSignals[0]}`);
  console.log(`  Original secret_k:  ${sk.toString()}`);
  console.log(`  Match (original == extracted): ${publicSignals[0] === sk.toString()}`);
  console.log(`  valid: ${valid}`);
  if (!valid) throw new Error("T-rln-2 FAILED");
  console.log("  T-rln-2 PASSED");
}

async function main() {
  try {
    await testDeposit();
    await testRln();
    await testSlash();
    console.log("\n✅ All circuit tests passed");
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
}

main();
