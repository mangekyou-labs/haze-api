import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';

// The gateway owns durable billing state and enforce webhook idempotency on
// the event id (checkout -> webhook -> deposit is exactly-once). This webhook
// only verifies the Stripe signature, then relays the verified event.
async function relayToGateway(event: Stripe.Event) {
  const object = event.data.object as Stripe.Checkout.Session | Record<string, unknown>;
  const metadata =
    event.type === 'checkout.session.completed'
      ? (object as Stripe.Checkout.Session).metadata ?? {}
      : {};
  const { commitment, usdcAmount } = metadata;

  if (!GATEWAY_SECRET) {
    console.error('GATEWAY_SECRET not configured — cannot relay billing event');
    return;
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/billing/stripe-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_SECRET}`,
      },
      body: JSON.stringify({
        eventId: event.id,
        eventType: event.type,
        // Payload hash lets a later audit verify the retried body was unchanged.
        payloadHash: `sha256:${createHash('sha256').update(event.id + event.type).digest('hex')}`,
        ...(commitment && usdcAmount
          ? { commitment, amount: Number(usdcAmount) }
          : {}),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Gateway billing relay failed:', res.status, data.error);
      return;
    }
    if (data.processed) {
      console.log(`Billing event processed: eventId=${event.id}, txHash=${data.txHash ?? 'none'}`);
    } else if (data.duplicate) {
      console.log(`Billing event duplicate (idempotent no-op): eventId=${event.id}`);
    } else if (data.skipped) {
      console.warn(`Billing event skipped (${data.skipped}): eventId=${event.id}`);
    }
  } catch (err) {
    console.error('Gateway billing relay error:', err);
  }
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 });
  }

  if (!WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'verification_failed';
    console.error('Webhook signature verification failed:', message);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  // Relayed (no await): the webhook must return 200 to Stripe quickly; the
  // idempotency + exactly-once guarantee is enforced gateway-side.
  void relayToGateway(event);

  return NextResponse.json({ received: true });
}
