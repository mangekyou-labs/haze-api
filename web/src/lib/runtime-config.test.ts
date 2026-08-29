import { describe, expect, it } from 'vitest';
import { isGatewayConfigured, isStripeConfigured } from './runtime-config';

describe('runtime configuration', () => {
  it('only reports Stripe as configured when the server secret is present', () => {
    expect(isStripeConfigured({ STRIPE_SECRET_KEY: '' })).toBe(false);
    expect(isStripeConfigured({ STRIPE_SECRET_KEY: 'sk_test_example' })).toBe(true);
  });

  it('only reports the gateway as configured when its shared secret is present', () => {
    expect(isGatewayConfigured({ GATEWAY_SECRET: '' })).toBe(false);
    expect(isGatewayConfigured({ GATEWAY_SECRET: 'gateway-test-secret' })).toBe(true);
  });
});
