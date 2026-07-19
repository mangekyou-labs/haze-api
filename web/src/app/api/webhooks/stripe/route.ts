import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const { userId, tier, usdcAmount, commitment } = session.metadata ?? {};

  if (!userId || !usdcAmount) {
    console.error('Webhook missing metadata:', { userId, tier, usdcAmount });
    return;
  }

  console.log(`Payment completed: user=${userId}, tier=${tier}, usdc=${usdcAmount}, commitment=${commitment ?? 'none'}`);

  if (!commitment) {
    console.warn('No commitment in metadata — deposit not submitted on-chain. User needs to complete onboarding first.');
    return;
  }

  if (!GATEWAY_SECRET) {
    console.error('GATEWAY_SECRET not configured — cannot call gateway deposit endpoint');
    return;
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/deposits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_SECRET}`,
      },
      body: JSON.stringify({ commitment, amount: Number(usdcAmount) }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Gateway deposit failed:', res.status, err);
      return;
    }

    const data = await res.json();
    console.log(`On-chain deposit: txHash=${data.txHash}, root=${data.newRoot}`);
  } catch (err) {
    console.error('Gateway deposit error:', err);
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

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    default:
      console.log(`Unhandled webhook event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
