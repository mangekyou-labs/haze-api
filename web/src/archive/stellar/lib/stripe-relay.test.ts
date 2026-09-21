import { describe, expect, it } from 'vitest';
import { buildGatewayBillingEvent } from './stripe-relay';

describe('Stripe billing relay payloads', () => {
  it('keeps launch-era checkout metadata on the existing billing contract', () => {
    const relay = buildGatewayBillingEvent({
      eventId: 'evt_launch',
      eventType: 'checkout.session.completed',
      payloadHash: 'sha256:launch',
      sessionId: 'cs_launch',
      amountTotal: 100,
      metadata: {
        tier: 'starter',
        commitment: '123456789',
        usdcAmount: '1000000',
        userId: 'github-user-1',
      },
    });

    expect(relay.body).toEqual({
      eventId: 'evt_launch',
      eventType: 'checkout.session.completed',
      payloadHash: 'sha256:launch',
      commitment: '123456789',
      amount: 1_000_000,
    });
    expect(relay.headers).toEqual({});
  });

  it('relays evaluation ownership and the exact one-dollar amount', () => {
    const participantId = 'a'.repeat(64);
    const relay = buildGatewayBillingEvent({
      eventId: 'evt_eval',
      eventType: 'checkout.session.completed',
      payloadHash: 'sha256:eval',
      sessionId: 'cs_eval',
      amountTotal: 100,
      metadata: {
        tier: 'evaluation',
        participantId,
        participantCode: 'L4-aaaaaaaaaaaa',
        commitment: '987654321',
        usdcAmount: '10000000',
        userId: 'must-not-be-forwarded',
      },
    });

    expect(relay.body).toEqual({
      eventId: 'evt_eval',
      eventType: 'checkout.session.completed',
      payloadHash: 'sha256:eval',
      participantId,
      checkoutSessionId: 'cs_eval',
      amountCents: 100,
      commitment: '987654321',
      amount: 10_000_000,
    });
    expect(relay.headers).toEqual({ 'x-evaluation-participant-id': participantId });
    expect(JSON.stringify(relay.body)).not.toContain('must-not-be-forwarded');
  });

  it('does not attach evaluation headers or fields to non-checkout events', () => {
    const relay = buildGatewayBillingEvent({
      eventId: 'evt_payment',
      eventType: 'payment_intent.succeeded',
      payloadHash: 'sha256:payment',
      metadata: {
        tier: 'evaluation',
        participantId: 'b'.repeat(64),
        commitment: '123',
        usdcAmount: '10000000',
      },
    });

    expect(relay.body).toEqual({
      eventId: 'evt_payment',
      eventType: 'payment_intent.succeeded',
      payloadHash: 'sha256:payment',
    });
    expect(relay.headers).toEqual({});
  });
});
