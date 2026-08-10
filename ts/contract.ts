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

// ─── Withdrawal (M2.5) ────────────────────────────────────────────
// Gateway-mediated: the contract's withdraw() requires
// `deposit.depositor.require_auth()` and the gateway is the depositor for all
// v1 deposits, so the gateway co-signs the inner tx. The user never needs
// XLM — the fee-sponsor relay fee-bumps the returned envelope.

export async function buildWithdrawEnvelope(
  depositorSecretKey: string,
  commitment: string,
  recipient: string,
): Promise<string> {
  const server = getServer();
  const contract = getContract();
  const keypair = Keypair.fromSecret(depositorSecretKey);
  const source = await server.getAccount(keypair.publicKey());

  const commitmentVal = nativeToScVal(BigInt(commitment), { type: 'u256' });
  const recipientVal = new Address(recipient).toScVal();

  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('withdraw', commitmentVal, recipientVal))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  return tx.toEnvelope().toXDR('base64');
}

// Permissionless slash transaction builder. The reporter signs the inner
// transaction locally; the fee-sponsor service adds the fee payer signature
// without changing the slash call or its effects.
export async function buildSlashEnvelope(
  reporterSecretKey: string,
  slashProof: object,
  pubSignals: string[],
  commitment: string,
  submitter: string,
): Promise<string> {
  const server = getServer();
  const contract = getContract();
  const keypair = Keypair.fromSecret(reporterSecretKey);
  const source = await server.getAccount(keypair.publicKey());

  const proofVal = nativeToScVal(slashProof, {});
  const signalsVal = nativeToScVal(pubSignals.map((signal) => BigInt(signal)), {});
  const commitmentVal = nativeToScVal(BigInt(commitment), { type: 'u256' });
  const submitterVal = new Address(submitter).toScVal();

  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('slash', proofVal, signalsVal, commitmentVal, submitterVal))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  return tx.toEnvelope().toXDR('base64');
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

// ─── NullifierSpent event subscription (M2.2) ─────────────────
// The gateway's durable nullifier cache is invalidated by subscribing to
// on-chain NullifierSpent events (published by the contract's spend()).
// This helper fetches the recent events in a start/end ledger range.

export interface NullifierSpentEvent {
  nullifier: string;
  ledger: number;
}

export async function fetchNullifierSpentEvents(
  startLedger: number,
  endLedger: number,
): Promise<NullifierSpentEvent[]> {
  const server = getServer();
  const contractId = CONTRACT_ID;
  if (!contractId) throw new Error('ZK_CONTRACT_ID not set');

  const response = await server.getEvents({
    startLedger,
    endLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [contractId],
        topics: [['NullifierSpent']],
      },
    ],
    limit: 200,
  });

  const out: NullifierSpentEvent[] = [];
  for (const ev of response.events) {
    // Topic = ["NullifierSpent"], value = (nullifier, ledger_sequence).
    // The nullifier is a Bls12381Fr (U256) — normalize to a decimal string.
    const native = scValToNative(ev.value);
    const vals = Array.isArray(native) ? (native as unknown[]) : [native];
    const nullifierValue = vals[0];
    const nullifier =
      typeof nullifierValue === 'bigint'
        ? nullifierValue.toString(10)
        : String(nullifierValue);
    const ledgerValue = typeof vals[1] === 'number' ? vals[1] : ev.ledger;
    out.push({ nullifier, ledger: ledgerValue ?? ev.ledger ?? 0 });
  }
  return out;
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

  // Wait for confirmation (poll getTransaction until it is no longer pending)
  let txResult: Awaited<ReturnType<typeof server.getTransaction>>;
  let retries = 0;
  do {
    if (retries > 20) throw new Error('Transaction confirmation timed out');
    await new Promise((r) => setTimeout(r, 2000));
    txResult = await server.getTransaction(result.hash);
    retries++;
  } while (txResult.status === 'NOT_FOUND');

  if (txResult.status !== 'SUCCESS') {
    throw new Error(`Transaction failed: ${txResult.status}`);
  }

  return result.hash;
}

// ─── Per-call on-chain spend (M2.6 spend worker) ────────────────
// Submits an RLN proof to the contract's spend() as the gateway key. The
// gateway is the depositor for all v1 deposits but spend() requires no auth —
// it verifies the Groth16 proof + root validity on-chain. Idempotent at the
// contract level: replaying a nullifier returns NullifierAlreadySpent.

export async function spend(
  spenderSecretKey: string,
  proof: object,
  pubSignals: string[],
): Promise<string> {
  const server = getServer();
  const contract = getContract();
  const keypair = Keypair.fromSecret(spenderSecretKey);
  const source = await server.getAccount(keypair.publicKey());

  const proofVal = nativeToScVal(proof, {});
  const signalsVal = nativeToScVal(pubSignals.map((s) => BigInt(s)), {});

  const tx = new TransactionBuilder(source, {
    fee: '300000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('spend', proofVal, signalsVal))
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const result = await server.sendTransaction(prepared);
  if (result.status === 'ERROR') {
    throw new Error(`Transaction error: ${JSON.stringify(result.errorResult)}`);
  }

  let txResult: Awaited<ReturnType<typeof server.getTransaction>>;
  let retries = 0;
  do {
    if (retries > 20) throw new Error('Transaction confirmation timed out');
    await new Promise((r) => setTimeout(r, 2000));
    txResult = await server.getTransaction(result.hash);
    retries++;
  } while (txResult.status === 'NOT_FOUND');

  if (txResult.status !== 'SUCCESS') {
    throw new Error(`Transaction failed: ${txResult.status}`);
  }

  return result.hash;
}
