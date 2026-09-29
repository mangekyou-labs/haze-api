/** Active Base / x402 gateway entry point. Historical Stellar runtime lives in
 * ts/archive/stellar and is excluded from the active build. The research pilot
 * runtime has no Stripe checkout, order, refund, dispute, or wallet-link path. */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import { createBaseBondSponsor, readInitialBaseRoot } from './base-chain.js';
import { createPool, runMigrations } from './db/index.js';
import { PostgresClaimStore, createClaimStore } from './claim-store.js';
import {
  BaseContractEventSynchronizer,
  MemoryBaseEventStore,
  PostgresBaseEventStore,
} from './base-event-sync.js';
import { createBasePublicClient } from './base-chain.js';
import { PostgresInviteStore, PilotInviteService } from './pilot-invites.js';
import { FundingPreBroadcastError, PilotFundingService, PostgresFundingCapabilityStore } from './pilot-funding.js';
import { LaunchControl, PostgresLaunchControlStore, MemoryLaunchControlStore } from './launch-control.js';
import { resolveSpendCaps } from './launch-environment.js';
import { LaunchMetrics } from './metrics.js';
import type { Pool } from 'pg';

const port = Number(process.env.PORT ?? 3000);
function resolveBaseSyncMaxBlockRange(): bigint | undefined {
  const raw = process.env.BASE_SYNC_MAX_BLOCK_RANGE?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/u.test(raw) || BigInt(raw) <= 0n) {
    throw new Error('BASE_SYNC_MAX_BLOCK_RANGE must be a positive whole number');
  }
  return BigInt(raw);
}

const hasDatabaseConfig = Boolean(
  process.env.DATABASE_URL || process.env.PGHOST || process.env.PGPORT || process.env.PGUSER
    || process.env.PGPASSWORD || process.env.PGDATABASE,
);
let pool: Pool | undefined;
if (hasDatabaseConfig) {
  pool = createPool();
  await runMigrations(pool, fileURLToPath(new URL('./db/migrations/', import.meta.url)));
}

const baseContractAddress = process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS;
const initialBaseRoots = process.env.BASE_KNOWN_ROOTS?.split(',').map((root) => root.trim()).filter(Boolean) ?? [];
let initialBaseRoot = process.env.BASE_CURRENT_ROOT?.trim() || undefined;
if (!initialBaseRoot && baseContractAddress && process.env.BASE_RPC_URL && /^0x[0-9a-fA-F]{40}$/u.test(baseContractAddress)) {
  try {
    initialBaseRoot = await readInitialBaseRoot();
  } catch {
    // The event synchronizer remains fail-closed until the constructor root
    // can be read or a root event is observed.
    console.error('Base initial root bootstrap failed');
  }
}
const initialBaseState = {
  contractAddress: baseContractAddress ?? '',
  currentRoot: initialBaseRoot,
  knownRoots: initialBaseRoots,
  deploymentBlock: process.env.BASE_DEPLOYMENT_BLOCK && /^\d+$/u.test(process.env.BASE_DEPLOYMENT_BLOCK)
    ? BigInt(process.env.BASE_DEPLOYMENT_BLOCK)
    : undefined,
};
const baseEventStore = pool
  ? new PostgresBaseEventStore(pool, initialBaseState)
  : new MemoryBaseEventStore(initialBaseState);
let baseEventSync: BaseContractEventSynchronizer | undefined;
if (baseContractAddress && process.env.BASE_RPC_URL && /^0x[0-9a-fA-F]{40}$/u.test(baseContractAddress)) {
  baseEventSync = new BaseContractEventSynchronizer({
    contractAddress: baseContractAddress,
    client: createBasePublicClient() as never,
    store: baseEventStore,
    deploymentBlock: initialBaseState.deploymentBlock,
    confirmations: BigInt(process.env.BASE_CONFIRMATIONS ?? '3'),
    maxBlockRange: resolveBaseSyncMaxBlockRange(),
    initialRoot: initialBaseState.currentRoot,
  });
  try {
    await baseEventSync.syncOnce();
  } catch {
    // A temporary RPC outage must not take down the API. The last durable
    // snapshot (or explicit environment roots) remains the fail-closed source
    // until the next sync attempt.
    console.error('Base event synchronization failed');
  }
}

// Detached pilot provisioning needs both the durable provisioning store and a
// configured Base Sepolia contract. Without them the pilot endpoints fail
// closed while proof-root synchronization above keeps running.
const pilotFunding = pool && baseContractAddress && /^0x[0-9a-fA-F]{40}$/u.test(baseContractAddress)
  ? new PilotFundingService({
      store: new PostgresFundingCapabilityStore(pool),
      contractAddress: baseContractAddress,
      deploymentDomain: process.env.BASE_DEPLOYMENT_DOMAIN ?? '84532',
      sponsor: {
        async fundCommitment(commitment: string) {
          let sponsor;
          try {
            sponsor = createBaseBondSponsor();
          } catch {
            throw new FundingPreBroadcastError('sponsor_not_configured');
          }
          const sponsored = await sponsor.fundBundle(commitment, 0);
          return { transactionHash: sponsored.transaction, expiryAt: sponsored.expiryAt };
        },
        async reconcileCommitment(commitment: string) {
          const found = await createBaseBondSponsor().reconcileBundle(commitment);
          return found ? { transactionHash: found.transaction, expiryAt: found.expiryAt } : undefined;
        },
      },
    })
  : undefined;
const pilotInvites = pool && pilotFunding
  ? new PilotInviteService({
      store: new PostgresInviteStore(pool),
      capabilities: { issue: () => pilotFunding.issueCapability() },
    })
  : undefined;

// The launch controls are durable whenever Postgres is configured: the manual
// kill switch and the micro-USD provider-spend caps must survive a restart.
//
// Caps resolve once, at startup. A deployment that is not explicitly staging
// refuses a staging override here rather than booting with a ceiling nobody
// intended, so a production service can never run on a staging cap.
const spendCaps = resolveSpendCaps();
const launchControl = new LaunchControl({
  store: pool ? new PostgresLaunchControlStore(pool, spendCaps) : new MemoryLaunchControlStore({ caps: spendCaps }),
});
const metrics = new LaunchMetrics();
const basePublicClient = process.env.BASE_RPC_URL ? createBasePublicClient() : undefined;
const verifyingKeyPath = process.env.ZK_PREPAID_VERIFYING_KEY_PATH;
const V2_BOND_ABI = [
  { type: 'function', name: 'spendVerifier', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'deploymentDomain', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
] as const;
const V2_SPEND_VERIFIER_ABI = [
  { type: 'function', name: 'verifier', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

async function readV2Compatibility(): Promise<Record<string, unknown>> {
  const bondAddress = process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS?.trim() ?? '';
  const deploymentBlock = process.env.BASE_DEPLOYMENT_BLOCK?.trim() ?? '';
  const deploymentDomain = process.env.BASE_DEPLOYMENT_DOMAIN?.trim() || '84532';
  const circuitId = process.env.ZK_PREPAID_CIRCUIT_ID?.trim() || 'private-credit-spend-bn254-dev';
  const verifyingKeyId = process.env.ZK_PREPAID_VERIFYING_KEY_ID?.trim() || 'private-credit-spend-vk-dev';
  let verificationKeySha256: string | null = null;
  if (verifyingKeyPath) {
    try {
      verificationKeySha256 = createHash('sha256').update(await readFile(verifyingKeyPath)).digest('hex');
    } catch {
      verificationKeySha256 = null;
    }
  }

  let chainId: number | null = null;
  let bondSpendVerifierAddress: string | null = null;
  let groth16VerifierAddress: string | null = null;
  let onchainDeploymentDomain: string | null = null;
  let bytecodePresent = false;
  if (basePublicClient && /^0x[0-9a-fA-F]{40}$/u.test(bondAddress)) {
    try {
      chainId = await basePublicClient.getChainId();
      const bond = bondAddress as `0x${string}`;
      const [bondCode, spendVerifierValue, domainValue] = await Promise.all([
        basePublicClient.getBytecode({ address: bond }),
        basePublicClient.readContract({ address: bond, abi: V2_BOND_ABI, functionName: 'spendVerifier' }),
        basePublicClient.readContract({ address: bond, abi: V2_BOND_ABI, functionName: 'deploymentDomain' }),
      ]);
      bondSpendVerifierAddress = spendVerifierValue.toLowerCase();
      onchainDeploymentDomain = BigInt(domainValue).toString();
      if (/^0x[0-9a-fA-F]{40}$/u.test(bondSpendVerifierAddress)) {
        const spendVerifier = bondSpendVerifierAddress as `0x${string}`;
        const [spendCode, verifierValue] = await Promise.all([
          basePublicClient.getBytecode({ address: spendVerifier }),
          basePublicClient.readContract({ address: spendVerifier, abi: V2_SPEND_VERIFIER_ABI, functionName: 'verifier' }),
        ]);
        groth16VerifierAddress = verifierValue.toLowerCase();
        const verifierCode = /^0x[0-9a-fA-F]{40}$/u.test(groth16VerifierAddress)
          ? await basePublicClient.getBytecode({ address: groth16VerifierAddress as `0x${string}` })
          : undefined;
        bytecodePresent = Boolean(bondCode && bondCode !== '0x' && spendCode && spendCode !== '0x' && verifierCode && verifierCode !== '0x');
      }
    } catch {
      // Metadata stays incomplete; the trial gate rejects it without exposing RPC details.
    }
  }
  const status = chainId === 84532
    && /^\d+$/u.test(deploymentBlock)
    && deploymentDomain === '84532'
    && onchainDeploymentDomain === '84532'
    && Boolean(verificationKeySha256)
    && bytecodePresent
    && Boolean(bondSpendVerifierAddress)
    && Boolean(groth16VerifierAddress)
    ? 'pass'
    : 'failed';
  return {
    status,
    network: 'eip155:84532',
    chainId,
    circuitId,
    verifyingKeyId,
    verificationKeySha256,
    bondAddress: /^0x[0-9a-fA-F]{40}$/u.test(bondAddress) ? bondAddress.toLowerCase() : null,
    deploymentBlock: /^\d+$/u.test(deploymentBlock) ? deploymentBlock : null,
    deploymentDomain: /^\d+$/u.test(deploymentDomain) ? deploymentDomain : null,
    onchainDeploymentDomain,
    bondSpendVerifierAddress,
    groth16VerifierAddress,
    bytecodePresent,
  };
}

const claimStore = createClaimStore(pool);
const { app } = await createZkPrepaidGateway({
  claimStore,
  pilotInvites,
  pilotFunding,
  launchControl,
  metrics,
  claimCounts: claimStore instanceof PostgresClaimStore ? () => claimStore.stateCounts() : undefined,
  readiness: {
    database: pool
      ? async () => { await pool.query('SELECT 1'); }
      : undefined,
    baseHead: basePublicClient
      ? async () => await basePublicClient.getBlockNumber()
      : undefined,
    // Fails closed when no pinned verifying key is configured or readable.
    verifierAssets: verifyingKeyPath
      ? async () => { JSON.parse(await readFile(verifyingKeyPath, 'utf8')); }
      : undefined,
    v2Compatibility: readV2Compatibility,
  },
  rootSnapshot: () => baseEventSync
    ? baseEventSync.snapshot()
    : { currentRoot: initialBaseState.currentRoot, knownRoots: initialBaseState.knownRoots },
});
const server = createServer(app);
const claimLeaseTimer = setInterval(() => {
  void claimStore.expireReservations(Date.now() - 5 * 60 * 1000).catch(() => undefined);
}, 60 * 1000);
claimLeaseTimer.unref();
const baseSyncTimer = baseEventSync
  ? setInterval(() => {
      void (async () => {
        try {
          await baseEventSync?.syncOnce();
        } catch {
          console.error('Base event synchronization failed');
        }
      })().catch(() => {
        console.error('Base event synchronization failed');
      });
    }, Number(process.env.BASE_SYNC_INTERVAL_MS ?? 30_000))
  : undefined;
baseSyncTimer?.unref();

server.listen(port, '0.0.0.0', () => {
  console.log(`zk-prepaid gateway listening on ${port}`);
});

async function shutdown(signal: string): Promise<void> {
  clearInterval(claimLeaseTimer);
  if (baseSyncTimer) clearInterval(baseSyncTimer);
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
  void signal;
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
