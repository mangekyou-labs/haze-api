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

  // The constructor takes the spend VK for ABI compatibility. Immediately
  // after deployment the admin installs the dedicated slash- and
  // membership-removal VKs. Never reuse a key across statements.
  const circuitsDir = path.join(__dirname, '..', 'circuits');
  const vkPaths = {
    spend: path.join(circuitsDir, 'verification_key_rln_soroban.json'),
    slash: path.join(circuitsDir, 'verification_key_slash_soroban.json'),
    membership: path.join(circuitsDir, 'verification_key_membership_removal_soroban.json'),
  };
  const vks = Object.fromEntries(
    Object.entries(vkPaths).map(([name, vkPath]) => {
      if (!fs.existsSync(vkPath)) {
        throw new Error(`Missing ${name} verification key: ${vkPath}`);
      }
      const vk = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));
      console.log(`${name} VK loaded: ${vkPath} (${vk.ic.length} IC points)`);
      return [name, vk];
    }),
  );

  // Helper: hex string → Buffer
  function hexToBuf(hex) {
    return Buffer.from(hex.replace(/^0x/, ''), 'hex');
  }

  function requireAcceptedSubmission(result, label) {
    console.log(`   ${label} submission: ${result.status}`);
    if (result.status === 'PENDING' || result.status === 'DUPLICATE') {
      return result;
    }
    const detail = result.errorResult && typeof result.errorResult.result === 'function'
      ? `: ${result.errorResult.result().switch().name}`
      : '';
    throw new Error(`${label} submission rejected (${result.status})${detail}`);
  }

  // Build VerificationKey ScVal
  // `#[contracttype]` structs are ABI-encoded as named ScVal maps. The
  // contract spec orders these keys alphabetically: alpha, beta, delta,
  // gamma, ic.
  function vkScVal(vkJson) {
    const entry = (key, val) => new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol(key),
      val,
    });
    return StellarSdk.xdr.ScVal.scvMap([
      entry('alpha', StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.alpha))),
      entry('beta', StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.beta))),
      entry('delta', StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.delta))),
      entry('gamma', StellarSdk.xdr.ScVal.scvBytes(hexToBuf(vkJson.gamma))),
      entry(
        'ic',
        StellarSdk.xdr.ScVal.scvVec(
          vkJson.ic.map(ic => StellarSdk.xdr.ScVal.scvBytes(hexToBuf(ic)))
        ),
      ),
    ]);
  }

  // Build constructor args
  const constructorArgs = [
    StellarSdk.Address.fromString(sourceAddr).toScVal(),     // admin
    StellarSdk.Address.fromString(treasuryAddr).toScVal(),   // treasury
    vkScVal(vks.spend),                                      // constructor spend VK
    StellarSdk.Address.fromString(usdcContract).toScVal(),    // usdc_contract
  ];

  const suppliedWasmHash = process.env.WASM_HASH;
  let wasmHash;
  if (suppliedWasmHash) {
    if (!/^[0-9a-f]{64}$/i.test(suppliedWasmHash)) {
      throw new Error('WASM_HASH must be a 32-byte hexadecimal hash');
    }
    wasmHash = Buffer.from(suppliedWasmHash, 'hex');
    console.log(`\n1. Using pre-uploaded WASM hash: ${suppliedWasmHash}`);
  } else {
    const wasmPath = path.join(__dirname, '..', 'zk-credits-contract', 'target', 'wasm32v1-none', 'release', 'zk_credits_contract.wasm');
    const wasmBytes = fs.readFileSync(wasmPath);
    console.log(`WASM: ${wasmPath} (${wasmBytes.length} bytes)`);
    const account = await server.getAccount(sourceAddr);

    console.log('\n1. Uploading WASM...');
    const uploadOp = StellarSdk.Operation.uploadContractWasm({
      wasm: wasmBytes,
    });
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(uploadOp)
      .setTimeout(180)
      .build();

    const preparedUploadTx = await server.prepareTransaction(tx);
    preparedUploadTx.sign(sourceKeypair);
    const sendResult = requireAcceptedSubmission(
      await server.sendTransaction(preparedUploadTx),
      'WASM upload',
    );
    console.log(`   Upload tx: ${sendResult.hash}`);

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const status = await server.getTransaction(sendResult.hash);
      if (status.status === 'SUCCESS') {
        wasmHash = StellarSdk.scValToNative(status.returnValue);
        console.log(`   WASM hash: ${Buffer.from(wasmHash).toString('hex')}`);
        break;
      }
      if (status.status === 'FAILED') {
        throw new Error(`WASM upload failed: ${JSON.stringify(status)}`);
      }
      console.log(`   Polling... (${status.status})`);
    }
    if (!wasmHash) {
      throw new Error('WASM upload timed out');
    }
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
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(deployOp)
    .setTimeout(180)
    .build();

  const preparedDeployTx = await server.prepareTransaction(tx2);
  preparedDeployTx.sign(sourceKeypair);
  let sendResult2 = requireAcceptedSubmission(
    await server.sendTransaction(preparedDeployTx),
    'Contract deployment',
  );
  console.log(`   Deploy tx: ${sendResult2.hash}`);

  // Poll for deploy result
  let contractDeployed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await server.getTransaction(sendResult2.hash);
    if (status.status === 'SUCCESS') {
      // Extract contract ID from the return value
      const contractId = StellarSdk.scValToNative(status.returnValue);
      console.log(`   Contract ID: ${contractId}`);
      contractDeployed = true;

      // Step 3: bind every statement to its own VK before this contract is
      // configured into the gateway. This is a separate transaction because
      // the preserved constructor ABI has a single VK argument.
      console.log('\n3. Installing dedicated statement verification keys...');
      const keyAccount = await server.getAccount(sourceAddr);
      const keyTx = new StellarSdk.TransactionBuilder(keyAccount, {
        fee: '100000',
        networkPassphrase,
      })
        .addOperation(
          new StellarSdk.Contract(contractId).call(
            'set_statement_verifying_keys',
            vkScVal(vks.spend),
            vkScVal(vks.slash),
            vkScVal(vks.membership),
          ),
        )
        .setTimeout(180)
        .build();
      const preparedKeyTx = await server.prepareTransaction(keyTx);
      preparedKeyTx.sign(sourceKeypair);
      const keyResult = requireAcceptedSubmission(
        await server.sendTransaction(preparedKeyTx),
        'Statement-key installation',
      );
      console.log(`   Statement-key tx: ${keyResult.hash}`);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const keyStatus = await server.getTransaction(keyResult.hash);
        if (keyStatus.status === 'SUCCESS') {
          console.log('   Dedicated verification keys installed.');
          break;
        }
        if (keyStatus.status === 'FAILED') {
          throw new Error(`Statement-key installation failed: ${JSON.stringify(keyStatus)}`);
        }
        if (attempt === 29) {
          throw new Error('Statement-key installation timed out');
        }
      }
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
  if (!contractDeployed) {
    throw new Error('Contract deployment timed out');
  }
}

main().catch(err => {
  console.error('Deployment failed:', err.message);
  process.exit(1);
});
