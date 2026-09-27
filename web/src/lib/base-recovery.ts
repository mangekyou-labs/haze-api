/** Read-only Base Sepolia bundle lookup used only after the gateway store misses. */

import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';

const BN254_FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const BASE_CHAIN_ID = 84532;
const DEFAULT_CONFIRMATIONS = 3n;
const MAX_LOG_BLOCK_RANGE = 10_000n;
const BUNDLE_FUNDED_EVENT = parseAbiItem(
  'event BundleFunded(bytes32 indexed commitment, uint8 indexed tierId, uint64 expiry, uint256 leafIndex, uint256 bondAmount, bytes32 root)',
);

const PRIVATE_CREDIT_BOND_RECOVERY_ABI = parseAbi([
  'function deploymentDomain() view returns (bytes32)',
  'function bundles(bytes32 commitment) view returns (uint8 state, uint8 tierId, uint64 expiry, uint32 leafIndex, uint256 bondAmount)',
  'function rootAt(uint256 index) view returns (bytes32)',
  'event BundleFunded(bytes32 indexed commitment, uint8 indexed tierId, uint64 expiry, uint256 leafIndex, uint256 bondAmount, bytes32 root)',
]);

export type BaseRecoveryErrorCode =
  | 'chain_unavailable'
  | 'metadata_invalid'
  | 'bundle_expired'
  | 'bundle_unusable'
  | 'bundle_unconfirmed';

export class BaseRecoveryError extends Error {
  constructor(readonly code: BaseRecoveryErrorCode) {
    super(messageForCode(code));
    this.name = 'BaseRecoveryError';
  }
}

function messageForCode(code: BaseRecoveryErrorCode): string {
  switch (code) {
    case 'bundle_expired': return 'The funded bundle has expired';
    case 'bundle_unusable': return 'The funded bundle is no longer active';
    case 'bundle_unconfirmed': return 'The funded bundle is not sufficiently confirmed';
    case 'metadata_invalid': return 'Base funding metadata could not be verified';
    case 'chain_unavailable': return 'Base recovery lookup is unavailable';
  }
}

export interface BaseBundleSnapshot {
  state: bigint;
  tierId: bigint;
  expiry: bigint;
  leafIndex: bigint;
  bondAmount: bigint;
}

export interface BaseBundleFundedEvent {
  commitment: Hex;
  tierId: bigint;
  expiry: bigint;
  leafIndex: bigint;
  bondAmount: bigint;
  root: Hex;
  transactionHash: Hex;
  blockNumber: bigint;
}

/** The narrow read interface also makes the chain-verification rules testable without RPC. */
export interface BaseRecoveryReader {
  getChainId(): Promise<number>;
  getHead(): Promise<bigint>;
  getDeploymentDomain(contractAddress: Address, blockNumber: bigint): Promise<bigint>;
  getBundle(contractAddress: Address, commitment: Hex, blockNumber: bigint): Promise<BaseBundleSnapshot>;
  getFundedEvents(
    contractAddress: Address,
    commitment: Hex,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<BaseBundleFundedEvent[]>;
  getRootAt(contractAddress: Address, index: bigint, blockNumber: bigint): Promise<Hex>;
}

export interface BaseRecoveryConfig {
  contractAddress: string;
  deploymentBlock: bigint;
  deploymentDomain: string;
  confirmations: bigint;
  nowSeconds?: () => number;
}

export interface BaseRecoveryMetadata {
  commitment: string;
  tierId: number;
  expiry: number;
  deploymentDomain: string;
  network: 'eip155:84532';
  contractAddress: string;
  transactionHash: string;
}

function asBytes32(value: string): Hex {
  try {
    const commitment = BigInt(value);
    if (commitment <= 0n || commitment >= BN254_FIELD_ORDER) throw new Error();
    return toHex(commitment, { size: 32 });
  } catch {
    throw new BaseRecoveryError('metadata_invalid');
  }
}

function parseConfig(config: BaseRecoveryConfig): {
  contractAddress: Address;
  deploymentDomain: bigint;
} {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(config.contractAddress)
    || config.deploymentBlock < 0n
    || config.confirmations < 1n) {
    throw new BaseRecoveryError('chain_unavailable');
  }
  let deploymentDomain: bigint;
  try {
    if (!/^(?:\d+|0x[0-9a-fA-F]{1,64})$/u.test(config.deploymentDomain)) throw new Error();
    deploymentDomain = BigInt(config.deploymentDomain);
  } catch {
    throw new BaseRecoveryError('chain_unavailable');
  }
  if (deploymentDomain <= 0n || deploymentDomain >= BN254_FIELD_ORDER) {
    throw new BaseRecoveryError('chain_unavailable');
  }
  return {
    contractAddress: config.contractAddress as Address,
    deploymentDomain,
  };
}

async function getMatchingEvents(
  reader: BaseRecoveryReader,
  contractAddress: Address,
  commitment: Hex,
  deploymentBlock: bigint,
  head: bigint,
): Promise<BaseBundleFundedEvent[]> {
  const events: BaseBundleFundedEvent[] = [];
  for (let fromBlock = deploymentBlock; fromBlock <= head; fromBlock += MAX_LOG_BLOCK_RANGE) {
    const toBlock = fromBlock + MAX_LOG_BLOCK_RANGE - 1n < head
      ? fromBlock + MAX_LOG_BLOCK_RANGE - 1n
      : head;
    events.push(...await reader.getFundedEvents(contractAddress, commitment, fromBlock, toBlock));
  }
  return events;
}

/** Verifies the active mapping entry, its indexed funding event, the tree root, and confirmations. */
export function createBaseRecoveryLookup(reader: BaseRecoveryReader, config: BaseRecoveryConfig) {
  return async (commitmentValue: string): Promise<BaseRecoveryMetadata | null> => {
    try {
      const { contractAddress, deploymentDomain } = parseConfig(config);
      const commitment = asBytes32(commitmentValue);
      if (await reader.getChainId() !== BASE_CHAIN_ID) throw new BaseRecoveryError('metadata_invalid');

      const head = await reader.getHead();
      const [onchainDomain, bundle] = await Promise.all([
        reader.getDeploymentDomain(contractAddress, head),
        reader.getBundle(contractAddress, commitment, head),
      ]);
      if (onchainDomain !== deploymentDomain) throw new BaseRecoveryError('metadata_invalid');

      if (bundle.state === 0n) return null;
      if (bundle.state !== 1n) throw new BaseRecoveryError('bundle_unusable');
      if (bundle.expiry <= BigInt((config.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))())) {
        throw new BaseRecoveryError('bundle_expired');
      }
      if (bundle.tierId !== 0n || bundle.bondAmount <= 0n) {
        throw new BaseRecoveryError('metadata_invalid');
      }

      const events = await getMatchingEvents(reader, contractAddress, commitment, config.deploymentBlock, head);
      if (events.length !== 1) throw new BaseRecoveryError('metadata_invalid');
      const event = events[0];
      if (event.blockNumber < config.deploymentBlock || event.blockNumber > head) {
        throw new BaseRecoveryError('metadata_invalid');
      }
      if (head - event.blockNumber + 1n < config.confirmations) {
        throw new BaseRecoveryError('bundle_unconfirmed');
      }
      if (
        event.commitment.toLowerCase() !== commitment.toLowerCase()
        || event.tierId !== bundle.tierId
        || event.expiry !== bundle.expiry
        || event.leafIndex !== bundle.leafIndex
        || event.bondAmount !== bundle.bondAmount
        || !/^0x[0-9a-fA-F]{64}$/u.test(event.root)
        || !/^0x[0-9a-fA-F]{64}$/u.test(event.transactionHash)
      ) {
        throw new BaseRecoveryError('metadata_invalid');
      }

      const recordedRoot = await reader.getRootAt(contractAddress, event.leafIndex + 1n, head);
      if (recordedRoot.toLowerCase() !== event.root.toLowerCase()) {
        throw new BaseRecoveryError('metadata_invalid');
      }

      const expiry = Number(bundle.expiry);
      if (!Number.isSafeInteger(expiry) || expiry <= 0) throw new BaseRecoveryError('metadata_invalid');
      return {
        commitment: BigInt(commitmentValue).toString(),
        tierId: Number(bundle.tierId),
        expiry,
        deploymentDomain: deploymentDomain.toString(),
        network: 'eip155:84532',
        contractAddress: contractAddress.toLowerCase(),
        transactionHash: event.transactionHash,
      };
    } catch (error) {
      if (error instanceof BaseRecoveryError) throw error;
      throw new BaseRecoveryError('chain_unavailable');
    }
  };
}

function createViemRecoveryReader(rpcUrl: string): BaseRecoveryReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  return {
    getChainId: () => client.getChainId(),
    getHead: () => client.getBlockNumber(),
    async getDeploymentDomain(contractAddress, blockNumber) {
      const value = await client.readContract({
        address: contractAddress,
        abi: PRIVATE_CREDIT_BOND_RECOVERY_ABI,
        functionName: 'deploymentDomain',
        blockNumber,
      });
      return BigInt(value);
    },
    async getBundle(contractAddress, commitment, blockNumber) {
      const bundle = await client.readContract({
        address: contractAddress,
        abi: PRIVATE_CREDIT_BOND_RECOVERY_ABI,
        functionName: 'bundles',
        args: [commitment],
        blockNumber,
      });
      return {
        state: BigInt(bundle[0]),
        tierId: BigInt(bundle[1]),
        expiry: BigInt(bundle[2]),
        leafIndex: BigInt(bundle[3]),
        bondAmount: BigInt(bundle[4]),
      };
    },
    async getFundedEvents(contractAddress, commitment, fromBlock, toBlock) {
      const logs = await client.getLogs({
        address: contractAddress,
        event: BUNDLE_FUNDED_EVENT,
        args: { commitment },
        fromBlock,
        toBlock,
      });
      return logs.map((log) => {
        const args = log.args;
        if (
          !args.commitment
          || args.tierId === undefined
          || args.expiry === undefined
          || args.leafIndex === undefined
          || args.bondAmount === undefined
          || !args.root
          || !log.transactionHash
          || log.blockNumber === null
        ) {
          throw new BaseRecoveryError('metadata_invalid');
        }
        return {
          commitment: args.commitment,
          tierId: BigInt(args.tierId),
          expiry: BigInt(args.expiry),
          leafIndex: BigInt(args.leafIndex),
          bondAmount: BigInt(args.bondAmount),
          root: args.root,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
        };
      });
    },
    async getRootAt(contractAddress, index, blockNumber) {
      return client.readContract({
        address: contractAddress,
        abi: PRIVATE_CREDIT_BOND_RECOVERY_ABI,
        functionName: 'rootAt',
        args: [index],
        blockNumber,
      });
    },
  };
}

function configuredLookup(): (commitment: string) => Promise<BaseRecoveryMetadata | null> {
  const rpcUrl = process.env.BASE_RPC_URL;
  const contractAddress = process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS;
  const deploymentBlock = process.env.BASE_DEPLOYMENT_BLOCK;
  const deploymentDomain = process.env.BASE_DEPLOYMENT_DOMAIN ?? '84532';
  const confirmations = process.env.BASE_CONFIRMATIONS ?? DEFAULT_CONFIRMATIONS.toString();
  if (
    !rpcUrl
    || !contractAddress
    || !deploymentBlock
    || !/^\d+$/u.test(deploymentBlock)
    || !/^\d+$/u.test(confirmations)
  ) {
    throw new BaseRecoveryError('chain_unavailable');
  }
  return createBaseRecoveryLookup(createViemRecoveryReader(rpcUrl), {
    contractAddress,
    deploymentBlock: BigInt(deploymentBlock),
    deploymentDomain,
    confirmations: BigInt(confirmations),
  });
}

/** Performs reads only; this recovery path cannot sponsor or fund a bundle. */
export async function findFundedBundleOnBase(commitment: string): Promise<BaseRecoveryMetadata | null> {
  return configuredLookup()(commitment);
}
