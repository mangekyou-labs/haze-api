import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { evaluationGatewayRequest } from '@/lib/evaluation-api';
import Stripe from 'stripe';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const checkoutSessionId = request.nextUrl.searchParams.get('session_id');
  if (!checkoutSessionId) return NextResponse.json({ error: 'missing_checkout_session' }, { status: 400 });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !stripeKey.startsWith('sk_test_')) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 });
  }

  try {
    const stripe = new Stripe(stripeKey);
    const checkout = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const participantId = checkout.metadata?.participantId;
    if (!participantId) return NextResponse.json({ error: 'receipt_not_available' }, { status: 404 });
    const { response, identity } = await evaluationGatewayRequest(
      `/v1/evaluation/checkout?sessionId=${encodeURIComponent(checkoutSessionId)}`,
      'GET',
    );
    if (participantId !== identity.fullId) {
      return NextResponse.json({ error: 'receipt_not_available' }, { status: 403 });
    }
    if (!response.ok) return NextResponse.json({ error: 'receipt_not_available' }, { status: response.status });
    const receipt = await response.json() as Record<string, unknown>;
    // The gateway derives the current participant from the authenticated
    // session HMAC. Never trust a client-supplied participant ID for ownership.
    return NextResponse.json({
      checkoutSessionId: receipt.checkoutSessionId,
      amountCents: receipt.amountCents,
      processingStatus: receipt.processingStatus,
      transactionHash: receipt.transactionHash,
      explorerUrl: typeof receipt.transactionHash === 'string'
        ? `https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`
        : null,
      newRoot: receipt.newRoot,
      receivedAt: receipt.receivedAt,
      processedAt: receipt.processedAt,
    });
  } catch (error) {
    console.error('Checkout receipt lookup failed');
    return NextResponse.json({ error: 'receipt_unavailable' }, { status: 503 });
  }
}
