/**
 * Base Sepolia deployment reconciliation.
 *
 * A broadcast is the one step in the launch that cannot be undone or repeated
 * safely. The approach is therefore to write down the intent *before* sending
 * it — the signer, the nonce, and the address those two imply — so that an
 * interrupted run can answer the only question that matters on resume:
 * did this deployment already happen?
 *
 * The answer comes from the chain, not from a log line:
 *
 * - a successful receipt at the predicted address confirms the deployment;
 * - bytecode at the predicted address without a receipt still confirms it,
 *   because the contract exists and the nonce was consumed;
 * - neither one means the broadcast never landed and a retry is safe; and
 * - a receipt whose contract address differs from the prediction, or a reverted
 *   receipt, is a hard stop rather than a retry.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getContractAddress } from 'viem';
import type { StepDetail } from './state.js';

/** The pilot is Base Sepolia only. */
export const PILOT_CHAIN_ID = 84532;

/** The approval bound the pilot commits to: at most 80 test USDC. */
export const MAX_PILOT_APPROVAL_USDC = 80n;

/** Poseidon libraries the bond needs, deployed before it. */
export const POSEIDON_LIBRARIES = ['PoseidonT2', 'PoseidonT3', 'PoseidonT4'] as const;

export const CONTRACT_DEPLOY_ORDER = [...POSEIDON_LIBRARIES, 'PrivateCreditBond'] as const;
export type ContractName = (typeof CONTRACT_DEPLOY_ORDER)[number];

/** The B11 artifacts already on Base Sepolia; the deployment must find them. */
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
  /** Filled in once the node accepts the transaction. */
  transactionHash: string | null;
}

/**
 * The CREATE address a signer/nonce pair implies. Written down before the
 * broadcast so a resumed run compares against a prediction rather than a log.
 */
export function predictDeploymentAddress(signer: string, nonce: number): string {
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

export interface ChainReceipt {
  status: 'success' | 'reverted';
  contractAddress: string | null;
  blockNumber: bigint;
}

/** The minimal chain surface reconciliation needs, so tests need no node. */
export interface ChainReader {
  receipt(transactionHash: string): Promise<ChainReceipt | undefined>;
  code(address: string): Promise<string>;
}

/**
 * A JSON-RPC reader over the dedicated Base Sepolia endpoint. Only the two
 * calls reconciliation needs are implemented, so the launch never holds a
 * general-purpose chain client.
 */
export function rpcChainReader(options: { rpcUrl: string; fetch?: typeof fetch }): ChainReader {
  const send = options.fetch ?? fetch;
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
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
    async receipt(transactionHash: string): Promise<ChainReceipt | undefined> {
      const result = await call('eth_getTransactionReceipt', [transactionHash]) as
        | { status?: string; contractAddress?: string | null; blockNumber?: string }
        | null;
      if (!result) return undefined;
      return {
        status: result.status === '0x1' ? 'success' : 'reverted',
        contractAddress: result.contractAddress ?? null,
        blockNumber: BigInt(result.blockNumber ?? '0x0'),
      };
    },
    async code(address: string): Promise<string> {
      const result = await call('eth_getCode', [address, 'latest']);
      return typeof result === 'string' ? result : '0x';
    },
  };
}

export type BroadcastReconciliation =
  | { kind: 'confirmed'; address: string; blockNumber: bigint; transactionHash: string | null }
  | { kind: 'absent'; reason: string }
  | { kind: 'mismatch'; reason: string };

function isDeployed(code: string): boolean {
  return code.length > 2 && code !== '0x';
}

/** The chains the pilot may ever deploy to. Anything else is refused. */
export function assertChainId(observed: number, expected: number = PILOT_CHAIN_ID): void {
  if (observed !== expected) throw new Error(`the RPC reports chain ${observed}; the pilot is chain ${expected} only`);
}

/**
 * Decides whether an interrupted broadcast already happened. Never guesses: an
 * unreadable chain is reported as `absent` only when nothing is deployed at the
 * predicted address.
 */
export async function reconcileBroadcast(intent: BroadcastIntent, chain: ChainReader): Promise<BroadcastReconciliation> {
  const deployed = isDeployed(await chain.code(intent.predictedAddress));

  if (intent.transactionHash) {
    const receipt = await chain.receipt(intent.transactionHash);
    if (receipt) {
      if (receipt.status === 'reverted') {
        return { kind: 'mismatch', reason: `${intent.contract} broadcast ${intent.transactionHash} reverted; investigate before retrying` };
      }
      const address = receipt.contractAddress ?? intent.predictedAddress;
      if (address.toLowerCase() !== intent.predictedAddress.toLowerCase()) {
        return {
          kind: 'mismatch',
          reason: `${intent.contract} deployed ${address} but ${intent.predictedAddress} was predicted from nonce ${intent.nonce}`,
        };
      }
      if (!deployed) {
        return { kind: 'mismatch', reason: `${intent.contract} receipt succeeded but ${address} has no bytecode` };
      }
      return { kind: 'confirmed', address, blockNumber: receipt.blockNumber, transactionHash: intent.transactionHash };
    }
  }

  if (deployed) {
    // The nonce was consumed and the contract is live: the broadcast landed even
    // though no hash was ever recorded.
    return { kind: 'confirmed', address: intent.predictedAddress, blockNumber: 0n, transactionHash: intent.transactionHash };
  }
  return { kind: 'absent', reason: `${intent.contract} has no bytecode at ${intent.predictedAddress}` };
}

/**
 * A deployment is only usable once its immutables read back as intended. The
 * getters are the contract's own, so the check is the same one an operator
 * would perform by hand.
 */
export interface BondImmutables {
  usdc: string;
  treasury: string;
  refundVault: string;
  verifier: string;
  adapter: string;
  deploymentDomain: string;
}

export function assertImmutables(observed: BondImmutables, expected: BondImmutables): void {
  const mismatches = (Object.keys(expected) as (keyof BondImmutables)[])
    .filter((key) => String(observed[key]).toLowerCase() !== String(expected[key]).toLowerCase())
    .map((key) => `${key} is ${observed[key]}, expected ${expected[key]}`);
  if (mismatches.length > 0) throw new Error(`PrivateCreditBond immutables do not match the intent: ${mismatches.join('; ')}`);
}

/**
 * The runtime sponsor approves test USDC for the bond. The approval must stay
 * bounded: an unbounded approval would let the bond draw the whole balance.
 */
export function assertBoundedApproval(amountUsdc: bigint, capUsdc: bigint = MAX_PILOT_APPROVAL_USDC): void {
  if (amountUsdc <= 0n) throw new Error('the approval amount must be greater than zero');
  if (amountUsdc > capUsdc) throw new Error(`the approval is ${amountUsdc} USDC; the pilot is bounded to ${capUsdc} USDC`);
}
