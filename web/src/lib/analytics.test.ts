import { describe, expect, it } from 'vitest';
import { sanitizeAnalyticsProperties } from './analytics';

describe('analytics privacy boundary', () => {
  it('keeps only coarse allow-listed properties and clamps values', () => {
    expect(sanitizeAnalyticsProperties({
      durationMs: 999_999,
      easeRating: 99,
      breakpoint: 'mobile',
      errorCode: 'wallet_proof_invalid',
      prompt: 'never send this',
      wallet: 'GABC',
    } as never)).toEqual({
      durationMs: 90_000,
      easeRating: 5,
      breakpoint: 'mobile',
      errorCode: 'wallet_proof_invalid',
    });
  });
});
