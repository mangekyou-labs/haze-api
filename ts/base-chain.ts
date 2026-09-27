/** Minimal Base Sepolia sponsor client. Keys are environment-owned and never
 * persisted or returned by the API. */

import { baseSepolia } from 'viem/chains';
import { createPublicClient, createWalletClient, decodeEventLog, http, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Attribution } from 'ox/erc8021';

/** Sponsor-side bond operations used by unpaid pilot funding. */
export interface BaseBondSponsor {
  fundBundle(commitment: string, tierId: number): Promise<{ transaction: string; expiryAt?: number }>;
  reconcileBundle(commitment: string): Promise<{ transaction: string; expiryAt: number } | undefined>;
  releaseBond(commitment: string): Promise<{ transaction: string }>;
}

export const PRIVATE_CREDIT_BOND_ABI = [
  { type: 'function', name: 'fundBundle', stateMutability: 'nonpayable', inputs: [{ name: 'commitment', type: 'bytes32' }, { name: 'tierId', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'releaseBond', stateMutability: 'nonpayable', inputs: [{ name: 'commitment', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'currentRoot', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'rootAt', stateMutability: 'view', inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
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

function builderCodeDataSuffix(): Hex {
  const value = process.env.BASE_BUILDER_CODE;
  if (!value) throw new Error('BASE_BUILDER_CODE is not configured');
  if (!/^[a-z0-9_]{1,32}$/u.test(value)) throw new Error('BASE_BUILDER_CODE is invalid');
  return Attribution.toDataSuffix({ codes: [value] });
}

export function createBaseBondSponsor(): BaseBondSponsor {
  const account = sponsorAccount();
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(process.env.BASE_RPC_URL),
    dataSuffix: builderCodeDataSuffix(),
  });
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) });
  const address = contractAddress();
  return {
    async reconcileBundle(commitment: string) {
      const latest = await publicClient.getBlockNumber();
      const confirmations = BigInt(process.env.BASE_CONFIRMATIONS ?? '3');
      if (latest <= confirmations) return undefined;
      const target = latest - confirmations;
      const deployment = process.env.BASE_DEPLOYMENT_BLOCK && /^\d+$/u.test(process.env.BASE_DEPLOYMENT_BLOCK)
        ? BigInt(process.env.BASE_DEPLOYMENT_BLOCK) : 0n;
      const wanted = toHex(BigInt(commitment), { size: 32 }).toLowerCase();
      for (let fromBlock = deployment; fromBlock <= target; fromBlock += 2_000n) {
        const toBlock = fromBlock + 1_999n < target ? fromBlock + 1_999n : target;
        const logs = await publicClient.getContractEvents({
          address,
          abi: PRIVATE_CREDIT_BOND_ABI,
          eventName: 'BundleFunded',
          args: { commitment: wanted as Hex },
          fromBlock,
          toBlock,
        });
        for (const log of logs) {
          if (log.args.commitment?.toLowerCase() === wanted && log.args.expiry !== undefined && log.transactionHash) {
            return { transaction: log.transactionHash, expiryAt: Number(log.args.expiry) * 1000 };
          }
        }
      }
      return undefined;
    },
    async fundBundle(commitment: string, tierId: number) {
      const hash = await client.writeContract({ address, abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'fundBundle', args: [toHex(BigInt(commitment), { size: 32 }), tierId] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: Number(process.env.BASE_CONFIRMATIONS ?? '3') });
      if (receipt.status !== 'success') throw new Error('base_funding_transaction_failed');
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== address.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: PRIVATE_CREDIT_BOND_ABI, data: log.data, topics: log.topics, eventName: 'BundleFunded' });
          if (decoded.eventName === 'BundleFunded') {
            const args = decoded.args as { commitment?: Hex; expiry?: bigint };
            if (args.commitment?.toLowerCase() !== toHex(BigInt(commitment), { size: 32 }).toLowerCase()) continue;
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

/** Reads the constructor root, which is not emitted as an event. */
export async function readInitialBaseRoot(): Promise<string> {
  const client = createBasePublicClient();
  return String(await client.readContract({ address: contractAddress(), abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'rootAt', args: [0n] }));
}
