const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");

const CIRCUITS_DIR = path.join(__dirname, "..");

async function proveDeposit(secret_k, merkle_path_elements, merkle_path_indices) {
  const input = {
    secret_k,
    merkle_path_elements,
    merkle_path_indices,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(CIRCUITS_DIR, "deposit_membership.wasm"),
    path.join(CIRCUITS_DIR, "deposit_membership_final.zkey")
  );
  return { proof, publicSignals };
}

async function proveRlnNullifier(secret_k, ticket_index, request_digest, merkle_path_elements, merkle_path_indices) {
  const input = {
    secret_k,
    ticket_index,
    request_digest,
    merkle_path_elements,
    merkle_path_indices,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(CIRCUITS_DIR, "rln_nullifier.wasm"),
    path.join(CIRCUITS_DIR, "rln_nullifier_final.zkey")
  );
  return { proof, publicSignals };
}

async function proveMembershipRemoval(secret_k, merkle_path_elements, merkle_path_indices) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      secret_k,
      merkle_path_elements,
      merkle_path_indices,
    },
    path.join(CIRCUITS_DIR, "membership_removal.wasm"),
    path.join(CIRCUITS_DIR, "membership_removal_final.zkey")
  );
  return { proof, publicSignals };
}

async function proveSlash(
  share1_x,
  share1_y,
  share2_x,
  share2_y,
  merkle_path_elements,
  merkle_path_indices
) {
  const input = {
    share1_x,
    share1_y,
    share2_x,
    share2_y,
    merkle_path_elements,
    merkle_path_indices,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(CIRCUITS_DIR, "slash.wasm"),
    path.join(CIRCUITS_DIR, "slash_final.zkey")
  );
  return { proof, publicSignals };
}

async function verify(circuitName, proof, publicSignals) {
  const vk = JSON.parse(
    fs.readFileSync(path.join(CIRCUITS_DIR, `verification_key_${circuitName}.json`), "utf8")
  );
  return await snarkjs.groth16.verify(vk, publicSignals, proof);
}

if (require.main === module) {
  const secret_k = 42n;
  const vk_deposit = JSON.parse(
    fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_deposit.json"), "utf8")
  );
  console.log("Verification key loaded. Circuits ready for proving.");
  console.log("Use: const { proof, publicSignals } = await proveDeposit(sk, path, indices);");
}

module.exports = {
  proveDeposit,
  proveRlnNullifier,
  proveMembershipRemoval,
  proveSlash,
  verify,
};
