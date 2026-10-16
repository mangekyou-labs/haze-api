/** Minimal Base Sepolia sponsor client. Keys are environment-owned and never
 * persisted or returned by the API. */

import { baseSepolia } from 'viem/chains';
import { createPublicClient, createWalletClient, decodeEventLog, erc20Abi, http, toHex, TransactionReceiptNotFoundError, type Hex } from 'viem';
import { privateKeyToAccount, nonceManager } from 'viem/accounts';
import { Attribution } from 'ox/erc8021';
import { createResilientRpcFetch } from '@zk-credits/shared/base';
import { FundingPreBroadcastError } from './pilot-funding.js';
import { FundingRevertedError, type SandboxFunderStatus } from './sandbox-billing.js';

/** Sponsor-side bond operations used to fund pilot test-credit bundles. */
export interface BaseBondSponsor {
  fundBundle(commitment: string, tierId: number, onBroadcast?: (hash: string) => Promise<void>): Promise<{ transaction: string; expiryAt?: number }>;
  reconcileBundle(commitment: string, hash?: string | null): Promise<{ transaction: string; expiryAt: number } | undefined>;
  fundingStatus(): Promise<SandboxFunderStatus>;
  isConfirmedRevert(hash: string): Promise<boolean>;
  releaseBond(commitment: string): Promise<{ transaction: string }>;
}

export const PRIVATE_CREDIT_BOND_ABI = [
  { type: 'function', name: 'tierConfig', stateMutability: 'pure', inputs: [{ name: 'tierId', type: 'uint8' }], outputs: [{ name: 'allowance', type: 'uint256' }, { name: 'bondAmount', type: 'uint256' }] },
  { type: 'function', name: 'sponsor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'usdc', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'fundBundle', stateMutability: 'nonpayable', inputs: [{ name: 'commitment', type: 'bytes32' }, { name: 'tierId', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'releaseBond', stateMutability: 'nonpayable', inputs: [{ name: 'commitment', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'currentRoot', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'knownRoot', stateMutability: 'view', inputs: [{ name: 'root', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
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
  return privateKeyToAccount(value as Hex, { nonceManager });
}

function builderCodeDataSuffix(): Hex {
  const value = process.env.BASE_BUILDER_CODE;
  if (!value) throw new Error('BASE_BUILDER_CODE is not configured');
  if (!/^[a-z0-9_]{1,32}$/u.test(value)) throw new Error('BASE_BUILDER_CODE is invalid');
  return Attribution.toDataSuffix({ codes: [value] });
}

const CIRCLE_BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const SANDBOX_BOND_USDC = 20_000_000n;
// Shared by signing, reconciliation and event-sync clients in this process.
const rpcFetch = createResilientRpcFetch({ requestsPerMinute: 300, maxConcurrent: 8 });
function baseTransport(background = false) {
  return http(process.env.BASE_RPC_URL, { fetchFn: background ? rpcFetch.background : rpcFetch, retryCount: 0, timeout: 30_000 });
}

export function createBaseBondSponsor(options: { autoApproveUsdc?: boolean } = {}): BaseBondSponsor {
  const account = sponsorAccount();
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: baseTransport(),
    dataSuffix: builderCodeDataSuffix(),
  });
  const publicClient = createPublicClient({ chain: baseSepolia, transport: baseTransport() });
  const address = contractAddress();
  async function checkPreflight(simulate: () => Promise<unknown>, estimateGas: () => Promise<bigint>) {
    await simulate();
    const [gas, fees, balance] = await Promise.all([
      estimateGas(), publicClient.estimateFeesPerGas(), publicClient.getBalance({ address: account.address }),
    ]);
    if (balance < gas * fees.maxFeePerGas * 125n / 100n) throw new FundingPreBroadcastError('insufficient_gas');
  }
  return {
    async fundingStatus() {
      const [chainId, sponsor, token, tier] = await Promise.all([
        publicClient.getChainId(),
        publicClient.readContract({ address, abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'sponsor' }),
        publicClient.readContract({ address, abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'usdc' }),
        publicClient.readContract({ address, abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'tierConfig', args: [0] }),
      ]);
      const [usdc, allowance, gas] = await Promise.all([
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account.address, address] }),
        publicClient.getBalance({ address: account.address }),
      ]);
      const reason = tier[0] !== 250n || tier[1] !== 20_000_000n ? 'unsupported_tier' : chainId !== 84532 ? 'wrong_chain' : sponsor.toLowerCase() !== account.address.toLowerCase() ? 'sponsor_mismatch'
        : usdc < 20_000_000n ? 'insufficient_usdc' : gas === 0n ? 'insufficient_gas'
        : options.autoApproveUsdc && token.toLowerCase() !== CIRCLE_BASE_SEPOLIA_USDC ? 'unsupported_token'
        : allowance < SANDBOX_BOND_USDC && !options.autoApproveUsdc ? 'insufficient_allowance' : null;
      return { address: sponsor, tokenAddress: token, usdcBalance: usdc.toString(), gasBalanceWei: gas.toString(), allowance: allowance.toString(),
        ready: !reason, reason, faucetUrl: token.toLowerCase() === '0x036cbd53842c5426634e7929541ec2318f3dcf7e' ? 'https://faucet.circle.com/' : '' };
    },
    async isConfirmedRevert(hash: string) {
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });
      const latest = await publicClient.getBlockNumber();
      return receipt.status === 'reverted' && latest - receipt.blockNumber + 1n >= BigInt(process.env.BASE_CONFIRMATIONS ?? '3');
    },
    async reconcileBundle(commitment: string, hash?: string | null) {
      const wanted = toHex(BigInt(commitment), { size: 32 }).toLowerCase();
      const confirmations = BigInt(process.env.BASE_CONFIRMATIONS ?? '3');
      if (hash) {
        const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex }).catch(error => {
          if (error instanceof TransactionReceiptNotFoundError) return undefined;
          throw error; // Provider failure is not evidence that the transaction is missing.
        });
        if (receipt?.status === 'success') {
          const latest = await publicClient.getBlockNumber();
          // Match the finalized window used by event/witness synchronization.
          for (const log of latest - receipt.blockNumber >= confirmations ? receipt.logs : []) {
            if (log.address.toLowerCase() !== address.toLowerCase()) continue;
            try {
              const decoded = decodeEventLog({ abi: PRIVATE_CREDIT_BOND_ABI, data: log.data, topics: log.topics, eventName: 'BundleFunded' });
              if (decoded.args.commitment?.toLowerCase() === wanted && decoded.args.expiry !== undefined) {
                return { transaction: receipt.transactionHash, expiryAt: Number(decoded.args.expiry) * 1000 };
              }
            } catch { /* unrelated receipt event */ }
          }
        }
        // Missing/replaced transactions still need authoritative commitment recovery.
      }
      const configuredRange = process.env.BASE_SYNC_MAX_BLOCK_RANGE?.trim();
      if (configuredRange && (!/^\d+$/u.test(configuredRange) || BigInt(configuredRange) <= 0n)) {
        throw new Error('BASE_SYNC_MAX_BLOCK_RANGE must be a positive whole number');
      }
      const maxBlockRange = configuredRange ? BigInt(configuredRange) : 2_000n;
      const latest = await publicClient.getBlockNumber();
      if (latest <= confirmations) return undefined;
      const target = latest - confirmations;
      const deployment = process.env.BASE_DEPLOYMENT_BLOCK && /^\d+$/u.test(process.env.BASE_DEPLOYMENT_BLOCK)
        ? BigInt(process.env.BASE_DEPLOYMENT_BLOCK) : 0n;
      for (let fromBlock = deployment; fromBlock <= target; fromBlock += maxBlockRange) {
        const toBlock = fromBlock + maxBlockRange - 1n < target ? fromBlock + maxBlockRange - 1n : target;
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
    async fundBundle(commitment: string, tierId: number, onBroadcast?: (hash: string) => Promise<void>) {
      if (options.autoApproveUsdc) {
        // The sandbox adapter holds the database sponsor lock across approval
        // and funding. Only this testnet token and one tier-0 bond are approved.
        if (tierId !== 0) throw new FundingPreBroadcastError('unsupported_tier');
        let status: SandboxFunderStatus;
        try { status = await this.fundingStatus(); }
        catch { throw new FundingPreBroadcastError('funder_unavailable'); }
        if (!status.ready) throw new FundingPreBroadcastError(status.reason ?? 'funder_unavailable');
        if (BigInt(status.allowance) < SANDBOX_BOND_USDC) {
          const approvalWrite = { address: status.tokenAddress as Hex, abi: erc20Abi,
            functionName: 'approve' as const, args: [address, SANDBOX_BOND_USDC] as const };
          try {
            await checkPreflight(
              () => publicClient.simulateContract({ ...approvalWrite, account }),
              () => publicClient.estimateContractGas({ ...approvalWrite, account }),
            );
          } catch (error) {
            if (error instanceof FundingPreBroadcastError) throw error;
            throw new FundingPreBroadcastError('approval_failed');
          }
          let approvalHash: Hex;
          try {
            const [pendingNonce, latestNonce] = await Promise.all([
              publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }),
              publicClient.getTransactionCount({ address: account.address, blockTag: 'latest' }),
            ]);
            if (pendingNonce !== latestNonce) throw new FundingPreBroadcastError('approval_pending');
            approvalHash = await client.writeContract({ ...approvalWrite, nonce: pendingNonce });
          } catch (error) {
            if (error instanceof FundingPreBroadcastError) throw error;
            // A write timeout may still have sent approval. No bundle was sent.
            throw new FundingPreBroadcastError('approval_pending');
          }
          let approval;
          try {
            approval = await publicClient.waitForTransactionReceipt({ hash: approvalHash,
              confirmations: Number(process.env.BASE_CONFIRMATIONS ?? '3') });
          } catch { throw new FundingPreBroadcastError('approval_pending'); }
          if (approval.status !== 'success') throw new FundingPreBroadcastError('approval_failed');
          try {
            const confirmedAllowance = await publicClient.readContract({ address: status.tokenAddress as Hex,
              abi: erc20Abi, functionName: 'allowance', args: [account.address, address] });
            if (confirmedAllowance < SANDBOX_BOND_USDC) throw new Error('allowance_not_updated');
          } catch { throw new FundingPreBroadcastError('approval_failed'); }
        }
      }
      const write = { address, abi: PRIVATE_CREDIT_BOND_ABI, functionName: 'fundBundle' as const, args: [toHex(BigInt(commitment), { size: 32 }), tierId] as const };
      let nonce: number;
      try {
        await checkPreflight(
          () => publicClient.simulateContract({ ...write, account }),
          () => publicClient.estimateContractGas({ ...write, account }),
        );
        nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
      } catch (error) {
        if (error instanceof FundingPreBroadcastError) throw error;
        // Readiness can change after billing checks it and before this attempt
        // acquires the sponsor lock (for example, a previous bundle spends the
        // remaining allowance). Diagnose only before any funding write; an RPC
        // failure in this read must not expose provider details or mask the
        // definitive pre-broadcast outcome.
        const status = await this.fundingStatus().catch(() => undefined);
        if (status?.reason) throw new FundingPreBroadcastError(status.reason);
        throw new FundingPreBroadcastError('preflight_failed');
      }
      // A write error can be an RPC timeout after broadcast; callers must hold it.
      // The caller holds the database sponsor lock across this operation. An
      // explicit pending nonce avoids a stale in-process cache across gateways.
      const hash = await client.writeContract({ ...write, nonce });
      await onBroadcast?.(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: Number(process.env.BASE_CONFIRMATIONS ?? '3'),
        onReplaced: async replacement => { await onBroadcast?.(replacement.transaction.hash); },
      });
      if (receipt.status !== 'success') throw new FundingRevertedError('base_funding_transaction_failed');
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== address.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: PRIVATE_CREDIT_BOND_ABI, data: log.data, topics: log.topics, eventName: 'BundleFunded' });
          if (decoded.eventName === 'BundleFunded') {
            const args = decoded.args as { commitment?: Hex; expiry?: bigint };
            if (args.commitment?.toLowerCase() !== toHex(BigInt(commitment), { size: 32 }).toLowerCase()) continue;
            if (args.expiry === undefined) throw new Error('base_funding_expiry_missing');
            return { transaction: receipt.transactionHash ?? hash, expiryAt: Number(args.expiry) * 1000 };
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

export function createBasePublicClient(options: { background?: boolean } = {}) {
  return createPublicClient({ chain: baseSepolia, transport: baseTransport(options.background) });
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

/** Confirm membership without waiting for historical event backfill. Never reads unconfirmed state. */
export async function readConfirmedBaseRootKnown(root: string): Promise<boolean> {
  const client = createBasePublicClient();
  const confirmations = BigInt(process.env.BASE_CONFIRMATIONS ?? '3');
  if (confirmations < 0n) throw new Error('invalid_base_confirmations');
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const blockNumber = head > confirmations ? head - confirmations : 0n;
  return await client.readContract({
    address: contractAddress(), abi: PRIVATE_CREDIT_BOND_ABI,
    functionName: 'knownRoot', args: [toHex(BigInt(root), { size: 32 })], blockNumber,
  });
}
