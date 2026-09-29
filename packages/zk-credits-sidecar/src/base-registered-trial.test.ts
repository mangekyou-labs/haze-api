import { describe, expect, it } from 'vitest';
import {
  buildPaymentRequired,
  buildPaymentRequirements,
  createZkPrepaidLifecycleMetrics,
  decodeHeader,
  encodeHeader,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  validateZkPrepaidPayload,
  type PaymentPayload,
  type PaymentRequirements,
} from '@zk-credits/x402-zk-prepaid';
import { createCredential, deriveRequestSignal, generateSecret } from '@zk-credits/shared/base';
import { BaseSlotLedger } from './slot-ledger.js';
import { normalizeServiceClassRequest } from '../../../ts/service-class.js';
import { buildBaseRegisteredTrialRequestBody, runBaseRegisteredTrialExchange } from './base-registered-trial.js';

const target = 'https://api.test/v1/chat/completions';
const body = buildBaseRegisteredTrialRequestBody();
const witnessProvider = {
  witnessForCredential: async () => ({
    root: '123',
    pathElements: Array.from({ length: 20 }, () => '0'),
    pathIndices: Array.from({ length: 20 }, () => 0),
    expiry: 1_800_000_000,
  }),
};

function requirements(): PaymentRequirements {
  return buildPaymentRequirements({
    payTo: '0x00000000000000000000000000000000000000b2',
    contract: '0x00000000000000000000000000000000000000a1',
    deploymentDomain: '84532',
    circuitId: 'private-credit-spend-bn254-v1',
    verifyingKeyId: 'dev-sepolia-v1',
    issuedAt: Math.floor(Date.now() / 1000),
  });
}

async function credential() {
  return createCredential(generateSecret(), 0, Math.floor(Date.now() / 1000) + 3600, '84532');
}

describe('Base direct registered-adapter trial harness', () => {
  it('sends a request the gateway accepts before issuing its 402 challenge', () => {
    expect(normalizeServiceClassRequest(JSON.parse(body))).toMatchObject({ ok: true });
  });

  it('builds a bounded custom task body for the founder demo agent', () => {
    expect(JSON.parse(buildBaseRegisteredTrialRequestBody('Summarize this example locally.'))).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Summarize this example locally.' }],
    });
    expect(() => buildBaseRegisteredTrialRequestBody('   ')).toThrow(/between 1 and 4000/u);
    expect(() => buildBaseRegisteredTrialRequestBody('x'.repeat(4_001))).toThrow(/between 1 and 4000/u);
  });

  it('binds the HTTP request in the local proof factory and completes the official adapter handshake', async () => {
    const ledger = await BaseSlotLedger.open({});
    const accepted = requirements();
    const metrics = createZkPrepaidLifecycleMetrics();
    let calls = 0;
    let signatureHeader = '';
    let displayedResponse = '';
    let mockFailure: string | undefined;
    const result = await runBaseRegisteredTrialExchange({
      url: target,
      body,
      headers: { 'content-type': 'application/json' },
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      lifecycle: metrics.observe,
      onResponse: async (response) => { displayedResponse = await response.text(); },
      prove: async (_input, context) => ({ proof: { pi_a: ['1'], pi_b: [['1']], pi_c: ['1'] }, publicSignals: [...context.expectedPublicSignals] }),
      fetch: async (input, init) => {
        calls += 1;
        expect(String(input)).toBe(target);
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(body);
        expect(init?.redirect).toBe('error');
        if (calls === 1) {
          return new Response(null, {
            status: 402,
            headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired(target, accepted)) },
          });
        }
        try {
          signatureHeader = new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER) ?? '';
          const payment = decodeHeader<PaymentPayload>(signatureHeader);
          const signal = await deriveRequestSignal({
            method: 'POST',
            url: target,
            body: new TextEncoder().encode(body),
            requirements: accepted,
            nonce: payment.payload.nonce,
            responseKey: payment.payload.responseKey,
          });
          expect((await validateZkPrepaidPayload(payment, accepted, signal.field)).isValid).toBe(true);
        } catch (error) {
          mockFailure = error instanceof Error ? error.message : 'unknown';
          throw error;
        }
        return new Response('{"ok":true}', {
          status: 200,
          headers: { [PAYMENT_RESPONSE_HEADER]: encodeHeader({ success: true, transaction: '', network: accepted.network }) },
        });
      },
    });

    expect(calls).toBe(2);
    expect(mockFailure).toBeUndefined();
    expect(signatureHeader).not.toBe('');
    expect(result.failurePhase).toBeUndefined();
    expect(result).toMatchObject({
      challengeStatus: 402,
      challengeReceived: true,
      proofPrepared: true,
      paymentSignatureSent: true,
      paymentStatus: 200,
      paymentResponseConfirmed: true,
      responseStatus: 200,
      responseSucceeded: true,
      committedSlotDelta: 1,
    });
    expect(result.failurePhase).toBeUndefined();
    expect(ledger.committedSlots()).toHaveLength(1);
    expect(displayedResponse).toBe('{"ok":true}');
    expect(metrics.snapshot()).toMatchObject({
      challengesReceived: 1,
      paymentsPrepared: 1,
      settlementsConfirmed: 1,
      exchangeSuccesses: 1,
      failures: 0,
    });
  });

  it('stops at settlement when the paid response omits PAYMENT-RESPONSE', async () => {
    const ledger = await BaseSlotLedger.open({});
    const accepted = requirements();
    let calls = 0;
    const result = await runBaseRegisteredTrialExchange({
      url: target,
      body,
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      prove: async (_input, context) => ({ proof: { pi_a: ['1'], pi_b: [['1']], pi_c: ['1'] }, publicSignals: [...context.expectedPublicSignals] }),
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(null, {
            status: 402,
            headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired(target, accepted)) },
          });
        }
        return new Response('{"ok":true}', { status: 200 });
      },
    });

    expect(result).toMatchObject({
      challengeReceived: true,
      proofPrepared: true,
      paymentSignatureSent: true,
      paymentStatus: 200,
      paymentResponseConfirmed: false,
      responseSucceeded: false,
      committedSlotDelta: 1,
      failurePhase: 'payment_response_missing',
    });
    expect(ledger.committedSlots()).toHaveLength(1);
  });

  it('rejects query-bearing targets before making a request or allocating a slot', async () => {
    const ledger = await BaseSlotLedger.open({});
    let fetchCalls = 0;
    const result = await runBaseRegisteredTrialExchange({
      url: `${target}?redirect=https://elsewhere.test`,
      body,
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      prove: async () => { throw new Error('should not prove'); },
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 500 });
      },
    });

    expect(result.failurePhase).toBe('challenge_request_mismatch');
    expect(fetchCalls).toBe(0);
    expect(ledger.snapshot()).toMatchObject({ committed: 0, provisional: 0 });
  });
});
