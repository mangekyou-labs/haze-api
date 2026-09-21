/** Active Base / x402 gateway entry point. Historical Stellar runtime lives in
 * ts/archive/stellar and is excluded from the active build. The unpaid pilot
 * runtime has no Stripe checkout, order, refund, dispute, or wallet-link path. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import { createBaseBondSponsor } from './base-chain.js';
import { createPool, runMigrations } from './db/index.js';
import { PostgresClaimStore, createClaimStore } from './claim-store.js';
import {
  BaseContractEventSynchronizer,
  MemoryBaseEventStore,
  PostgresBaseEventStore,
} from './base-event-sync.js';
import { createBasePublicClient } from './base-chain.js';
import { PostgresInviteStore, PilotInviteService } from './pilot-invites.js';
import { PilotFundingService, PostgresFundingCapabilityStore } from './pilot-funding.js';
import { LaunchControl, PostgresLaunchControlStore, MemoryLaunchControlStore } from './launch-control.js';
import { LaunchMetrics } from './metrics.js';
import type { Pool } from 'pg';

const port = Number(process.env.PORT ?? 3000);
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
const initialBaseState = {
  contractAddress: baseContractAddress ?? '',
  currentRoot: process.env.BASE_CURRENT_ROOT,
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
  });
  try {
    await baseEventSync.syncOnce();
  } catch (error) {
    // A temporary RPC outage must not take down the API. The last durable
    // snapshot (or explicit environment roots) remains the fail-closed source
    // until the next sync attempt.
    console.error('Base event synchronization failed:', error instanceof Error ? error.message : 'unknown');
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
          const sponsored = await createBaseBondSponsor().fundBundle(commitment, 0);
          return { transactionHash: sponsored.transaction, expiryAt: sponsored.expiryAt };
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
const launchControl = new LaunchControl({
  store: pool ? new PostgresLaunchControlStore(pool) : new MemoryLaunchControlStore(),
});
const metrics = new LaunchMetrics();
const basePublicClient = process.env.BASE_RPC_URL ? createBasePublicClient() : undefined;
const verifyingKeyPath = process.env.ZK_PREPAID_VERIFYING_KEY_PATH;

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
        } catch (error: unknown) {
          console.error('Base event synchronization failed:', error instanceof Error ? error.message : 'unknown');
        }
      })().catch((error: unknown) => {
        console.error('Base event synchronization failed:', error instanceof Error ? error.message : 'unknown');
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
