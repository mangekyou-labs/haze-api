export interface StripeRelayInput {
  eventId: string;
  eventType: string;
  payloadHash: string;
  sessionId?: string;
  amountTotal?: number | null;
  metadata: Record<string, string | undefined>;
}

export interface StripeRelayPayload {
  body: Record<string, string | number>;
  headers: Record<string, string>;
}

const PARTICIPANT_ID_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Build the small, authenticated payload accepted by the gateway billing
 * adapter. Stripe metadata is intentionally filtered here: user IDs and
 * arbitrary metadata never cross the web-to-gateway boundary.
 */
export function buildGatewayBillingEvent(input: StripeRelayInput): StripeRelayPayload {
  const body: Record<string, string | number> = {
    eventId: input.eventId,
    eventType: input.eventType,
    payloadHash: input.payloadHash,
  };
  const headers: Record<string, string> = {};

  if (input.eventType !== 'checkout.session.completed') {
    return { body, headers };
  }

  const { metadata } = input;
  const isEvaluation = metadata.tier === 'evaluation'
    || typeof metadata.participantId === 'string';

  if (isEvaluation) {
    if (metadata.participantId) body.participantId = metadata.participantId;
    if (input.sessionId) body.checkoutSessionId = input.sessionId;
    if (typeof input.amountTotal === 'number' && Number.isInteger(input.amountTotal)) {
      body.amountCents = input.amountTotal;
    }
    if (metadata.commitment) body.commitment = metadata.commitment;
    if (metadata.usdcAmount) {
      const amount = Number(metadata.usdcAmount);
      if (Number.isSafeInteger(amount) && amount > 0) body.amount = amount;
    }
    if (metadata.participantId && PARTICIPANT_ID_PATTERN.test(metadata.participantId)) {
      headers['x-evaluation-participant-id'] = metadata.participantId;
    }
    return { body, headers };
  }

  if (metadata.commitment && metadata.usdcAmount) {
    const amount = Number(metadata.usdcAmount);
    if (Number.isSafeInteger(amount) && amount > 0) {
      body.commitment = metadata.commitment;
      body.amount = amount;
    }
  }

  return { body, headers };
}
