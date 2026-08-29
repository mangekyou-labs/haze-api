import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

export function checkoutStateFromParam(
  param: string | null,
  commitment: string | null,
):
  | 'idle'
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'missing-identity'
  | 'gateway-unavailable' {
  if (param === 'cancelled') return 'cancelled';
  if (param === 'success') {
    return commitment ? 'pending' : 'missing-identity';
  }
  return 'idle';
}

describe('checkoutStateFromParam derivation', () => {
  it('derives cancelled state from checkout=cancelled param without setState effect', () => {
    expect(checkoutStateFromParam('cancelled', null)).toBe('cancelled');
    expect(checkoutStateFromParam('cancelled', 'c123')).toBe('cancelled');
  });

  it('derives pending or missing-identity from checkout=success param', () => {
    expect(checkoutStateFromParam('success', null)).toBe('missing-identity');
    expect(checkoutStateFromParam('success', 'c123')).toBe('pending');
  });

  it('derives idle when no param is present', () => {
    expect(checkoutStateFromParam(null, null)).toBe('idle');
    expect(checkoutStateFromParam(null, 'c123')).toBe('idle');
    expect(checkoutStateFromParam('other', 'c123')).toBe('idle');
  });
});

describe('eslint.config.mjs ignores', () => {
  it('includes .vercel/** in globalIgnores', () => {
    const configPath = path.resolve(__dirname, '../../eslint.config.mjs');
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('.vercel/**');
  });
});
