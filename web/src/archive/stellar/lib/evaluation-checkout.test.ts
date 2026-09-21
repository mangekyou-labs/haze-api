import { describe, expect, it } from 'vitest';
import { buildEvaluationCheckoutMetadata } from './evaluation-checkout';

describe('evaluation checkout metadata', () => {
  it('binds the consented participant and exact one-dollar test tier', () => {
    const metadata = buildEvaluationCheckoutMetadata({
      participantId: 'c'.repeat(64),
      participantCode: 'L4-cccccccccccc',
      commitment: '123456789',
    });

    expect(metadata).toEqual({
      tier: 'evaluation',
      participantId: 'c'.repeat(64),
      participantCode: 'L4-cccccccccccc',
      commitment: '123456789',
      usdcAmount: '10000000',
      amountCents: '100',
    });
    expect(metadata).not.toHaveProperty('userId');
  });
});
