/**
 * Founder CLI for the invite-only unpaid pilot.
 *
 *   npm run invite:issue -- --github-id <id> [--days 7]
 *   npm run invite:inspect -- <inviteId>
 *   npm run invite:revoke -- <inviteId>
 *   npm run launch:status
 *   npm run launch:pause -- --reason <text>
 *   npm run launch:resume
 *   npm run activation:start -- --slot A --github-id <id>
 *   npm run activation:rehearse
 *   npm run activation:assist -- --slot A
 *   npm run activation:evidence -- --slot A --file <bundle.json>
 *   npm run activation:status
 *
 * The issue command prints the plaintext code exactly once. Only its SHA-256
 * digest is durable, so a lost code is replaced, never recovered.
 *
 * The activation commands never accept an operator secret or an operator env
 * path: the ownership boundary is enforced in `activation.ts`.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createPool, runMigrations } from './db/index.js';
import { PostgresInviteStore, PilotInviteService } from './pilot-invites.js';
import { PilotFundingService, PostgresFundingCapabilityStore } from './pilot-funding.js';
import { LaunchControl, PostgresLaunchControlStore } from './launch-control.js';
import { createBaseBondSponsor } from './base-chain.js';
import {
  PostgresActivationLedger,
  createActivationProbe,
  runActivationCommand,
  type ActivationDependencies,
} from './activation.js';

export interface PilotAdminDependencies {
  invites: PilotInviteService;
  launchControl: LaunchControl;
  /** Required only for the `activation-*` commands. */
  activation?: ActivationDependencies;
}

const USAGE = `usage:
  invite:issue -- --github-id <github account id> [--days <n>]
  invite:inspect -- <inviteId>
  invite:revoke -- <inviteId>
  launch:status
  launch:pause -- --reason <text>
  launch:resume
  activation:start -- --slot <A|B|C> --github-id <github account id>
  activation:rehearse
  activation:assist -- --slot <A|B|C>
  activation:evidence -- --slot <A|B|C> --file <redacted bundle path>
  activation:status`;

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value`);
  return value;
}

function requirePositional(args: readonly string[], label: string): string {
  const value = args.find((arg) => !arg.startsWith('--'));
  if (!value) throw new Error(`${label} is required`);
  return value;
}

/** Runs one founder command and returns the text to print. */
export async function runPilotAdmin(args: readonly string[], dependencies: PilotAdminDependencies): Promise<string> {
  const [command, ...rest] = args;

  if (command?.startsWith('activation-')) {
    if (!dependencies.activation) throw new Error('activation commands require a configured activation ledger and gateway');
    return runActivationCommand([command, ...rest], dependencies.activation);
  }

  if (command === 'issue-invite') {
    const githubAccountId = readFlag(rest, 'github-id');
    if (!githubAccountId) throw new Error('--github-id is required');
    const days = readFlag(rest, 'days');
    let ttlMs: number | undefined;
    if (days !== undefined) {
      const parsed = Number(days);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--days must be a positive integer');
      ttlMs = parsed * 24 * 60 * 60 * 1000;
    }
    const issued = await dependencies.invites.issue({ githubAccountId, ttlMs });
    return [
      `invite id: ${issued.inviteId}`,
      `github account: ${githubAccountId}`,
      `expires: ${new Date(issued.expiresAt).toISOString()}`,
      `code (shown once): ${issued.code}`,
    ].join('\n');
  }

  if (command === 'inspect-invite') {
    const inviteId = requirePositional(rest, 'invite id');
    const status = await dependencies.invites.inspect(inviteId);
    if (!status) return `invite ${inviteId} not found`;
    return [
      `invite id: ${status.inviteId}`,
      `github account: ${status.githubAccountId}`,
      `state: ${status.state}`,
      `created: ${new Date(status.createdAt).toISOString()}`,
      `expires: ${new Date(status.expiresAt).toISOString()}`,
      `redeemed: ${status.redeemedAt ? new Date(status.redeemedAt).toISOString() : 'no'}`,
      `revoked: ${status.revokedAt ? new Date(status.revokedAt).toISOString() : 'no'}`,
    ].join('\n');
  }

  if (command === 'revoke-invite') {
    const inviteId = requirePositional(rest, 'invite id');
    const revoked = await dependencies.invites.revoke(inviteId);
    return `invite ${inviteId} revoked: ${revoked}`;
  }

  if (command === 'launch-status') {
    const status = await dependencies.launchControl.status();
    const spend = await dependencies.launchControl.spend();
    return [
      `launch state: ${status.state}`,
      `reason: ${status.reason ?? 'none'}`,
      `updated: ${new Date(status.updatedAt).toISOString()}`,
      `spend today: ${spend.utcDayMicroUsd} micro-USD of ${spend.dailyCapMicroUsd}`,
      `spend 30d: ${spend.rolling30dMicroUsd} micro-USD of ${spend.rollingCapMicroUsd}`,
      `debits: held ${spend.debits.held}, retained ${spend.debits.retained}, released ${spend.debits.released}`,
    ].join('\n');
  }

  if (command === 'launch-pause') {
    const reason = readFlag(rest, 'reason');
    if (!reason) throw new Error('--reason is required');
    const status = await dependencies.launchControl.pause(reason);
    return `launch paused: ${status.reason} at ${new Date(status.updatedAt).toISOString()}`;
  }

  if (command === 'launch-resume') {
    const status = await dependencies.launchControl.resume();
    return `launch state: ${status.state} at ${new Date(status.updatedAt).toISOString()}`;
  }

  throw new Error(`unknown command\n${USAGE}`);
}

function capabilityIssuerFor(pool: Pool) {
  const contractAddress = process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/u.test(contractAddress)) {
    return { async issue(): Promise<{ fundingToken: string; expiresAt: number }> { throw new Error('funding_not_configured'); } };
  }
  const funding = new PilotFundingService({
    store: new PostgresFundingCapabilityStore(pool),
    contractAddress,
    deploymentDomain: process.env.BASE_DEPLOYMENT_DOMAIN ?? '84532',
    sponsor: {
      async fundCommitment(commitment: string) {
        const sponsored = await createBaseBondSponsor().fundBundle(commitment, 0);
        return { transactionHash: sponsored.transaction, expiryAt: sponsored.expiryAt };
      },
    },
  });
  return { issue: () => funding.issueCapability() };
}

async function main(): Promise<void> {
  const pool = createPool();
  try {
    await runMigrations(pool, fileURLToPath(new URL('./db/migrations/', import.meta.url)));
    const invites = new PilotInviteService({
      store: new PostgresInviteStore(pool),
      capabilities: capabilityIssuerFor(pool),
    });
    const launchControl = new LaunchControl({ store: new PostgresLaunchControlStore(pool) });
    console.log(await runPilotAdmin(process.argv.slice(2), {
      invites,
      launchControl,
      activation: {
        ledger: new PostgresActivationLedger(pool),
        probe: createActivationProbe({
          gatewayUrl: process.env.PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3001',
          adminToken: process.env.BILLING_INTERNAL_TOKEN ?? '',
        }),
        issueInvite: (githubAccountId) => invites.issue({ githubAccountId }),
        revokeInvite: (inviteId) => invites.revoke(inviteId),
      },
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'pilot admin failed');
    process.exitCode = 1;
  });
}
