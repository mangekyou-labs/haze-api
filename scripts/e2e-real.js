#!/usr/bin/env node
// E2E test script — demonstrates the full zk-api-credits flow
// Usage: node scripts/e2e-test.js

const crypto = require('crypto');
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');
const { requestDigestToField, skToField } = require('@zk-credits/shared');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'dev-secret';
const CIRCUITS_DIR = path.join(__dirname, '..', 'circuits');

async function main() {
  console.log('=== ZK-API Credits E2E Test ===\n');

  // Step 1: Health check
  console.log('1. Gateway health check...');
  const health = await fetch(`${GATEWAY_URL}/health`);
  const healthData = await health.json();
  console.log(`   Status: ${healthData.status}, Proof: ${healthData.proofVerification}\n`);

  // Step 2: Contract status
  console.log('2. Contract status...');
  try {
    const contractRes = await fetch(`${GATEWAY_URL}/v1/contract-status`);
    const contractData = await contractRes.json();
    console.log(`   Contract: ${contractData.contractId}`);
    console.log(`   Deposits: ${contractData.depositCount}`);
    console.log(`   Root: ${contractData.currentRoot}\n`);
  } catch (e) {
    console.log(`   Contract not available: ${e.message}\n`);
  }

  // Step 3: Generate secret_k + commitment
  console.log('3. Generating secret_k + commitment...');
  const secretK = crypto.randomBytes(32);
  const skField = skToField(secretK);

  const { publicSignals: depositSignals } = await snarkjs.groth16.fullProve(
    {
      secret_k: skField,
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    },
    path.join(CIRCUITS_DIR, 'deposit_membership.wasm'),
    path.join(CIRCUITS_DIR, 'deposit_membership_final.zkey'),
  );
  const commitment = depositSignals[1];
  console.log(`   Commitment: ${commitment}\n`);

  // Step 4: Create API key
  console.log('4. Creating API key...');
  const keyRes = await fetch(`${GATEWAY_URL}/v1/api-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_SECRET}`,
    },
    body: JSON.stringify({ commitment, label: 'e2e-test' }),
  });
  const keyData = await keyRes.json();
  console.log(`   API Key: ${keyData.apiKey?.slice(0, 20)}...`);
  console.log(`   Base URL: ${keyData.baseUrl}\n`);

  // Step 5: Generate RLN proof
  console.log('5. Generating RLN proof...');
  const requestBody = {
    model: 'anthropic/claude-sonnet-4',
    messages: [{ role: 'user', content: 'Say hello in 3 words.' }],
    max_tokens: 50,
  };
  const requestDigest = await requestDigestToField(requestBody);

  const startProve = Date.now();
  const { proof, publicSignals: rlnSignals } = await snarkjs.groth16.fullProve(
    {
      secret_k: skField,
      ticket_index: '0',
      request_digest: requestDigest.field,
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    },
    path.join(CIRCUITS_DIR, 'rln_nullifier.wasm'),
    path.join(CIRCUITS_DIR, 'rln_nullifier_final.zkey'),
  );
  const proveTime = Date.now() - startProve;
  console.log(`   Proof generated in ${proveTime}ms`);
  console.log(`   Root: ${rlnSignals[0]}`);
  console.log(`   Nullifier: ${rlnSignals[1]}\n`);

  // Step 6: Call chat completions with proof
  console.log('6. Calling /v1/chat/completions with ZK proof...');
  const proofHeader = Buffer.from(JSON.stringify({ proof, pubSignals: rlnSignals })).toString('base64');

  const startCall = Date.now();
  const chatRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keyData.apiKey}`,
      'X-ZK-Proof': proofHeader,
    },
    body: JSON.stringify({
      ...requestBody,
    }),
  });
  const callTime = Date.now() - startCall;
  const chatData = await chatRes.json();

  console.log(`   Status: ${chatRes.status}`);
  console.log(`   Latency: ${callTime}ms`);
  if (chatData.choices) {
    console.log(`   Response: ${chatData.choices[0]?.message?.content?.slice(0, 100)}`);
  } else if (chatData.error) {
    console.log(`   Error: ${chatData.error} — ${chatData.message || ''}`);
  }
  console.log();

  // Step 7: Replay the exact tuple (idempotent retry)
  console.log('7. Replaying the exact tuple (should return the stored response)...');
  const replayRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keyData.apiKey}`,
      'X-ZK-Proof': proofHeader,
    },
    body: JSON.stringify({
      ...requestBody,
    }),
  });
  const replayData = await replayRes.json();
  console.log(`   Status: ${replayRes.status} (expected 200)`);
  console.log(`   Error: ${replayData.error}\n`);

  // Step 8: Check status
  console.log('8. Checking user status...');
  const statusRes = await fetch(`${GATEWAY_URL}/v1/status/${commitment}`);
  const statusData = await statusRes.json();
  console.log(`   Calls this epoch: ${statusData.callsThisEpoch}`);
  console.log(`   Remaining: ${statusData.remainingCalls}`);
  console.log(`   Active keys: ${statusData.activeKeys}\n`);

  console.log('=== E2E Test Complete ===');
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
