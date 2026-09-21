import { describe, expect, it } from 'vitest';
import {
  BASE_SEPOLIA_NETWORK,
  CODING_DEEPSEEK_V4_FLASH_V1,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  ZK_PREPAID_LIFECYCLE_FAILURES,
  ZK_PREPAID_LIFECYCLE_STAGES,
  buildPaymentPayload,
  buildPaymentRequired,
  buildPaymentRequirements,
  createZkPrepaidClient,
  createZkPrepaidLifecycleMetrics,
  encodeHeader,
  type PaymentRequirements,
  type ZkPrepaidLifecycleEvent,
} from './index.js';

const issuedAt = 1_700_000_000;
const now = () => issuedAt * 1000;

function requirementsAt(issuedAtSeconds = issuedAt): PaymentRequirements {
  return buildPaymentRequirements({
    contract: '0x00000000000000000000000000000000000000a1',
    deploymentDomain: '1234',
    issuedAt: issuedAtSeconds,
    payTo: '0x00000000000000000000000000000000000000b2',
    circuitId: 'private-credit-spend-bn254-v1',
    verifyingKeyId: 'dev-sepolia-v1',
  });
}

const requirements = requirementsAt();

function payloadFor(accepted: PaymentRequirements) {
  return buildPaymentPayload({
    requirements: accepted,
    proof: { pi_a: ['1', '2'] },
    publicSignals: ['1', String(accepted.extra.issuedAt), '3', '987', '5', '6'],
    nonce: '0123456789abcdef',
    responseKey: 'response-key',
  });
}

function challenge(accepted: PaymentRequirements = requirements): Response {
  return new Response(null, {
    status: 402,
    headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired('https://api.test/chat', accepted)) },
  });
}

function paid(accepted: PaymentRequirements = requirements): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      [PAYMENT_RESPONSE_HEADER]: encodeHeader({ success: true, transaction: '', network: BASE_SEPOLIA_NETWORK }),
    },
  });
}

/** Drives one client exchange and returns the captured lifecycle events. */
async function observe(fetcher: typeof fetch, createPayload: Parameters<typeof createZkPrepaidClient>[0]['createPayload'] = async ({ requirements: accepted }) => payloadFor(accepted)) {
  const events: ZkPrepaidLifecycleEvent[] = [];
  const client = createZkPrepaidClient({ fetch: fetcher, now, createPayload, lifecycle: (event) => { events.push(event); } });
  return { events, client };
}

const initiated = { method: 'POST', body: '{}' } as const;

describe('x402 zk-prepaid client lifecycle', () => {
  it('emits the full lifecycle in order for one settled exchange', async () => {
    let calls = 0;
    const { events, client } = await observe(async () => {
      calls += 1;
      return calls === 1 ? challenge() : paid();
    });

    await expect(client.fetch('https://api.test/chat', { ...initiated })).resolves.toHaveProperty('status', 200);

    expect(events).toEqual([
      { type: 'stage', stage: 'challenge_received' },
      { type: 'stage', stage: 'payment_prepared' },
      { type: 'stage', stage: 'settlement_confirmed' },
      { type: 'stage', stage: 'exchange_succeeded' },
    ]);
  });

  it('reuses cached requirements without claiming a second challenge', async () => {
    let calls = 0;
    const { events, client } = await observe(async () => {
      calls += 1;
      return calls === 1 ? challenge() : paid();
    });

    await client.fetch('https://api.test/chat', { ...initiated });
    await client.fetch('https://api.test/chat', { ...initiated });

    expect(events.filter((event) => event.type === 'stage' && event.stage === 'challenge_received')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'stage' && event.stage === 'payment_prepared')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'stage' && event.stage === 'settlement_confirmed')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'stage' && event.stage === 'exchange_succeeded')).toHaveLength(2);
  });

  it('reports a missing challenge header and a missing payment header by fixed category', async () => {
    const bare = await observe(async () => new Response(null, { status: 402 }));
    await expect(bare.client.fetch('https://api.test/chat', { ...initiated })).resolves.toHaveProperty('status', 402);
    expect(bare.events).toEqual([{ type: 'failure', failure: 'challenge_unsupported' }]);

    const malformed = await observe(async () => new Response(null, { status: 402, headers: { [PAYMENT_REQUIRED_HEADER]: 'not-base64!' } }));
    await expect(malformed.client.fetch('https://api.test/chat', { ...initiated })).rejects.toThrow('Invalid x402 Base64 JSON header');
    expect(malformed.events).toEqual([{ type: 'failure', failure: 'challenge_unreadable' }]);
  });

  it('never emits a stage for an unpaid transport, provider, or preparation failure', async () => {
    const providerFailure = await observe(async () => new Response('upstream unavailable', { status: 503 }));
    await expect(providerFailure.client.fetch('https://api.test/chat', { ...initiated })).resolves.toHaveProperty('status', 503);
    expect(providerFailure.events).toEqual([]);

    const transport = await observe(async () => { throw new Error('socket closed'); });
    await expect(transport.client.fetch('https://api.test/chat', { ...initiated })).rejects.toThrow('socket closed');
    expect(transport.events).toEqual([{ type: 'failure', failure: 'transport_failed' }]);

    let calls = 0;
    const preparation = await observe(
      async () => { calls += 1; return calls === 1 ? challenge() : paid(); },
      async () => { throw new Error('prover unavailable'); },
    );
    await expect(preparation.client.fetch('https://api.test/chat', { ...initiated })).rejects.toThrow('prover unavailable');
    expect(preparation.events).toEqual([
      { type: 'stage', stage: 'challenge_received' },
      { type: 'failure', failure: 'payment_preparation_failed' },
    ]);
  });

  it('separates a rejected payment from a settlement that never confirms', async () => {
    let calls = 0;
    const rejected = await observe(async () => {
      calls += 1;
      return calls === 1 ? challenge() : new Response(null, { status: 402 });
    });
    await expect(rejected.client.fetch('https://api.test/chat', { ...initiated })).resolves.toHaveProperty('status', 402);
    expect(rejected.events).toEqual([
      { type: 'stage', stage: 'challenge_received' },
      { type: 'stage', stage: 'payment_prepared' },
      { type: 'failure', failure: 'payment_rejected' },
    ]);

    // A paid response without PAYMENT-RESPONSE is an unconfirmed settlement.
    let settledCalls = 0;
    const unconfirmed = await observe(async () => {
      settledCalls += 1;
      return settledCalls === 1 ? challenge() : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await expect(unconfirmed.client.fetch('https://api.test/chat', { ...initiated })).resolves.toHaveProperty('status', 200);
    expect(unconfirmed.events).toEqual([
      { type: 'stage', stage: 'challenge_received' },
      { type: 'stage', stage: 'payment_prepared' },
      { type: 'failure', failure: 'settlement_failed' },
      { type: 'stage', stage: 'exchange_succeeded' },
    ]);
  });

  it('rejects a stale challenge without preparing a payment', async () => {
    const stale = requirementsAt(issuedAt - 400);
    const { events, client } = await observe(async () => challenge(stale));
    await expect(client.fetch('https://api.test/chat', { ...initiated })).resolves.toHaveProperty('status', 402);
    expect(events).toEqual([{ type: 'failure', failure: 'challenge_stale' }]);
    expect(events).not.toContainEqual({ type: 'stage', stage: 'payment_prepared' });
  });

  it('survives an observer that throws', async () => {
    let calls = 0;
    const client = createZkPrepaidClient({
      fetch: async () => { calls += 1; return calls === 1 ? challenge() : paid(); },
      now,
      createPayload: async ({ requirements: accepted }) => payloadFor(accepted),
      lifecycle: () => { throw new Error('observer exploded'); },
    });
    await expect(client.fetch('https://api.test/chat', { ...initiated })).resolves.toHaveProperty('status', 200);
    expect(calls).toBe(2);
  });

  it('counts every exchange transition in the aggregate metrics helper', async () => {
    const metrics = createZkPrepaidLifecycleMetrics({ now: () => 1_700_000_500_000 });
    let calls = 0;
    const client = createZkPrepaidClient({
      fetch: async () => { calls += 1; return calls === 1 ? challenge() : paid(); },
      now,
      createPayload: async ({ requirements: accepted }) => payloadFor(accepted),
      lifecycle: metrics.observe,
    });

    await client.fetch('https://api.test/chat', { ...initiated });
    await client.fetch('https://api.test/chat', { ...initiated });

    expect(metrics.snapshot()).toMatchObject({
      challengesReceived: 1,
      paymentsPrepared: 2,
      settlementsConfirmed: 2,
      exchangeSuccesses: 2,
      failures: 0,
      updatedAt: new Date(1_700_000_500_000).toISOString(),
    });
    expect(metrics.snapshot().failuresByCategory).toEqual({
      challenge_unreadable: 0,
      challenge_unsupported: 0,
      challenge_stale: 0,
      payment_preparation_failed: 0,
      payment_rejected: 0,
      settlement_failed: 0,
      transport_failed: 0,
    });
  });

  it('keeps the aggregate snapshot free of every seeded identifying value', () => {
    const metrics = createZkPrepaidLifecycleMetrics({ now: () => 1_700_000_500_000 });
    const forbidden = [
      'sk-or-v1-seeded-provider-key',
      'seed-prompt-content',
      'seed-response-content',
      'seed-nullifier-991',
      'seed-public-signal-992',
      'seed-invite-token-993',
      'seed-credential-id-994',
      'seed-proof-pi-a-995',
      'seedGithubLogin',
      '0xSeedCredentialCommitment996',
      'https://gateway.example/seed-url-997',
    ];

    // Every fixed event the client can emit, seeded with values that must not
    // be representable anywhere in the aggregate snapshot.
    for (const stage of ZK_PREPAID_LIFECYCLE_STAGES) metrics.observe({ type: 'stage', stage });
    for (const failure of ZK_PREPAID_LIFECYCLE_FAILURES) metrics.observe({ type: 'failure', failure });

    const serialized = JSON.stringify(metrics.snapshot());
    for (const value of forbidden) expect(serialized).not.toContain(value);
    expect(serialized).not.toMatch(/\d{10,}/u);
    expect(Object.keys(metrics.snapshot()).sort()).toEqual([
      'challengesReceived',
      'exchangeSuccesses',
      'failures',
      'failuresByCategory',
      'paymentsPrepared',
      'settlementsConfirmed',
      'updatedAt',
    ]);
  });

  it('stamps a payment signature on the retried request and none on the first', async () => {
    const presented: (string | null)[] = [];
    let calls = 0;
    const client = createZkPrepaidClient({
      fetch: async (_input, init) => {
        presented.push(new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER));
        calls += 1;
        return calls === 1 ? challenge() : paid();
      },
      now,
      createPayload: async ({ requirements: accepted }) => payloadFor(accepted),
    });

    await client.fetch('https://api.test/chat', { ...initiated });
    expect(presented[0]).toBeNull();
    expect(presented[1]).toBeTruthy();
  });
});
