/**
 * Privacy scans: a canary prompt and response, a nullifier, and a request
 * signal must never reach a log line or a control/monitoring table. The spend
 * plane keeps its opaque claim row and the encrypted replay envelope only.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import {
  buildPaymentPayload,
  encodeHeader,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
  type PaymentRequirements,
} from '@zk-credits/x402-zk-prepaid';
import { deriveRequestSignal } from '@zk-credits/shared';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import type { ProviderAdapter } from './providerAdapter.js';
import { runMigrations } from './db/migrate.js';
import { LaunchControl, MemoryLaunchControlStore, PostgresLaunchControlStore } from './launch-control.js';
import { MAX_DISPATCH_COST_MICRO_USD } from './service-class.js';

const NOW = 1_800_000_000_000;
const CANARY_PROMPT = `CANARY-PROMPT-${randomUUID()}`;
const CANARY_RESPONSE = `CANARY-RESPONSE-${randomUUID()}`;
const NULLIFIER = `173458951234567890${randomUUID().replace(/\D/gu, '').padEnd(10, '7')}`;
const BODY = { model: 'ignored', messages: [{ role: 'user', content: CANARY_PROMPT }] };

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const responseKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const echoes: ProviderAdapter = {
  id: 'echo',
  async forwardRequest() {
    return new Response(
      JSON.stringify({ object: 'chat.completion', choices: [{ message: { role: 'assistant', content: CANARY_RESPONSE } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  },
};

async function paymentFor(gateway: { requirements: PaymentRequirements }): Promise<PaymentPayload> {
  const nonce = '0123456789abcdef';
  const signal = (await deriveRequestSignal({
    method: 'POST',
    url: 'http://test.local/v1/chat/completions',
    body: new TextEncoder().encode(JSON.stringify(BODY)),
    requirements: gateway.requirements,
    nonce,
    responseKey,
  })).field;
  return buildPaymentPayload({
    requirements: gateway.requirements,
    proof: {},
    publicSignals: ['1', String(gateway.requirements.extra.issuedAt), '3', signal, NULLIFIER, '5'],
    nonce,
    responseKey,
  });
}

const captured: string[] = [];
const restores: Array<() => void> = [];

/** Swallows console output so a canary scan can inspect exactly what was emitted. */
function captureConsole(): void {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console);
    console[level] = ((...args: unknown[]) => {
      captured.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg) ?? '')).join(' '));
    }) as typeof console[typeof level];
    restores.push(() => { console[level] = original; });
  }
}

afterEach(() => {
  while (restores.length > 0) restores.pop()!();
  captured.length = 0;
});

describe('log and response scans', () => {
  it('never logs a prompt, response, nullifier, signal, or replay envelope', async () => {
    const store = new MemoryLaunchControlStore();
    const gateway = await createZkPrepaidGateway({
      now: () => NOW,
      provider: echoes,
      launchControl: new LaunchControl({ store, now: () => NOW }),
      config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
      verifyProof: async () => ({ isValid: true as const }),
      allowUnverifiedProofs: true,
    });
    const payment = await paymentFor(gateway);

    captureConsole();
    const response = await request(gateway.app)
      .post('/v1/chat/completions')
      .set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment))
      .send(BODY);

    expect(response.status).toBe(200);
    // The caller receives its own response; the gateway itself logs none of it.
    expect(response.text).toContain(CANARY_RESPONSE);
    const logText = captured.join('\n');
    for (const secret of [CANARY_PROMPT, CANARY_RESPONSE, NULLIFIER, payment.payload.publicSignals[3]!, responseKey]) {
      expect(logText).not.toContain(secret);
    }

    // The durable claim row keeps the opaque claim state and the encrypted
    // envelope only: no plaintext prompt or response.
    const record = await gateway.claimStore.lookup(NULLIFIER, undefined);
    expect(record).toMatchObject({ state: 'committed' });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(CANARY_PROMPT);
    expect(serialized).not.toContain(CANARY_RESPONSE);
    expect(serialized).toContain('RSA-OAEP-256/AES-256-GCM');
  });

  it('never logs a rejected prompt for an unsupported request', async () => {
    const gateway = await createZkPrepaidGateway({
      now: () => NOW,
      provider: echoes,
      launchControl: new LaunchControl({ store: new MemoryLaunchControlStore(), now: () => NOW }),
      config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
      verifyProof: async () => ({ isValid: true as const }),
      allowUnverifiedProofs: true,
    });

    captureConsole();
    const response = await request(gateway.app)
      .post('/v1/chat/completions')
      .send({ stream: true, messages: [{ role: 'user', content: CANARY_PROMPT }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('streaming_not_supported');
    expect(captured.join('\n')).not.toContain(CANARY_PROMPT);
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('database scan (integration)', () => {
  const databaseUrl = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
  const migrationsDir = resolve(import.meta.dirname, 'db/migrations');

  it('holds no prompt, response, nullifier, or signal in the control and monitoring tables', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const lockClient = await pool.connect();
    try {
      await lockClient.query('SELECT pg_advisory_lock($1)', [8_402_062_006]);
      await runMigrations(pool, migrationsDir);
      await pool.query('TRUNCATE spend_plane.dispatch_debits');
      await pool.query(`UPDATE control_plane.launch_control SET state = 'enabled', reason = NULL`);

      const store = new PostgresLaunchControlStore(pool);
      const debit = await store.debit(MAX_DISPATCH_COST_MICRO_USD, NOW);
      if (debit.kind !== 'debited') throw new Error('expected a debit');
      await store.retain(debit.debitId, NOW);
      await store.pause('operator review', NOW);

      // Every control and monitoring table is a closed schema of bounded
      // values, so a whole-row scan cannot contain canary material.
      const tables = ['control_plane.launch_control', 'spend_plane.dispatch_debits'];
      for (const table of tables) {
        const rows = await pool.query(`SELECT * FROM ${table}`);
        const serialized = JSON.stringify(rows.rows);
        for (const secret of [CANARY_PROMPT, CANARY_RESPONSE, NULLIFIER]) {
          expect(serialized).not.toContain(secret);
        }
        expect(serialized).not.toMatch(/prompt|content|message|proof|commitment|github|account/iu);
      }
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [8_402_062_006]);
      lockClient.release();
      await pool.end();
    }
  });
});
