import Stripe from 'stripe';

export function stripeSandbox() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) throw new Error('stripe_sandbox_not_configured');
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
}
