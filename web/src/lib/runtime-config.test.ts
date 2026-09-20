import { describe, expect, it } from 'vitest';
import { gatewayInternalHeaders, isGatewayConfigured } from './runtime-config';

describe('runtime configuration', () => {
  it('only reports the gateway as configured when its URL is present', () => {
    expect(isGatewayConfigured({ GATEWAY_URL: '' })).toBe(false);
    expect(isGatewayConfigured({ GATEWAY_URL: 'https://gateway.example' })).toBe(true);
  });

  it('sends the internal service token only when configured', () => {
    expect(gatewayInternalHeaders({})).toEqual({});
    expect(gatewayInternalHeaders({ BILLING_INTERNAL_TOKEN: 'internal-token' })).toEqual({
      Authorization: 'Bearer internal-token',
    });
  });
});
