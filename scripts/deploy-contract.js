#!/usr/bin/env node
/**
 * Deploy ZkCreditsContract with real VK to Stellar testnet.
 * Usage: node scripts/deploy-contract.js
 */
const StellarSdk = require('@stellar/stellar-sdk');
const fs = require('fs');
const path = require('path');

const NETWORK = 'testnet';
const RPC_URL = 'https://soroban-testnet.stellar.org';
const SOURCE_KEY = 'payroll-admin';

async function main() {
  const server = new StellarSdk.rpc.Server(RPC_URL);
  const networkPassphrase = StellarSdk.Networks.TESTNET;

  // Load source keypair
  const sourceKeypair = StellarSdk.Keypair.fromSecret(
    require('child_process').execSync(`stellar keys secret ${SOURCE_KEY}`).toString().trim()
  );
  const sourceAddr = sourceKeypair.publicKey();
  console.log(`Deployer: ${sourceAddr}`);

  // Get USDC contract ID
  const usdcIssuer = require('child_process').execSync('stellar keys address usdc-issuer').toString().trim();
  const usdcContract = require('child_process').execSync(
    `stellar contract id asset --asset "USDC:${usdcIssuer}" --network testnet --rpc-url ${RPC_URL} --network-passphrase "${networkPassphrase}"`
  ).toString().trim();
  console.log(`USDC: ${usdcContract}`);

  // Treasury = deployer (for simplicity)
  const treasuryAddr = sourceAddr;

  // Load RLN VK from soroban hex JSON
  const vkPath = path.join(__dirname, '..', 'circuits', 'verification_key_rln_soroban.json');
  const vkJson = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));
  console.log(`VK loaded: ${vkPath}`);
  console.log(`  IC points: ${vkJson.ic.length}`);

  // Helper: hex string → Buffer
  function hexToBuf(hex) {
    return Buffer.from(hex.replace(/^0x/, ''), 'hex');
  }

  // Build VerificationKey ScVal
  // VerificationKey { alpha: BytesN<96>, beta: BytesN<192>, gamma: BytesN<192>, delta: BytesN<192>, ic: Vec<BytesN<96>> }
  // In Soroban, a struct is represented as a vector of ScVal (positional, not named)
  const vkScVal = StellarSdk.xdr.ScVal.scvVec([
    // alpha
    StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.alpha)),
    // beta
    StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.beta)),
    // gamma
    StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.gamma)),
    // delta
    StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.delta)),
    // ic: Vec<BytesN<96>>
    StellarSdk.xdr.ScVal.scvVec(
      vkJson.ic.map(ic => StellarSdk.xdr.ScVal.scvBytes(hexToBuf(ic)))
    ),
  ]);

  // Build constructor args
  const constructorArgs = [
    StellarSdk.Address.fromString(sourceAddr).toScVal(),     // admin
    StellarSdk.Address.fromString(treasuryAddr).toScVal(),   // treasury
    vkScVal,                                                  // vk
    StellarSdk.Address.fromString(usdcContract).toScVal(),    // usdc_contract
  ];

  // Upload WASM
  const wasmPath = path.join(__dirname, '..', 'zk-credits-contract', 'target', 'wasm32v1-none', 'release', 'zk_credits_contract.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  console.log(`WASM: ${wasmPath} (${wasmBytes.length} bytes)`);

  // Load account
  const account = await server.getAccount(sourceAddr);

  // Step 1: Upload WASM
  console.log('\n1. Uploading WASM...');
  const uploadOp = StellarSdk.Operation.uploadContractWasm({
    wasm: wasmBytes,
  });

  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(uploadOp)
    .setTimeout(180)
    .build();

  tx.sign(sourceKeypair);
  let sendResult = await server.sendTransaction(tx);
  console.log(`   Upload tx: ${sendResult.hash}`);

  // Poll for upload result
  let wasmHash;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await server.getTransaction(sendResult.hash);
    if (status.status === 'SUCCESS') {
      wasmHash = StellarSdk.scValToNative(status.returnValue);
      console.log(`   WASM hash: ${wasmHash}`);
      break;
    }
    if (status.status === 'FAILED') {
      console.error('   Upload failed:', status);
      process.exit(1);
    }
    console.log(`   Polling... (${status.status})`);
  }

  if (!wasmHash) {
    console.error('   Upload timed out');
    process.exit(1);
  }

  // Step 2: Deploy contract with constructor args
  console.log('\n2. Deploying contract with real VK...');
  const account2 = await server.getAccount(sourceAddr);

  // Generate a unique salt (deterministic contract address)
  const salt = StellarSdk.hash(Buffer.from('zk-credits-real-vk-' + Date.now()));

  const deployOp = StellarSdk.Operation.createCustomContract({
    address: StellarSdk.Address.fromString(sourceAddr),
    wasmHash: wasmHash,
    salt: salt,
    constructorArgs: constructorArgs,
  });

  let tx2 = new StellarSdk.TransactionBuilder(account2, {
    fee: '100000000', // higher fee for deploy
    networkPassphrase,
  })
    .addOperation(deployOp)
    .setTimeout(180)
    .build();

  tx2.sign(sourceKeypair);
  let sendResult2 = await server.sendTransaction(tx2);
  console.log(`   Deploy tx: ${sendResult2.hash}`);

  // Poll for deploy result
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await server.getTransaction(sendResult2.hash);
    if (status.status === 'SUCCESS') {
      // Extract contract ID from the return value
      const contractId = StellarSdk.scValToNative(status.returnValue);
      console.log(`   Contract ID: ${contractId}`);
      console.log(`\n   Explorer: https://stellar.expert/explorer/testnet/contract/${contractId}`);
      console.log(`\n=== Deployment Complete ===`);
      console.log(`CONTRACT_ID=${contractId}`);
      break;
    }
    if (status.status === 'FAILED') {
      console.error('   Deploy failed:', status);
      process.exit(1);
    }
    console.log(`   Polling... (${status.status})`);
  }
}

main().catch(err => {
  console.error('Deployment failed:', err.message);
  process.exit(1);
});
