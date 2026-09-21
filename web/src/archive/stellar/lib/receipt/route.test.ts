import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  gateway: vi.fn(),
  retrieve: vi.fn(),
  Stripe: vi.fn(),
}));

vi.mock('@/lib/evaluation-api', () => ({
  EvaluationApiError: class EvaluationApiError extends Error {
    constructor(readonly code: string, readonly status: number) {
      super(code);
    }
  },
  getEvaluationIdentity: mocks.identity,
  evaluationGatewayRequest: mocks.gateway,
}));
vi.mock('stripe', () => ({ default: mocks.Stripe }));

import { NextRequest } from 'next/server';
import { GET } from './route';

describe('evaluation checkout receipt route', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_receipt';
    mocks.identity.mockResolvedValue({
      fullId: 'a'.repeat(64),
      publicCode: 'L4-aaaaaaaaaaaa',
    });
    mocks.retrieve.mockResolvedValue({
      id: 'cs_test',
      metadata: {
        tier: 'evaluation',
        participantId: 'a'.repeat(64),
      },
    });
    mocks.Stripe.mockImplementation(function () {
      return { checkout: { sessions: { retrieve: mocks.retrieve } } };
    });
    mocks.gateway.mockResolvedValue(new Response(JSON.stringify({
      checkoutSessionId: 'cs_test',
      processingStatus: 'pending',
      transactionHash: null,
    }), { status: 200 }));
  });

  afterEach(() => vi.clearAllMocks());

  it('checks Stripe metadata ownership before reading the gateway receipt', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/checkout/receipt?session_id=cs_test',
    ));

    expect(response.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith('cs_test');
    expect(mocks.gateway).toHaveBeenCalledWith(
      '/v1/evaluation/checkout?sessionId=cs_test',
      'GET',
    );
  });

  it('does not reveal another participant receipt', async () => {
    mocks.retrieve.mockResolvedValueOnce({
      id: 'cs_other',
      metadata: { tier: 'evaluation', participantId: 'b'.repeat(64) },
    });

    const response = await GET(new NextRequest(
      'http://localhost/api/checkout/receipt?session_id=cs_other',
    ));

    expect(response.status).toBe(404);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
});
