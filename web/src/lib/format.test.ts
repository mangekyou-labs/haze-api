import { describe, expect, it } from 'vitest';
import { formatUsdc } from './format';

describe('formatUsdc', () => {
  it('formats 6-decimal USDC integer strings as dollars', () => {
    // USDC has 6 decimals: 5_000_000 = $5.00
    expect(formatUsdc('5000000')).toBe('5');
    expect(formatUsdc('20000000')).toBe('20');
    expect(formatUsdc('0')).toBe('0');
  });

  it('keeps fractional dollars readable', () => {
    expect(formatUsdc('1500000')).toBe('1.5');
    expect(formatUsdc('1234567')).toBe('1.234567');
  });

  it('falls back to 0 on malformed input', () => {
    expect(formatUsdc('not-a-number')).toBe('0');
    expect(formatUsdc('')).toBe('0');
  });
});
