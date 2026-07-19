#!/usr/bin/env node
// Over-quota slash demo — demonstrates the full RLN slash flow
// Usage: node scripts/slash-demo.js
//
// Flow:
// 1. Generate secret_k + commitment
// 2. Create API key via gateway
// 3. Generate two RLN proofs with same epoch (same nullifier = double-spend)
// 4. Extract secret_k from the two shares via slash circuit
// 5. Submit slash proof on-chain (or demonstrate the extraction)

const crypto = require('crypto');
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'dev-secret';
const CIRCUITS_DIR = path.join(__dirname, '..', 'circuits');

const VERIFIERS = {
  slash: JSON.parse(fs.readFileSync(path.join(CIRCUITS_DIR, 'verification_key_slash.json'))),
};

async function main() {
  console.log('=== RLN Slash Demo ===\n');

  // Step 1: Generate identity
  console.log('1. Generating secret_k + commitment...');
  const secretK = crypto.randomBytes(31); // 31 bytes to stay in field
  const skField = BigInt('0x' + secretK.toString('hex'));

  const { publicSignals: depositSignals } = await snarkjs.groth16.fullProve(
    {
      secret_k: skField.toString(),
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    },
    path.join(CIRCUITS_DIR, 'deposit_membership.wasm'),
    path.join(CIRCUITS_DIR, 'deposit_membership_final.zkey'),
  );
  const commitment = depositSignals[1];
  console.log(`   secret_k: ${skField.toString().slice(0, 20)}...`);
  console.log(`   commitment: ${commitment.slice(0, 20)}...\n`);

  // Step 2: Create API key
  console.log('2. Creating API key...');
  const keyRes = await fetch(`${GATEWAY_URL}/v1/api-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_SECRET}`,
    },
    body: JSON.stringify({ commitment, label: 'slash-demo' }),
  });
  const keyData = await keyRes.json();
  console.log(`   API Key: ${keyData.apiKey?.slice(0, 20)}...\n`);

  // Step 3: Generate two RLN proofs in same epoch (different signals)
  // Same epoch + same secret_k = same nullifier = double-spend detected
  const epoch = Math.floor(Date.now() / 86400000).toString();
  console.log(`3. Generating two RLN proofs (epoch=${epoch})...`);

  const proof1Start = Date.now();
  const { proof: proof1, publicSignals: signals1 } = await snarkjs.groth16.fullProve(
    {
      secret_k: skField.toString(),
      signal_value: '1',
      epoch,
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    },
    path.join(CIRCUITS_DIR, 'rln_nullifier.wasm'),
    path.join(CIRCUITS_DIR, 'rln_nullifier_final.zkey'),
  );
  console.log(`   Proof 1 generated in ${Date.now() - proof1Start}ms`);
  console.log(`     root: ${signals1[0].slice(0, 20)}...`);
  console.log(`     nullifier: ${signals1[1].slice(0, 20)}...`);
  console.log(`     share_x: ${signals1[2].slice(0, 20)}...`);
  console.log(`     share_y: ${signals1[3].slice(0, 20)}...`);

  const proof2Start = Date.now();
  const { proof: proof2, publicSignals: signals2 } = await snarkjs.groth16.fullProve(
    {
      secret_k: skField.toString(),
      signal_value: '2',
      epoch,
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    },
    path.join(CIRCUITS_DIR, 'rln_nullifier.wasm'),
    path.join(CIRCUITS_DIR, 'rln_nullifier_final.zkey'),
  );
  console.log(`   Proof 2 generated in ${Date.now() - proof2Start}ms\n`);

  // Verify both proofs have the same nullifier
  const sameNullifier = signals1[1] === signals2[1];
  console.log(`   Same nullifier: ${sameNullifier}`);
  if (!sameNullifier) {
    console.error('   ERROR: Proofs should have same nullifier for same epoch!');
    process.exit(1);
  }

  // Step 4: Extract secret_k via slash circuit
  console.log('\n4. Extracting secret_k via slash circuit...');
  const share1_x = signals1[2];
  const share1_y = signals1[3];
  const share2_x = signals2[2];
  const share2_y = signals2[3];

  const slashStart = Date.now();
  const { proof: slashProof, publicSignals: slashSignals } = await snarkjs.groth16.fullProve(
    {
      share1_x, share1_y, share2_x, share2_y,
      epoch,
    },
    path.join(CIRCUITS_DIR, 'slash.wasm'),
    path.join(CIRCUITS_DIR, 'slash_final.zkey'),
  );
  console.log(`   Slash proof generated in ${Date.now() - slashStart}ms`);
  console.log(`   Extracted secret_k: ${slashSignals[0].slice(0, 20)}...`);
  console.log(`   Original secret_k: ${skField.toString().slice(0, 20)}...`);
  console.log(`   Match: ${slashSignals[0] === skField.toString()}`);

  // Verify the slash proof
  const valid = await snarkjs.groth16.verify(VERIFIERS.slash, slashSignals, slashProof);
  console.log(`   Slash proof valid: ${valid}\n`);

  // Step 5: Submit first proof to gateway (should succeed)
  console.log('5. Submitting first RLN proof to gateway...');
  const proofHeader1 = Buffer.from(JSON.stringify({
    proof: proof1,
    pubSignals: signals1,
  })).toString('base64');

  const call1Res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keyData.apiKey}`,
      'X-ZK-Proof': proofHeader1,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-opus-4',
      messages: [{ role: 'user', content: 'Say "hello"' }],
    }),
  });
  const call1Data = await call1Res.json();
  console.log(`   Status: ${call1Res.status}`);
  console.log(`   Response: ${call1Data.choices?.[0]?.message?.content?.slice(0, 60) || call1Data.error}\n`);

  // Step 6: Submit second proof with SAME nullifier (should fail with 403)
  console.log('6. Submitting second proof with same nullifier (over-quota)...');
  const proofHeader2 = Buffer.from(JSON.stringify({
    proof: proof2,
    pubSignals: signals2,
  })).toString('base64');

  const call2Res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keyData.apiKey}`,
      'X-ZK-Proof': proofHeader2,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-opus-4',
      messages: [{ role: 'user', content: 'This should be rejected' }],
    }),
  });
  const call2Data = await call2Res.json();
  console.log(`   Status: ${call2Res.status} (expected 403)`);
  console.log(`   Error: ${call2Data.error}`);
  console.log(`   Message: ${call2Data.message}\n`);

  // Step 7: Summary
  console.log('=== Slash Demo Summary ===');
  console.log(`Secret_k extracted: ${slashSignals[0] === skField.toString() ? 'YES' : 'NO'}`);
  console.log(`Nullifier collision detected: ${sameNullifier ? 'YES' : 'NO'}`);
  console.log(`Over-quota rejected: ${call2Res.status === 403 ? 'YES' : 'NO'}`);
  console.log(`Slash proof valid: ${valid ? 'YES' : 'NO'}`);
  console.log();
  console.log('In a production flow:');
  console.log('1. The gateway watches for nullifier collisions');
  console.log('2. It runs the slash circuit to extract secret_k');
  console.log('3. It submits the slash proof on-chain');
  console.log('4. The contract slashes the deposit: 50% treasury, 50% reporter');
  console.log(`5. Contract ID: ${process.env.ZK_CONTRACT_ID || 'not configured'}`);
  console.log('\n=== Demo Complete ===');
}

main().catch((err) => {
  console.error('Slash demo failed:', err);
  process.exit(1);
});
