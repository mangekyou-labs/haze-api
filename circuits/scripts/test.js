const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const CIRCUITS_DIR = path.join(__dirname, "..");
const VERIFIERS = {
  deposit: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_deposit.json"))),
  rln: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_rln.json"))),
  slash: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_slash.json"))),
  membershipRemoval: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_membership_removal.json"))),
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
  const ticketIndex = 7;
  const requestDigest = randField();
  const { proof, publicSignals } = await fullProve(
    {
      secret_k: sk.toString(),
      ticket_index: ticketIndex.toString(),
      request_digest: requestDigest.toString(),
      merkle_path_elements: ["0", "0", "0"],
      merkle_path_indices: ["1", "0", "1"],
    },
    path.join(CIRCUITS_DIR, "rln_nullifier.wasm"),
    path.join(CIRCUITS_DIR, "rln_nullifier_final.zkey")
  );
  const valid = await snarkjs.groth16.verify(VERIFIERS.rln, publicSignals, proof);
  console.log(`  root: ${publicSignals[0]}, nullifier: ${publicSignals[1]}`);
  console.log(`  share: (${publicSignals[2]}, ${publicSignals[3]})`);
  console.log(`  ticket index (input): ${ticketIndex}`);
  console.log(`  request digest (input): ${requestDigest}`);
  if (publicSignals.length !== 4) throw new Error("T-circuit-3 wrong public signal count");
  console.log(`  valid: ${valid}`);
  if (!valid) throw new Error("T-circuit-3 FAILED");
  console.log("  T-circuit-3 PASSED");
  return { sk, ticketIndex, requestDigest, publicSignals };
}

async function testTicketBound() {
  console.log("\n=== T-rln-1: Ticket index 100 is rejected ===");
  let valid = false;
  try {
    const { proof, publicSignals } = await fullProve(
      {
        secret_k: randField().toString(),
        ticket_index: "100",
        request_digest: "1",
        merkle_path_elements: ["0", "0", "0"],
        merkle_path_indices: ["0", "0", "0"],
      },
      path.join(CIRCUITS_DIR, "rln_nullifier.wasm"),
      path.join(CIRCUITS_DIR, "rln_nullifier_final.zkey")
    );
    valid = await snarkjs.groth16.verify(VERIFIERS.rln, publicSignals, proof);
  } catch {
    // A witness calculator is also permitted to reject an unsatisfied input.
    valid = false;
  }
  if (valid) throw new Error("T-rln-1 FAILED: index 100 produced a valid proof");
  console.log("  T-rln-1 PASSED");
}

async function testMembershipRemoval() {
  console.log("\n=== T-withdraw-1: Valid membership-removal proof verifies ===");
  const sk = randField();
  const { proof, publicSignals } = await fullProve(
    {
      secret_k: sk.toString(),
      merkle_path_elements: ["0", "0", "0"],
      merkle_path_indices: ["0", "0", "0"],
    },
    path.join(CIRCUITS_DIR, "membership_removal.wasm"),
    path.join(CIRCUITS_DIR, "membership_removal_final.zkey")
  );
  const valid = await snarkjs.groth16.verify(VERIFIERS.membershipRemoval, publicSignals, proof);
  if (publicSignals.length !== 3) throw new Error("T-withdraw-1 wrong public signal count");
  if (publicSignals[1] === publicSignals[2]) {
    throw new Error("T-withdraw-1 proof did not remove the commitment from the root");
  }
  console.log(`  commitment: ${publicSignals[0]}`);
  console.log(`  current root: ${publicSignals[1]}`);
  console.log(`  next root: ${publicSignals[2]}`);
  console.log(`  valid: ${valid}`);
  if (!valid) throw new Error("T-withdraw-1 FAILED");
  console.log("  T-withdraw-1 PASSED");
}

async function testSlash() {
  console.log("\n=== T-rln-2: Valid slash proof verifies ===");
  const sk = randField();

  const proof1 = await fullProve(
    { secret_k: sk.toString(), ticket_index: "9", request_digest: "1", merkle_path_elements: ["0", "0", "0"], merkle_path_indices: ["0", "0", "0"] },
    path.join(CIRCUITS_DIR, "rln_nullifier.wasm"),
    path.join(CIRCUITS_DIR, "rln_nullifier_final.zkey")
  );

  const proof2 = await fullProve(
    { secret_k: sk.toString(), ticket_index: "9", request_digest: "2", merkle_path_elements: ["0", "0", "0"], merkle_path_indices: ["0", "0", "0"] },
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
      merkle_path_elements: ["0", "0", "0"],
      merkle_path_indices: ["0", "0", "0"],
    },
    path.join(CIRCUITS_DIR, "slash.wasm"),
    path.join(CIRCUITS_DIR, "slash_final.zkey")
  );

  const valid = await snarkjs.groth16.verify(VERIFIERS.slash, publicSignals, proof);
  console.log(`  Extracted secret_k: ${publicSignals[0]}`);
  console.log(`  Original secret_k:  ${sk.toString()}`);
  console.log(`  Computed commitment: ${publicSignals[1]}`);
  console.log(`  Computed nullifier: ${publicSignals[2]}`);
  console.log(`  Current root: ${publicSignals[3]}`);
  console.log(`  Next root: ${publicSignals[4]}`);
  if (publicSignals.length !== 9) throw new Error("T-rln-2 wrong public signal count");
  if (publicSignals[3] !== proof1.publicSignals[0] || publicSignals[3] !== proof2.publicSignals[0]) {
    throw new Error("T-rln-2 slash proof did not bind the RLN membership root");
  }
  if (publicSignals[3] === publicSignals[4]) {
    throw new Error("T-rln-2 slash proof did not remove the commitment from the root");
  }
  console.log(`  Match (original == extracted): ${publicSignals[0] === sk.toString()}`);
  console.log(`  valid: ${valid}`);
  if (!valid) throw new Error("T-rln-2 FAILED");
  console.log("  T-rln-2 PASSED");
}

async function main() {
  try {
    await testDeposit();
    await testRln();
    await testTicketBound();
    await testMembershipRemoval();
    await testSlash();
    console.log("\n✅ All circuit tests passed");
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
}

main();
