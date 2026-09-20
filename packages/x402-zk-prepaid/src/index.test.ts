import { describe, expect, it } from 'vitest';
import { x402Client } from '@x402/core/client';
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer } from '@x402/core/server';
import {
  BASE_SEPOLIA_NETWORK,
  CODING_DEEPSEEK_V4_FLASH_V1,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PUBLIC_SIGNAL_INDEX,
  ZK_PREPAID_SCHEME,
  asOfficialX402SchemeClient,
  buildPaymentPayload,
  buildPaymentRequired,
  buildPaymentRequirements,
  createLocalZkPrepaidFacilitatorClient,
  createZkPrepaidClient,
  createZkPrepaidFacilitator,
  decodeHeader,
  encodeHeader,
  InMemoryClaimStore,
  registerZkPrepaidClient,
  registerZkPrepaidFacilitator,
  registerZkPrepaidResourceServer,
  validateZkPrepaidPayload,
} from './index.js';

const issuedAt = 1_700_000_000;
const requirements = buildPaymentRequirements({
  asset: CODING_DEEPSEEK_V4_FLASH_V1,
  contract: '0x00000000000000000000000000000000000000a1',
  deploymentDomain: '1234',
  issuedAt,
  payTo: '0x00000000000000000000000000000000000000b2',
  circuitId: 'private-credit-spend-bn254-v1',
  verifyingKeyId: 'dev-sepolia-v1',
});

function payment(nullifier = '5', signal = '987') {
  return buildPaymentPayload({
    requirements,
    proof: { pi_a: ['1', '2'] },
    publicSignals: ['1', String(issuedAt), '3', signal, nullifier, '6'],
    nonce: '0123456789abcdef',
    responseKey: 'response-key',
  });
}

describe('x402 zk-prepaid wire contract', () => {
  it('separates the fixed credit asset from the bond contract and requires issuedAt', () => {
    expect(requirements).toMatchObject({ scheme: ZK_PREPAID_SCHEME, network: BASE_SEPOLIA_NETWORK, amount: '1', asset: CODING_DEEPSEEK_V4_FLASH_V1 });
    expect(requirements.extra).toMatchObject({ contract: '0x00000000000000000000000000000000000000a1', issuedAt });
    expect(requirements.extra).not.toHaveProperty('signalIndex');
    expect(() => buildPaymentRequirements({ ...requirements.extra, asset: requirements.extra.contract, contract: requirements.extra.contract, payTo: requirements.payTo, deploymentDomain: requirements.extra.deploymentDomain, circuitId: requirements.extra.circuit, verifyingKeyId: requirements.extra.verifyingKey, issuedAt })).toThrow('asset is fixed');
  });

  it('round trips v2 headers and binds the timestamp signal to issuedAt', async () => {
    const required = buildPaymentRequired('https://api.test/v1/chat/completions', requirements);
    expect(decodeHeader(encodeHeader(required))).toEqual(required);
    await expect(validateZkPrepaidPayload(payment(), requirements, '987')).resolves.toEqual({ isValid: true });
    const staleTimestamp = payment();
    staleTimestamp.payload.publicSignals[PUBLIC_SIGNAL_INDEX.timestamp] = '2';
    await expect(validateZkPrepaidPayload(staleTimestamp, requirements, '987')).resolves.toMatchObject({ isValid: false, invalidReason: 'issued_at_mismatch' });
  });

  it('rejects identifying and unknown payload fields', async () => {
    const base = payment();
    await expect(validateZkPrepaidPayload({ ...base, payload: { ...base.payload, commitment: 'secret-link' } }, requirements, '987')).resolves.toMatchObject({ isValid: false, invalidReason: 'identifying_field' });
    await expect(validateZkPrepaidPayload({ ...base, payload: { ...base.payload, extra: true } }, requirements, '987')).resolves.toMatchObject({ isValid: false, invalidReason: 'invalid_payload_fields' });
    await expect(validateZkPrepaidPayload({ ...base, payload: { ...base.payload, phase: 'after-handler' } }, requirements, '987')).resolves.toMatchObject({ isValid: false, invalidReason: 'identifying_field' });
    await expect(validateZkPrepaidPayload({ ...base, unknown: true }, requirements, '987')).resolves.toMatchObject({ isValid: false, invalidReason: 'invalid_payload_fields' });
    await expect(validateZkPrepaidPayload({ ...base, payer: '0xabc' }, requirements, '987')).resolves.toMatchObject({ isValid: false, invalidReason: 'identifying_field' });
  });

  it('selects zk-prepaid from mixed accepts and caches by method, URL, and digest', async () => {
    const seen: Request[] = [];
    let calls = 0;
    const other = { ...requirements, scheme: 'other' } as unknown as typeof requirements;
    const now = () => issuedAt * 1000;
    const client = createZkPrepaidClient({
      now,
      fetch: async (input, init) => {
        seen.push(new Request(input, init)); calls += 1;
        if (calls === 1 || calls === 4) return new Response(null, { status: 402, headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader({ ...buildPaymentRequired('https://api.test/chat', requirements), accepts: [other, requirements] }) } });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { [PAYMENT_RESPONSE_HEADER]: encodeHeader({ success: true, transaction: '', network: requirements.network }) } });
      },
      createPayload: async ({ requirements: accepted }) => payment('5', '4'),
    });
    await expect(client.fetch('https://api.test/chat', { method: 'POST', body: '{}' })).resolves.toHaveProperty('status', 200);
    await expect(client.fetch('https://api.test/chat', { method: 'POST', body: '{}' })).resolves.toHaveProperty('status', 200);
    await expect(client.fetch('https://api.test/chat', { method: 'GET' })).resolves.toHaveProperty('status', 200);
    expect(calls).toBe(5);
    expect(seen[1]!.headers.get(PAYMENT_SIGNATURE_HEADER)).toBeTruthy();
    expect(seen[2]!.headers.get(PAYMENT_SIGNATURE_HEADER)).toBeTruthy();
    expect(seen[3]!.headers.get(PAYMENT_SIGNATURE_HEADER)).toBeNull();
  });

  it('invalidates stale challenges and never accepts a client timestamp override', async () => {
    let clock = issuedAt * 1000;
    let calls = 0;
    const replacement = buildPaymentRequirements({ ...requirements, asset: CODING_DEEPSEEK_V4_FLASH_V1, contract: requirements.extra.contract, payTo: requirements.payTo, deploymentDomain: requirements.extra.deploymentDomain, circuitId: requirements.extra.circuit, verifyingKeyId: requirements.extra.verifyingKey, issuedAt: issuedAt + 301 });
    const client = createZkPrepaidClient({
      now: () => clock,
      fetch: async (_input, init) => { calls += 1; if (calls === 1) return new Response(null, { status: 402, headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired('https://api.test/chat', requirements)) } }); if (calls === 3) return new Response(null, { status: 402, headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired('https://api.test/chat', replacement)) } }); return new Response(null, { status: 200 }); },
      createPayload: async ({ requirements: accepted }) => buildPaymentPayload({ requirements: accepted, proof: {}, publicSignals: ['1', String(accepted.extra.issuedAt), '3', '987', '5', '6'], nonce: '0123456789abcdef', responseKey: 'response-key' }),
    });
    await client.fetch('https://api.test/chat');
    clock += 301_000;
    await client.fetch('https://api.test/chat');
    expect(calls).toBe(4);
  });

  it('settles without payer and always uses an empty transaction', async () => {
    const facilitator = createZkPrepaidFacilitator();
    const settled = await facilitator.settle(payment(), requirements);
    expect(settled).toMatchObject({ success: true, transaction: '' });
    expect(settled).not.toHaveProperty('payer');
  });

  it('registers real core client, resource-server, and facilitator instances', async () => {
    const adapter = createZkPrepaidFacilitator();
    const facilitator = registerZkPrepaidFacilitator(new x402Facilitator(), adapter);
    expect(facilitator.getSupported().kinds).toContainEqual(expect.objectContaining({ x402Version: 2, scheme: ZK_PREPAID_SCHEME, network: BASE_SEPOLIA_NETWORK }));
    const client = registerZkPrepaidClient(new x402Client().setSpendControls(false), async ({ requirements: accepted }) => payment());
    await expect(client.createPaymentPayload({ x402Version: 2, resource: { url: 'https://api.test/chat' }, accepts: [requirements] })).resolves.toMatchObject({ x402Version: 2 });
    const server = registerZkPrepaidResourceServer(new x402ResourceServer(createLocalZkPrepaidFacilitatorClient(adapter)), requirements);
    await server.initialize();
    expect(server.hasRegisteredScheme(BASE_SEPOLIA_NETWORK, ZK_PREPAID_SCHEME)).toBe(true);
  });

  it('orchestrates escrow reserve before handler, commit after handler, and cancel on failure', async () => {
    const adapter = createZkPrepaidFacilitator();
    const server = registerZkPrepaidResourceServer(new x402ResourceServer(createLocalZkPrepaidFacilitatorClient(adapter)), requirements);
    await server.initialize();
    const first = payment('7', '700');
    const reserved = await server.settlePayment(first, requirements, {}, undefined, undefined, 'before-handler');
    expect(reserved).toMatchObject({ success: true, transaction: '' });
    const committed = await server.settlePayment(first, requirements, {}, undefined, undefined, 'after-handler');
    expect(committed).toMatchObject({ success: true, transaction: '' });
    await expect(adapter.claimStore.get('7')).resolves.toMatchObject({ state: 'committed' });
    const second = payment('8', '800');
    await server.settlePayment(second, requirements, {}, undefined, undefined, 'before-handler');
    const cancellation = server.createPaymentCancellationDispatcher(second, requirements, {}, undefined, ['before-handler']);
    await cancellation.cancel({ reason: 'handler_failed' });
    await expect(adapter.claimStore.get('8')).resolves.toMatchObject({ state: 'cancelled' });
  });
});
