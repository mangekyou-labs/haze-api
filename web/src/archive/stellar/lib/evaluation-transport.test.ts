import { describe, expect, it } from 'vitest';
import { buildEvaluationGatewayRequest } from './evaluation-transport';

describe('evaluation gateway transport', () => {
  it('binds the derived participant identity to the authenticated gateway request', () => {
    const request = buildEvaluationGatewayRequest({
      method: 'POST',
      gatewaySecret: 'gateway-secret',
      participantId: 'a'.repeat(64),
      body: { consentVersion: 'level4-2026-09-11' },
    });

    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer gateway-secret',
      'x-evaluation-participant-id': 'a'.repeat(64),
      'Cache-Control': 'no-store',
    });
    expect(request.body).toBe(JSON.stringify({ consentVersion: 'level4-2026-09-11' }));
  });

  it('does not send a JSON body for GET status and checkout reads', () => {
    const request = buildEvaluationGatewayRequest({
      method: 'GET',
      gatewaySecret: 'gateway-secret',
      participantId: 'b'.repeat(64),
    });

    expect(request.headers).toEqual({
      'Authorization': 'Bearer gateway-secret',
      'x-evaluation-participant-id': 'b'.repeat(64),
      'Cache-Control': 'no-store',
    });
    expect(request.body).toBeUndefined();
  });
});
