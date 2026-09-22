/**
 * Base Sepolia deployment safety and reconciliation.
 *
 * The launcher never signs or broadcasts a transaction. It records the exact
 * CREATE sequence a Foundry script is expected to produce, asks the operator
 * to run the keystore-backed command, and then reconciles Foundry's artifact
 * and the chain before it writes deployment outputs.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getContractAddress, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { poseidonHash } from '@zk-credits/shared';
import type { StepDetail } from './state.js';

/** The pilot is Base Sepolia only. */
export const PILOT_CHAIN_ID = 84532;

/** Circle's native USDC deployment on Base Sepolia. */
export const BASE_SEPOLIA_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

/** The approval bound the pilot commits to: at most 80 test USDC. */
export const MAX_PILOT_APPROVAL_USDC = 80n;

/** One funded bundle is the smallest useful first smoke test. */
export const INITIAL_PILOT_APPROVAL_USDC = 20n;

/** The number of confirmations the launch records for downstream consumers. */
export const BASE_CONFIRMATIONS = 3;

/** Poseidon libraries the bond needs, deployed before it. */
export const POSEIDON_LIBRARIES = ['PoseidonT2', 'PoseidonT3', 'PoseidonT4'] as const;

export const CONTRACT_DEPLOY_ORDER = [...POSEIDON_LIBRARIES, 'PrivateCreditBond'] as const;
export type ContractName = (typeof CONTRACT_DEPLOY_ORDER)[number];

/** The reviewed B11 adapter and the generated verifier it must wrap. */
export const EXISTING_B11_CONTRACTS = {
  verifier: '0xC66CC4866f945Ce39c207729CF136fd03d58207E',
  adapter: '0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD',
} as const;

export interface BroadcastIntent {
  contract: ContractName;
  chainId: number;
  /** Deployer address, read from the protected keystore account. */
  signer: string;
  /** The nonce the broadcast will consume. */
  nonce: number;
  /** The address that nonce implies, recorded before the send. */
  predictedAddress: string;
  /** Filled in once Foundry accepts the transaction. */
  transactionHash: string | null;
}

/** The CREATE address a signer/nonce pair implies. */
export function predictDeploymentAddress(signer: string, nonce: number): string {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(signer)) throw new Error('cannot predict a deployment from an invalid signer address');
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('cannot predict a deployment from an invalid nonce');
  return getContractAddress({ from: signer as `0x${string}`, nonce: BigInt(nonce) });
}

export function broadcastIntent(contract: ContractName, signer: string, nonce: number, hash: string | null = null): BroadcastIntent {
  return {
    contract,
    chainId: PILOT_CHAIN_ID,
    signer,
    nonce,
    predictedAddress: predictDeploymentAddress(signer, nonce),
    transactionHash: hash,
  };
}

/** Derives a public sponsor address without ever passing the private key as an address argument. */
export function deriveAddressFromPrivateKey(privateKey: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) throw new Error('the sponsor key must be a 32-byte hex private key');
  return privateKeyToAccount(privateKey as `0x${string}`).address;
}

export interface ChainReceipt {
  status: 'success' | 'reverted';
  contractAddress: string | null;
  blockNumber: bigint;
  transactionHash?: string;
  from?: string;
  nonce?: number;
}

export interface ChainTransaction {
  from: string;
  nonce: number;
  to: string | null;
}

/** The minimal chain surface used by preflight and reconciliation. */
export interface ChainReader {
  receipt(transactionHash: string): Promise<ChainReceipt | undefined>;
  code(address: string): Promise<string>;
  chainId?(): Promise<number>;
  balance?(address: string): Promise<bigint>;
  nonce?(address: string, tag?: 'latest' | 'pending'): Promise<number>;
  blockNumber?(): Promise<bigint>;
  call?(address: string, data: string): Promise<string>;
  transaction?(transactionHash: string): Promise<ChainTransaction | undefined>;
}

function parseRpcQuantity(value: unknown, label: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/u.test(value)) throw new Error(`${label} was not a readable quantity`);
  return BigInt(value);
}

function parseRpcNumber(value: unknown, label: string): number {
  const quantity = parseRpcQuantity(value, label);
  if (quantity > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is larger than JavaScript can safely represent`);
  return Number(quantity);
}

/** A JSON-RPC reader over the dedicated Base Sepolia endpoint. */
export function rpcChainReader(options: { rpcUrl: string; fetch?: typeof fetch }): ChainReader {
  const send = options.fetch ?? fetch;
  const callRpc = async (method: string, params: unknown[]): Promise<unknown> => {
    const response = await send(options.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`${method} answered ${response.status}`);
    const body = await response.json() as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`${method} failed: ${body.error.message ?? 'unknown'}`);
    return body.result;
  };

  return {
    async chainId(): Promise<number> {
      return parseRpcNumber(await callRpc('eth_chainId', []), 'chain id');
    },
    async balance(address: string): Promise<bigint> {
      return parseRpcQuantity(await callRpc('eth_getBalance', [address, 'latest']), 'balance');
    },
    async nonce(address: string, tag: 'latest' | 'pending' = 'pending'): Promise<number> {
      return parseRpcNumber(await callRpc('eth_getTransactionCount', [address, tag]), `${tag} nonce`);
    },
    async blockNumber(): Promise<bigint> {
      return parseRpcQuantity(await callRpc('eth_blockNumber', []), 'block number');
    },
    async call(address: string, data: string): Promise<string> {
      const result = await callRpc('eth_call', [{ to: address, data }, 'latest']);
      if (typeof result !== 'string') throw new Error('eth_call returned a non-hex result');
      return result;
    },
    async receipt(transactionHash: string): Promise<ChainReceipt | undefined> {
      const result = await callRpc('eth_getTransactionReceipt', [transactionHash]) as
        | { status?: string; contractAddress?: string | null; blockNumber?: string; transactionHash?: string; from?: string }
        | null;
      if (!result) return undefined;
      const transaction = await callRpc('eth_getTransactionByHash', [transactionHash]) as
        | { from?: string; nonce?: string; to?: string | null }
        | null;
      return {
        status: result.status === '0x1' ? 'success' : 'reverted',
        contractAddress: result.contractAddress ?? null,
        blockNumber: parseRpcQuantity(result.blockNumber ?? '0x0', 'receipt block number'),
        transactionHash: result.transactionHash ?? transactionHash,
        ...(result.from || transaction?.from ? { from: result.from ?? transaction?.from } : {}),
        ...(transaction?.nonce !== undefined ? { nonce: parseRpcNumber(transaction.nonce, 'transaction nonce') } : {}),
      };
    },
    async transaction(transactionHash: string): Promise<ChainTransaction | undefined> {
      const result = await callRpc('eth_getTransactionByHash', [transactionHash]) as
        | { from?: string; nonce?: string; to?: string | null }
        | null;
      if (!result) return undefined;
      if (!result.from || result.nonce === undefined) throw new Error('transaction is missing its signer or nonce');
      return { from: result.from, nonce: parseRpcNumber(result.nonce, 'transaction nonce'), to: result.to ?? null };
    },
    async code(address: string): Promise<string> {
      const result = await callRpc('eth_getCode', [address, 'latest']);
      return typeof result === 'string' ? result : '0x';
    },
  };
}

export type BroadcastReconciliation =
  | { kind: 'confirmed'; address: string; blockNumber: bigint; transactionHash: string | null }
  | { kind: 'absent'; reason: string }
  | { kind: 'unknown'; reason: string }
  | { kind: 'mismatch'; reason: string };

function isDeployed(code: string): boolean {
  return typeof code === 'string' && /^0x[0-9a-fA-F]+$/u.test(code) && code.length > 2;
}

/** The chains the pilot may ever deploy to. Anything else is refused. */
export function assertChainId(observed: number, expected: number = PILOT_CHAIN_ID): void {
  if (observed !== expected) throw new Error(`the RPC reports chain ${observed}; the pilot is chain ${expected} only`);
}

/** Reconciles one intent. RPC failures and ambiguous outcomes never become "absent". */
export async function reconcileBroadcast(intent: BroadcastIntent, chain: ChainReader): Promise<BroadcastReconciliation> {
  let deployed: boolean;
  try {
    deployed = isDeployed(await chain.code(intent.predictedAddress));
  } catch (error) {
    return { kind: 'unknown', reason: `${intent.contract} bytecode could not be read: ${error instanceof Error ? error.message : 'unknown RPC error'}` };
  }

  if (intent.transactionHash) {
    let receipt: ChainReceipt | undefined;
    try {
      receipt = await chain.receipt(intent.transactionHash);
    } catch (error) {
      return { kind: 'unknown', reason: `${intent.contract} receipt could not be read: ${error instanceof Error ? error.message : 'unknown RPC error'}` };
    }
    if (!receipt) return { kind: 'unknown', reason: `${intent.contract} transaction ${intent.transactionHash} has no readable receipt` };
    if (receipt.status === 'reverted') return { kind: 'unknown', reason: `${intent.contract} broadcast ${intent.transactionHash} reverted; investigate before retrying` };
    if (!receipt.contractAddress) return { kind: 'unknown', reason: `${intent.contract} receipt succeeded without a contract address; investigate before retrying` };
    const address = receipt.contractAddress;
    if (address.toLowerCase() !== intent.predictedAddress.toLowerCase()) return { kind: 'unknown', reason: `${intent.contract} deployed ${address} but ${intent.predictedAddress} was predicted from nonce ${intent.nonce}` };
    if (!deployed) return { kind: 'unknown', reason: `${intent.contract} receipt succeeded but ${address} has no bytecode` };
    if (receipt.from && receipt.from.toLowerCase() !== intent.signer.toLowerCase()) return { kind: 'unknown', reason: `${intent.contract} receipt signer ${receipt.from} differs from intended signer ${intent.signer}` };
    if (receipt.nonce !== undefined && receipt.nonce !== intent.nonce) return { kind: 'unknown', reason: `${intent.contract} receipt nonce ${receipt.nonce} differs from intended nonce ${intent.nonce}` };
    return { kind: 'confirmed', address, blockNumber: receipt.blockNumber, transactionHash: intent.transactionHash };
  }

  if (deployed) return { kind: 'unknown', reason: `${intent.contract} has bytecode at ${intent.predictedAddress} but no transaction hash or receipt to prove the intended nonce` };
  return { kind: 'absent', reason: `${intent.contract} has no bytecode at ${intent.predictedAddress}` };
}

export interface FoundryDeploymentRecord {
  contract: string;
  /** Foundry's transaction kind; deployment records must be CREATEs. */
  type: string | null;
  /** A CREATE transaction has no recipient. */
  to: string | null;
  transactionHash: string | null;
  contractAddress: string | null;
  signer: string | null;
  nonce: number | null;
  chainId: number | null;
  status: 'success' | 'reverted' | 'unknown';
  blockNumber: bigint | null;
}

export interface FoundryRunArtifact {
  transactions: FoundryDeploymentRecord[];
  /** Foundry records the chain at the artifact root on current versions. */
  chainId?: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableQuantity(value: unknown, label: string): bigint | null {
  if (value === undefined || value === null || value === '') return null;
  return parseRpcQuantity(value, label);
}

function findReceipt(raw: Record<string, unknown>, receipts: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const nested = asRecord(raw.receipt);
  if (Object.keys(nested).length > 0) return nested;
  const transaction = Object.keys(asRecord(raw.tx)).length > 0 ? asRecord(raw.tx) : asRecord(raw.transaction);
  const declaredAddress = nullableString(raw.contractAddress) ?? nullableString(transaction.contractAddress);
  if (declaredAddress) {
    const addressMatches = Object.values(receipts).filter((receipt) =>
      nullableString(receipt.contractAddress)?.toLowerCase() === declaredAddress.toLowerCase(),
    );
    if (addressMatches.length === 1) return addressMatches[0]!;
  }
  const hash = nullableString(raw.hash) ?? nullableString(raw.transactionHash);
  return hash ? receipts[hash.toLowerCase()] ?? {} : {};
}

/** Parses Foundry's run-latest.json without accepting a partial or invented shape. */
export function parseFoundryRunLatest(input: string | unknown): FoundryRunArtifact {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      throw new Error('Foundry run-latest.json is not valid JSON');
    }
  }
  const root = asRecord(parsed);
  if (!Array.isArray(root.transactions)) throw new Error('Foundry run-latest.json has no transactions array');

  const receiptIndex: Record<string, Record<string, unknown>> = {};
  if (Array.isArray(root.receipts)) {
    for (const value of root.receipts) {
      const receipt = asRecord(value);
      const hash = nullableString(receipt.transactionHash) ?? nullableString(receipt.hash);
      if (hash) receiptIndex[hash.toLowerCase()] = receipt;
    }
  }

  const transactions = root.transactions.map((value, index): FoundryDeploymentRecord => {
    const raw = asRecord(value);
    // Foundry currently calls this object `tx`; older artifacts used
    // `transaction`, so accept both while keeping the reconciliation strict.
    const transaction = Object.keys(asRecord(raw.tx)).length > 0 ? asRecord(raw.tx) : asRecord(raw.transaction);
    const receipt = findReceipt(raw, receiptIndex);
    const contract = nullableString(raw.contractName) ?? nullableString(raw.contract) ?? nullableString(transaction.contractName) ?? '';
    // Foundry has used both `type` and `transactionType` for the logical
    // operation kind across artifact versions. The nested tx's `type` is the
    // EIP-2718 envelope (for example `0x02`), so it is deliberately not used
    // as the CREATE/CALL discriminator unless no logical field is present.
    const type = nullableString(raw.transactionType)
      ?? nullableString(transaction.transactionType)
      ?? nullableString(raw.type)
      ?? nullableString(transaction.type);
    const to = nullableString(raw.to) ?? nullableString(transaction.to) ?? nullableString(receipt.to);
    const transactionHash = nullableString(raw.hash)
      ?? nullableString(raw.transactionHash)
      ?? nullableString(transaction.hash)
      ?? nullableString(receipt.transactionHash);
    // Some Foundry versions shift the transaction hash fields while keeping
    // the CREATE addresses aligned with nonce order. The receipt table is the
    // authoritative hash/address pairing, selected by the declared address.
    const contractAddress = nullableString(receipt.contractAddress)
      ?? nullableString(raw.contractAddress)
      ?? nullableString(transaction.contractAddress);
    const receiptTransactionHash = nullableString(receipt.transactionHash);
    const signer = nullableString(raw.from) ?? nullableString(transaction.from) ?? nullableString(receipt.from);
    const rawNonce = raw.nonce ?? transaction.nonce ?? receipt.nonce;
    const nonce = rawNonce === undefined || rawNonce === null ? null : parseRpcNumber(rawNonce, `transaction ${index} nonce`);
    const rawChainId = raw.chainId ?? transaction.chainId;
    const chainId = rawChainId === undefined || rawChainId === null ? null : parseRpcNumber(rawChainId, `transaction ${index} chain id`);
    const statusValue = receipt.status ?? raw.status;
    const status = statusValue === '0x1' || statusValue === 1 || statusValue === 'success'
      ? 'success'
      : statusValue === '0x0' || statusValue === 0 || statusValue === 'reverted'
        ? 'reverted'
        : 'unknown';
    const blockNumber = nullableQuantity(receipt.blockNumber ?? raw.blockNumber, `transaction ${index} block number`);
    return {
      contract,
      type,
      to,
      transactionHash: receiptTransactionHash ?? transactionHash,
      contractAddress,
      signer,
      nonce,
      chainId,
      status,
      blockNumber,
    };
  });

  if (transactions.length === 0) throw new Error('Foundry run-latest.json contains no transactions');
  const rawChainId = root.chainId ?? root.chain;
  const chainId = rawChainId === undefined || rawChainId === null
    ? undefined
    : parseRpcNumber(rawChainId, 'artifact chain id');
  return { transactions, ...(chainId === undefined ? {} : { chainId }) };
}

export interface DeploymentReconciliation {
  kind: 'confirmed' | 'unknown';
  deployments?: Array<{ contract: ContractName; address: string; blockNumber: bigint; transactionHash: string }>;
  bondDeploymentBlock?: bigint;
  reason?: string;
}

function unknownDeployment(reason: string): DeploymentReconciliation {
  return { kind: 'unknown', reason };
}

/** Reconciles the complete four-transaction Foundry artifact. */
export async function reconcileDeploymentArtifact(
  intents: readonly BroadcastIntent[],
  artifact: FoundryRunArtifact,
  chain: ChainReader,
): Promise<DeploymentReconciliation> {
  if (intents.length !== CONTRACT_DEPLOY_ORDER.length) return unknownDeployment('four deployment intents are required');
  if (artifact.transactions.length !== CONTRACT_DEPLOY_ORDER.length) return unknownDeployment(`Foundry artifact has ${artifact.transactions.length} transactions; expected ${CONTRACT_DEPLOY_ORDER.length}`);

  if (chain.chainId) {
    try {
      const observedChain = await chain.chainId();
      if (observedChain !== intents[0]!.chainId) return unknownDeployment(`chain ${observedChain} differs from the deployment intent chain ${intents[0]!.chainId}`);
    } catch (error) {
      return unknownDeployment(`chain id could not be reconciled: ${error instanceof Error ? error.message : 'unknown RPC error'}`);
    }
  }

  const deployments: Array<{ contract: ContractName; address: string; blockNumber: bigint; transactionHash: string }> = [];
  for (const [index, intent] of intents.entries()) {
    const entry = artifact.transactions[index]!;
    const expected = CONTRACT_DEPLOY_ORDER[index]!;
    const unnamedPoseidon = entry.contract === '' && expected !== 'PrivateCreditBond';
    if ((!unnamedPoseidon && entry.contract !== expected) || intent.contract !== expected) {
      return unknownDeployment(`Foundry artifact order is ${entry.contract || 'unknown'} at position ${index}; expected ${expected}`);
    }
    if (artifact.chainId !== undefined && artifact.chainId !== null && artifact.chainId !== intent.chainId) {
      return unknownDeployment(`Foundry artifact chain ${artifact.chainId} differs from the deployment intent chain ${intent.chainId}`);
    }
    if (entry.chainId !== null && entry.chainId !== intent.chainId) return unknownDeployment(`${expected} artifact chain ${entry.chainId} differs from the deployment intent chain ${intent.chainId}`);
    if (entry.type !== 'CREATE') return unknownDeployment(`${expected} artifact transaction type is ${entry.type ?? 'unknown'}; expected CREATE`);
    if (entry.to !== null) return unknownDeployment(`${expected} artifact transaction targets ${entry.to}; expected a contract creation`);
    if (entry.signer === null || entry.signer.toLowerCase() !== intent.signer.toLowerCase()) return unknownDeployment(`${expected} artifact signer does not match the intended signer`);
    if (entry.nonce === null || entry.nonce !== intent.nonce) return unknownDeployment(`${expected} artifact nonce ${entry.nonce ?? 'unknown'} does not match intended nonce ${intent.nonce}`);
    if (entry.contractAddress === null || entry.contractAddress.toLowerCase() !== intent.predictedAddress.toLowerCase()) return unknownDeployment(`${expected} artifact address does not match the predicted address`);
    if (entry.transactionHash === null) return unknownDeployment(`${expected} artifact has no transaction hash`);
    if (entry.status !== 'success') return unknownDeployment(`${expected} receipt is ${entry.status}; do not retry blindly`);
    if (entry.blockNumber === null) return unknownDeployment(`${expected} artifact receipt has no block number`);

    let receipt: ChainReceipt | undefined;
    let code: string;
    try {
      [receipt, code] = await Promise.all([chain.receipt(entry.transactionHash), chain.code(intent.predictedAddress)]);
    } catch (error) {
      return unknownDeployment(`${expected} chain reconciliation failed: ${error instanceof Error ? error.message : 'unknown RPC error'}`);
    }
    if (!receipt) return unknownDeployment(`${expected} transaction receipt is unreadable`);
    if (receipt.status !== 'success') return unknownDeployment(`${expected} chain receipt reverted`);
    if (receipt.transactionHash && receipt.transactionHash.toLowerCase() !== entry.transactionHash.toLowerCase()) return unknownDeployment(`${expected} receipt hash differs from the artifact transaction hash`);
    if (!receipt.contractAddress) return unknownDeployment(`${expected} receipt has no contract address`);
    if (receipt.contractAddress.toLowerCase() !== intent.predictedAddress.toLowerCase()) return unknownDeployment(`${expected} receipt address differs from the predicted address`);
    if (receipt.blockNumber !== entry.blockNumber) return unknownDeployment(`${expected} receipt block ${receipt.blockNumber} differs from the artifact block ${entry.blockNumber}`);
    if (!isDeployed(code)) return unknownDeployment(`${expected} has no deployed bytecode at ${intent.predictedAddress}`);
    if (receipt.from && receipt.from.toLowerCase() !== intent.signer.toLowerCase()) return unknownDeployment(`${expected} receipt signer differs from the intended signer`);
    if (receipt.nonce !== undefined && receipt.nonce !== intent.nonce) return unknownDeployment(`${expected} receipt nonce differs from the intended nonce`);
    if (chain.transaction) {
      let transaction: ChainTransaction | undefined;
      try {
        transaction = await chain.transaction(entry.transactionHash);
      } catch (error) {
        return unknownDeployment(`${expected} transaction metadata is unreadable: ${error instanceof Error ? error.message : 'unknown RPC error'}`);
      }
      if (!transaction) return unknownDeployment(`${expected} transaction metadata is missing`);
      if (transaction.from.toLowerCase() !== intent.signer.toLowerCase() || transaction.nonce !== intent.nonce || transaction.to !== null) return unknownDeployment(`${expected} transaction metadata does not match a CREATE signer, nonce, and recipient intent`);
    }
    deployments.push({ contract: expected, address: intent.predictedAddress, blockNumber: receipt.blockNumber, transactionHash: entry.transactionHash });
  }

  return { kind: 'confirmed', deployments, bondDeploymentBlock: deployments.at(-1)!.blockNumber };
}

/** Scalar-only state detail: sufficient to reconstruct every intent. */
export function deploymentIntentDetail(intents: readonly BroadcastIntent[], artifactPath: string): StepDetail {
  const first = intents[0];
  const last = intents.at(-1);
  if (!first || !last) throw new Error('cannot persist an empty deployment intent');
  const detail: StepDetail = {
    signer: first.signer,
    startingNonce: first.nonce,
    contractNonce: last.nonce,
    predictedAddress: last.predictedAddress,
    artifactPath,
  };
  for (const intent of intents) {
    const key = intent.contract.replace(/([a-z])([A-Z])/gu, '$1_$2').toLowerCase();
    detail[`${key}Nonce`] = intent.nonce;
    detail[`${key}PredictedAddress`] = intent.predictedAddress;
  }
  return detail;
}

export function intentsFromDetail(detail: StepDetail): BroadcastIntent[] {
  const signer = typeof detail.signer === 'string' ? detail.signer : '';
  const rawStartingNonce = detail.startingNonce;
  const startingNonce = typeof rawStartingNonce === 'number' ? rawStartingNonce : Number(rawStartingNonce);
  if (!/^0x[0-9a-fA-F]{40}$/u.test(signer) || !Number.isSafeInteger(startingNonce)) throw new Error('deployment intent state is missing its signer or starting nonce');
  const intents = CONTRACT_DEPLOY_ORDER.map((contract) => {
    const key = contract.replace(/([a-z])([A-Z])/gu, '$1_$2').toLowerCase();
    const rawNonce = detail[`${key}Nonce`];
    const address = detail[`${key}PredictedAddress`];
    const nonce = typeof rawNonce === 'number' ? rawNonce : Number(rawNonce);
    if (!Number.isSafeInteger(nonce) || typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/u.test(address)) throw new Error(`deployment intent state is missing ${contract}`);
    const intent = broadcastIntent(contract, signer, nonce);
    if (intent.predictedAddress.toLowerCase() !== address.toLowerCase()) throw new Error(`${contract} persisted prediction does not match signer and nonce`);
    return intent;
  });
  const last = intents.at(-1)!;
  const rawContractNonce = detail.contractNonce;
  const contractNonce = typeof rawContractNonce === 'number' ? rawContractNonce : Number(rawContractNonce);
  if (!Number.isSafeInteger(contractNonce) || contractNonce !== last.nonce) throw new Error('deployment intent state is missing a consistent contract nonce');
  if (typeof detail.predictedAddress !== 'string' || detail.predictedAddress.toLowerCase() !== last.predictedAddress.toLowerCase()) {
    throw new Error('deployment intent state is missing a consistent predicted address');
  }
  return intents;
}

export interface BondImmutables {
  usdc: string;
  sponsor: string;
  refundVault: string;
  treasury: string;
  poseidonT2: string;
  poseidonT3: string;
  poseidonT4: string;
  spendVerifier: string;
  deploymentDomain: string;
}

export function assertImmutables(observed: BondImmutables, expected: BondImmutables): void {
  const mismatches = (Object.keys(expected) as (keyof BondImmutables)[])
    .filter((key) => String(observed[key]).toLowerCase() !== String(expected[key]).toLowerCase())
    .map((key) => `${key} is ${observed[key]}, expected ${expected[key]}`);
  if (mismatches.length > 0) throw new Error(`PrivateCreditBond immutables do not match the intent: ${mismatches.join('; ')}`);
}

export function assertRoleAddresses(values: { sponsor: string; treasury: string; refundVault: string }): void {
  const names = Object.keys(values) as (keyof typeof values)[];
  for (const name of names) {
    if (!/^0x[0-9a-fA-F]{40}$/u.test(values[name]) || /^0x0{40}$/iu.test(values[name])) throw new Error(`${name} must be a nonzero address`);
  }
  const unique = new Set(names.map((name) => values[name].toLowerCase()));
  if (unique.size !== names.length) throw new Error('sponsor, treasury, and refund vault addresses must be distinct');
}

export function assertVerifierLinkage(observed: string, expected: string = EXISTING_B11_CONTRACTS.verifier): void {
  if (observed.toLowerCase() !== expected.toLowerCase()) throw new Error(`SpendVerifier wraps ${observed}; expected reviewed verifier ${expected}`);
}

/** The deterministic empty depth-20 root used by PrivateCreditBond.currentRoot. */
export async function initialCommitmentRoot(): Promise<string> {
  let root = '0';
  for (let level = 0; level < 20; level += 1) root = await poseidonHash([root, root]);
  return `0x${BigInt(root).toString(16).padStart(64, '0')}`;
}

export function assertInitialCommitmentRoot(observed: string, expected: string): void {
  if (observed.toLowerCase() !== expected.toLowerCase()) throw new Error(`initial commitment root is ${observed}; expected ${expected}`);
}

const GETTER_SIGNATURES = {
  usdc: 'usdc()',
  sponsor: 'sponsor()',
  refundVault: 'refundVault()',
  treasury: 'treasury()',
  poseidonT2: 'poseidonT2()',
  poseidonT3: 'poseidonT3()',
  poseidonT4: 'poseidonT4()',
  spendVerifier: 'spendVerifier()',
  deploymentDomain: 'deploymentDomain()',
  currentRoot: 'currentRoot()',
  verifier: 'verifier()',
} as const;

export function abiSelector(signature: string): string {
  return keccak256(toBytes(signature)).slice(0, 10);
}

function decodeWord(result: string, label: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(result)) throw new Error(`${label} returned an unreadable ABI word`);
  return result;
}

function decodeAddress(result: string, label: string): string {
  const word = decodeWord(result, label);
  return `0x${word.slice(-40)}`;
}

export async function readBondImmutables(chain: ChainReader, address: string): Promise<BondImmutables & { currentRoot: string }> {
  if (!chain.call) throw new Error('the chain reader cannot call bond getters');
  const readAddress = async (name: keyof Pick<BondImmutables, 'usdc' | 'sponsor' | 'refundVault' | 'treasury' | 'poseidonT2' | 'poseidonT3' | 'poseidonT4' | 'spendVerifier'>): Promise<string> => decodeAddress(await chain.call!(address, abiSelector(GETTER_SIGNATURES[name])), name);
  const domain = decodeWord(await chain.call(address, abiSelector(GETTER_SIGNATURES.deploymentDomain)), 'deploymentDomain');
  const root = decodeWord(await chain.call(address, abiSelector(GETTER_SIGNATURES.currentRoot)), 'currentRoot');
  return {
    usdc: await readAddress('usdc'),
    sponsor: await readAddress('sponsor'),
    refundVault: await readAddress('refundVault'),
    treasury: await readAddress('treasury'),
    poseidonT2: await readAddress('poseidonT2'),
    poseidonT3: await readAddress('poseidonT3'),
    poseidonT4: await readAddress('poseidonT4'),
    spendVerifier: await readAddress('spendVerifier'),
    deploymentDomain: domain,
    currentRoot: root,
  };
}

export async function readVerifierLinkage(chain: ChainReader, adapter: string): Promise<string> {
  if (!chain.call) throw new Error('the chain reader cannot call the SpendVerifier adapter');
  return decodeAddress(await chain.call(adapter, abiSelector(GETTER_SIGNATURES.verifier)), 'SpendVerifier.verifier');
}

/** The runtime sponsor approves test USDC for the bond. */
export function assertBoundedApproval(amountUsdc: bigint, capUsdc: bigint = MAX_PILOT_APPROVAL_USDC): void {
  if (amountUsdc <= 0n) throw new Error('the approval amount must be greater than zero');
  if (amountUsdc > capUsdc) throw new Error(`the approval is ${amountUsdc} USDC; the pilot is bounded to ${capUsdc} USDC`);
}
