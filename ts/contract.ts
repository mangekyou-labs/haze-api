// Soroban contract client — reads/writes to ZkCreditsContract on Stellar testnet

import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const CONTRACT_ID = process.env.ZK_CONTRACT_ID || '';

function getServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL, { allowHttp: true });
}

function getContract(): Contract {
  if (!CONTRACT_ID) throw new Error('ZK_CONTRACT_ID not set');
  return new Contract(CONTRACT_ID);
}

// ─── Read functions (simulate, no signing needed) ──────────────

export async function getDepositCount(): Promise<number> {
  const server = getServer();
  const contract = getContract();
  const source = await server.getAccount(process.env.GATEWAY_ADDRESS || '');
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_deposit_count'))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation error: ${sim.error}`);
  }
  const result = scValToNative(sim.result!.retval);
  return Number(result);
}

export async function getCurrentRoot(): Promise<string> {
  const server = getServer();
  const contract = getContract();
  const source = await server.getAccount(process.env.GATEWAY_ADDRESS || '');
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_current_root'))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation error: ${sim.error}`);
  }
  const result = scValToNative(sim.result!.retval);
  return String(result);
}

export async function getDeposit(
  commitment: string,
): Promise<{ amount: string; depositor: string; slashed: boolean; withdrawn: boolean } | null> {
  const server = getServer();
  const contract = getContract();
  const source = await server.getAccount(process.env.GATEWAY_ADDRESS || '');

  const commitmentVal = nativeToScVal(BigInt(commitment), { type: 'u256' });

  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_deposit', commitmentVal))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    if (sim.error.includes('Contract not found') || sim.error.includes('not found')) return null;
    throw new Error(`Simulation error: ${sim.error}`);
  }

  const result = scValToNative(sim.result!.retval);
  if (!result) return null;
  return result as { amount: string; depositor: string; slashed: boolean; withdrawn: boolean };
}

export async function isNullifierSpent(nullifier: string): Promise<boolean> {
  const server = getServer();
  const contract = getContract();
  const source = await server.getAccount(process.env.GATEWAY_ADDRESS || '');

  const nullifierVal = nativeToScVal(BigInt(nullifier), { type: 'u256' });

  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('is_nullifier_spent', nullifierVal))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation error: ${sim.error}`);
  }
  return scValToNative(sim.result!.retval) as boolean;
}

// ─── Write functions (sign + submit) ───────────────────────────

export async function deposit(
  depositorSecretKey: string,
  commitment: string,
  newRoot: string,
  amount: string,
): Promise<string> {
  const server = getServer();
  const contract = getContract();
  const keypair = Keypair.fromSecret(depositorSecretKey);
  const source = await server.getAccount(keypair.publicKey());

  const commitmentVal = nativeToScVal(BigInt(commitment), { type: 'u256' });
  const newRootVal = nativeToScVal(BigInt(newRoot), { type: 'u256' });
  const amountVal = nativeToScVal(BigInt(amount), { type: 'i128' });

  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'deposit',
        new Address(keypair.publicKey()).toScVal(),
        commitmentVal,
        newRootVal,
        amountVal,
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const result = await server.sendTransaction(prepared);
  if (result.status === 'ERROR') {
    throw new Error(`Transaction error: ${JSON.stringify(result.errorResult)}`);
  }

  // Wait for confirmation
  let txResult = result;
  let retries = 0;
  while (txResult.status === 'PENDING' || txResult.status === 'NOT_FOUND') {
    if (retries > 20) throw new Error('Transaction confirmation timed out');
    await new Promise((r) => setTimeout(r, 2000));
    txResult = await server.getTransaction(result.hash);
    retries++;
  }

  if (txResult.status !== 'SUCCESS') {
    throw new Error(`Transaction failed: ${txResult.status}`);
  }

  return result.hash;
}
