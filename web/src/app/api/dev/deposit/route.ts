import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';

const DEV_TIERS: Record<string, number> = {
  starter: 5_0000000,     // $5 USDC (7 decimals)
  pro: 20_0000000,        // $20
  enterprise: 50_0000000, // $50
};

/**
 * Dev-only endpoint: bypasses Stripe, calls gateway /v1/deposits directly.
 * Only works when STRIPE_SECRET_KEY is NOT set.
 */
export async function POST(req: NextRequest) {
  if (process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: 'dev_deposit_disabled', message: 'Use /api/checkout when Stripe is configured' },
      { status: 403 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!GATEWAY_SECRET) {
    return NextResponse.json({ error: 'gateway_not_configured' }, { status: 500 });
  }

  let tier: string;
  let commitment: string | undefined;
  try {
    const body = await req.json();
    tier = body.tier;
    commitment = body.commitment;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const amount = DEV_TIERS[tier];
  if (!amount) {
    return NextResponse.json(
      { error: 'invalid_tier', valid: Object.keys(DEV_TIERS) },
      { status: 400 },
    );
  }

  if (!commitment) {
    return NextResponse.json(
      { error: 'missing_commitment', message: 'Complete onboarding first to generate a commitment' },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/deposits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GATEWAY_SECRET}`,
      },
      body: JSON.stringify({ commitment, amount }),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        deposited: true,
        tier,
        amount: amount.toString(),
        txHash: data.txHash,
        commitment,
        dev: true,
      });
    }

    // Gateway deposit failed (e.g., GATEWAY_SECRET_KEY not set, no on-chain infra)
    // Fall back to simulated deposit for dev/testing
    const errText = await res.text();
    console.warn('Gateway deposit unavailable, simulating:', res.status, errText);

    return NextResponse.json({
      deposited: true,
      tier,
      amount: amount.toString(),
      txHash: `simulated-${Date.now().toString(16)}`,
      commitment,
      dev: true,
      simulated: true,
    });
  } catch (err: unknown) {
    // Gateway unreachable — still succeed in dev mode with simulated deposit
    const message = err instanceof Error ? err.message : 'unknown';
    console.warn('Gateway unreachable, simulating deposit:', message);

    return NextResponse.json({
      deposited: true,
      tier,
      amount: amount.toString(),
      txHash: `simulated-${Date.now().toString(16)}`,
      commitment,
      dev: true,
      simulated: true,
    });
  }
}