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
const BLS12_381_BASE_FIELD_ORDER = BigInt(
  '0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab',
);

type SnarkScalar = string | number | bigint;

function fixedFieldBytes(value: unknown, label: string): Buffer {
  let scalar: bigint;
  try {
    scalar = BigInt(value as SnarkScalar);
  } catch {
    throw new Error(`${label} is not an integer`);
  }

  if (scalar < 0n || scalar >= BLS12_381_BASE_FIELD_ORDER) {
    throw new Error(`${label} is outside the BLS12-381 base field`);
  }

  const hex = scalar.toString(16).padStart(96, '0');
  return Buffer.from(hex, 'hex');
}

function pointCoordinates(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function g1PointToBytes(value: unknown, label: string): Buffer {
  const point = pointCoordinates(value, label);
  if (point.length < 3) throw new Error(`${label} must contain x, y, z`);
  if (BigInt(point[2] as SnarkScalar) !== 1n) {
    throw new Error(`${label} z must be 1`);
  }

  return Buffer.concat([
    fixedFieldBytes(point[0], `${label}.x`),
    fixedFieldBytes(point[1], `${label}.y`),
  ]);
}

function g2PointToBytes(value: unknown, label: string): Buffer {
  const point = pointCoordinates(value, label);
  if (point.length < 3) throw new Error(`${label} must contain x, y, z`);
  const z = pointCoordinates(point[2], `${label}.z`);
  if (z.length < 2 || BigInt(z[0] as SnarkScalar) !== 1n || BigInt(z[1] as SnarkScalar) !== 0n) {
    throw new Error(`${label} z must be [1, 0]`);
  }

  const x = pointCoordinates(point[0], `${label}.x`);
  const y = pointCoordinates(point[1], `${label}.y`);
  if (x.length < 2 || y.length < 2) throw new Error(`${label} coordinates must be pairs`);

  // Soroban's Bls12381G2Affine byte layout is imaginary then real for each
  // Fp2 coordinate. snarkjs exposes the same coordinates as [real, imaginary].
  return Buffer.concat([
    fixedFieldBytes(x[1], `${label}.x.im`),
    fixedFieldBytes(x[0], `${label}.x.re`),
    fixedFieldBytes(y[1], `${label}.y.im`),
    fixedFieldBytes(y[0], `${label}.y.re`),
  ]);
}

/**
 * Convert a snarkjs BLS12-381 Groth16 proof to Soroban's named
 * Groth16Proof struct: { a: BytesN<96>, b: BytesN<192>, c: BytesN<96> }.
 *
 * nativeToScVal(proof) produces a map with the snarkjs field names (pi_a,
 * pi_b, pi_c) and nested arrays, while the Soroban struct requires the
 * contract field names and fixed-width point byte values.
 */
export function groth16ProofToScVal(proof: object): xdr.ScVal {
  const candidate = proof as { pi_a?: unknown; pi_b?: unknown; pi_c?: unknown };
  if (candidate.pi_a === undefined || candidate.pi_b === undefined || candidate.pi_c === undefined) {
    throw new Error('Groth16 proof must contain pi_a, pi_b, and pi_c');
  }

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('a'),
      val: xdr.ScVal.scvBytes(g1PointToBytes(candidate.pi_a, 'G1 proof point')),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('b'),
      val: xdr.ScVal.scvBytes(g2PointToBytes(candidate.pi_b, 'G2 proof point')),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('c'),
      val: xdr.ScVal.scvBytes(g1PointToBytes(candidate.pi_c, 'G1 proof point')),
    }),
  ]);
}

/**
 * Encode RLN public signals as Vec<u256>. Soroban's Bls12381Fr maps to the
 * 256-bit unsigned ScVal type; the SDK otherwise defaults BigInt values to
 * u64 when no explicit type is supplied.
 */
export function groth16PublicSignalsToScVal(pubSignals: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(
    pubSignals.map((signal) => nativeToScVal(BigInt(signal), { type: 'u256' })),
  );
}

function getServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL, { allowHttp: true });
}

function getContract(): Contract {
  if (!CONTRACT_ID) throw new Error('ZK_CONTRACT_ID not set');
  return new Contract(CONTRACT_ID);
}

/**
 * Soroban contract invocations need simulation-derived resources and auth
 * entries before the inner source signs. Fee-bumped slash/withdraw envelopes
 * are submitted by another account, but their inner transaction still must be
 * fully prepared and signed by its required source.
 */
export async function prepareAndSignEnvelope(
  server: Pick<SorobanRpc.Server, 'prepareTransaction'>,
  transaction: Parameters<SorobanRpc.Server['prepareTransaction']>[0],
  keypair: Keypair,
): Promise<string> {
  const prepared = await server.prepareTransaction(transaction);
  prepared.sign(keypair);
  return prepared.toEnvelope().toXDR('base64');
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
// Gateway-mediated: the contract's withdraw() requires both the gateway's
// depositor auth and a browser-generated membership-removal proof. The user
// never needs XLM — the fee-sponsor relay fee-bumps the returned envelope.

export async function buildWithdrawEnvelope(
  depositorSecretKey: string,
  withdrawalProof: object,
  pubSignals: string[],
  commitment: string,
  recipient: string,
): Promise<string> {
  const server = getServer();
  const contract = getContract();
  const keypair = Keypair.fromSecret(depositorSecretKey);
  const source = await server.getAccount(keypair.publicKey());

  const proofVal = groth16ProofToScVal(withdrawalProof);
  const signalsVal = groth16PublicSignalsToScVal(pubSignals);
  const commitmentVal = nativeToScVal(BigInt(commitment), { type: 'u256' });
  const recipientVal = new Address(recipient).toScVal();

  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('withdraw', proofVal, signalsVal, commitmentVal, recipientVal))
    .setTimeout(30)
    .build();

  return prepareAndSignEnvelope(server, tx, keypair);
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

  const proofVal = groth16ProofToScVal(slashProof);
  const signalsVal = groth16PublicSignalsToScVal(pubSignals);
  const commitmentVal = nativeToScVal(BigInt(commitment), { type: 'u256' });
  const submitterVal = new Address(submitter).toScVal();

  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('slash', proofVal, signalsVal, commitmentVal, submitterVal))
    .setTimeout(30)
    .build();

  return prepareAndSignEnvelope(server, tx, keypair);
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

export function nullifierSpentEventFilter(contractId: string) {
  return {
    type: 'contract' as const,
    contractIds: [contractId],
    topics: [[xdr.ScVal.scvSymbol('NullifierSpent').toXDR('base64')]],
  };
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
    filters: [nullifierSpentEventFilter(contractId)],
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

  const proofVal = groth16ProofToScVal(proof);
  const signalsVal = groth16PublicSignalsToScVal(pubSignals);

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
