const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");

const CIRCUITS_DIR = path.join(__dirname, "..");

async function main() {
  const sk = "42";
  const input = {
    secret_k: sk,
    merkle_path_elements: ["0", "0", "0"],
    merkle_path_indices: ["0", "0", "0"],
  };

  console.log("Input:", JSON.stringify(input));

  // Step 1: Generate witness
  console.time("wtns");
  const witness = await snarkjs.wtns.calculate(
    input,
    path.join(CIRCUITS_DIR, "deposit_membership.wasm"),
    path.join(CIRCUITS_DIR, "deposit_membership_witness.wtns")
  );
  console.timeEnd("wtns");
  console.log("Witness generated");

  // Check witness size
  const wtnsFile = fs.readFileSync(path.join(CIRCUITS_DIR, "deposit_membership_witness.wtns"));
  console.log(`Witness file size: ${wtnsFile.length}`);

  // Step 2: Export witness as JSON
  const wjson = await snarkjs.wtns.exportJson(
    path.join(CIRCUITS_DIR, "deposit_membership_witness.wtns")
  );
  console.log(`Witness length: ${wjson.length}`);

  // Show first few and last few values
  console.log("First 10 witness values:", wjson.slice(0, 10));
  console.log("Last 3 witness values (outputs):", wjson.slice(-3));

  // Step 3: Generate proof
  console.time("prove");
  const { proof, publicSignals } = await snarkjs.groth16.prove(
    path.join(CIRCUITS_DIR, "deposit_membership_final.zkey"),
    path.join(CIRCUITS_DIR, "deposit_membership_witness.wtns")
  );
  console.timeEnd("prove");
  console.log("Public signals:", publicSignals);

  // Step 4: Verify
  const vk = JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, "verification_key_deposit.json")));
  const valid = await snarkjs.groth16.verify(vk, publicSignals, proof);
  console.log("Verification:", valid);
}

main().catch(console.error);
