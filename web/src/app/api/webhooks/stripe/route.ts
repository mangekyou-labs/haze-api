import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith('sk_test_')) return null;
  return new Stripe(key);
}

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';
const GATEWAY_TIMEOUT_MS = 90_000;

async function gatewayRequest(
  path: string,
  participantId: string | undefined,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  if (!GATEWAY_SECRET) throw new Error('gateway_not_configured');
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GATEWAY_SECRET}`,
      ...(participantId ? { 'x-evaluation-participant-id': participantId } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({ error: 'gateway_invalid_response' }));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'gateway_request_failed');
  return payload as Record<string, unknown>;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string): Promise<void> {
  const metadata = session.metadata ?? {};
  const { tier, usdcAmount, commitment, participantId } = metadata;
  if (!usdcAmount || !commitment) throw new Error('checkout_missing_deposit_metadata');
  if (participantId && !/^[a-f0-9]{64}$/.test(participantId)) throw new Error('checkout_invalid_participant');

  const amount = Number(usdcAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('checkout_invalid_amount');

  let checkout: Record<string, unknown> | undefined;
  if (participantId) {
    checkout = await gatewayRequest('/v1/evaluation/checkout', participantId, {
      checkoutSessionId: session.id,
      amountCents: session.amount_total ?? 0,
      eventId,
    });
    if (checkout.processingStatus === 'confirmed' && checkout.transactionHash) return;
  }

  const deposit = await gatewayRequest(
    '/v1/deposits',
    undefined,
    {
      commitment,
      amount,
      ...(participantId ? { participantId, checkoutSessionId: session.id } : {}),
    },
    { 'Idempotency-Key': session.id },
  );

  if (participantId) {
    await gatewayRequest('/v1/evaluation/checkout/status', participantId, {
      checkoutSessionId: session.id,
      status: 'confirmed',
      transactionHash: deposit.txHash,
      newRoot: deposit.newRoot,
    });
  }
  console.log(`Stripe test checkout processed: tier=${tier ?? 'unknown'}, event=${eventId}`);
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 });
  if (!WEBHOOK_SECRET) return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing_signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing deferred');
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}

export { handleCheckoutCompleted };
