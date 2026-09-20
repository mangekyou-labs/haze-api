/** Minimal Base Sepolia sponsor client. Keys are environment-owned and never
 * persisted or returned by the API. */

import { baseSepolia } from 'viem/chains';
import { createPublicClient, createWalletClient, decodeEventLog, http, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Sponsor-side bond operations used by unpaid pilot funding. */
export interface BaseBondSponsor {
  fundBundle(commitment: string, tierId: number): Promise<{ transaction: string; expiryAt?: number }>;
  releaseBond(commitment: string): Promise<{ transaction: string }>;
}

export const PRIVATE_CREDIT_BOND_ABI = [
  { type: 'function', name: 'fundBundle', stateMutability: 'nonpayable', inputs: [{ name: 'commitment', type: 'bytes32' }, { name: 'tierId', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'releaseBond', stateMutability: 'nonpayable', inputs: [{ name: 'commitment', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'currentRoot', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'event', name: 'BundleFunded', anonymous: false, inputs: [
    { indexed: true, name: 'commitment', type: 'bytes32' },
    { indexed: true, name: 'tierId', type: 'uint8' },
    { indexed: false, name: 'expiry', type: 'uint64' },
    { indexed: false, name: 'leafIndex', type: 'uint256' },
    { indexed: false, name: 'bondAmount', type: 'uint256' },
    { indexed: false, name: 'root', type: 'bytes32' },
  ] },
] as const;

function contractAddress(): `0x${string}` {
  const value = process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS;
  if (!value || !/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new Error('BASE_PRIVATE_CREDIT_BOND_ADDRESS is not configured');
  return value as `0x${string}`;
}

function sponsorAccount() {
  const value = process.env.BASE_SPONSOR_PRIVATE_KEY;
  if (!value || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new Error('BASE_SPONSOR_PRIVATE_KEY is not configured');
  return privateKeyToAccount(value as Hex);
}

export function createBaseBondSponsor(): BaseBondSponsor {
  const account = sponsorAccount();
  const client = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });
  const address = contractAddress();
  return {
    async fundBundle(commitment: string, tierId: number) {
      const hash = await client.writeContract({ address, abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'fundBundle', args: [toHex(BigInt(commitment), { size: 32 }), tierId] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('base_funding_transaction_failed');
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: PRIVATE_CREDIT_BOND_ABI, data: log.data, topics: log.topics, eventName: 'BundleFunded' });
          if (decoded.eventName === 'BundleFunded') {
            const args = decoded.args as { expiry?: bigint };
            if (args.expiry === undefined) throw new Error('base_funding_expiry_missing');
            return { transaction: hash, expiryAt: Number(args.expiry) * 1000 };
          }
        } catch {
          // Ignore logs emitted by other contracts in the transaction receipt.
        }
      }
      throw new Error('base_funding_event_missing');
    },
    async releaseBond(commitment: string) {
      const hash = await client.writeContract({ address, abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'releaseBond', args: [toHex(BigInt(commitment), { size: 32 })] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('base_release_transaction_failed');
      return { transaction: hash };
    },
  };
}

export function createBasePublicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });
}

export async function readCurrentBaseRoot(): Promise<string> {
  const client = createBasePublicClient();
  return String(await client.readContract({ address: contractAddress(), abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'currentRoot' }));
}
