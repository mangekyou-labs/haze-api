import { describe, it, expect } from 'vitest';
import { generateSecretK, deriveMnemonic, recoverSecretK, skToField } from './crypto.js';

// BLS12-381 Fr order (same constant as the circuits and the v1 gateway).
const FR_ORDER = BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001');

function hexOf(sk: Uint8Array): string {
  return Array.from(sk)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('generateSecretK', () => {
  it('generates a 32-byte Uint8Array', () => {
    const sk = generateSecretK();
    expect(sk).toBeInstanceOf(Uint8Array);
    expect(sk.length).toBe(32);
  });

  it('generates unique values', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const hex = hexOf(generateSecretK());
      expect(seen.has(hex)).toBe(false);
      seen.add(hex);
    }
  });
});

describe('deriveMnemonic / recoverSecretK', () => {
  it('derives a 24-word mnemonic from 32 secret bytes', () => {
    const sk = generateSecretK();
    const mnemonic = deriveMnemonic(sk);
    expect(mnemonic.split(' ').length).toBe(24);
  });

  it('recovers the original secret_k from its mnemonic', () => {
    const sk = Uint8Array.from([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ]);
    const recovered = recoverSecretK(deriveMnemonic(sk));
    expect(Array.from(recovered)).toEqual(Array.from(sk));
  });
});

describe('skToField', () => {
  it('reduces the 32-byte secret_k into the BLS12-381 Fr field', () => {
    const sk = new Uint8Array(32);
    sk[0] = 1;
    sk[1] = 2;
    sk[2] = 3;
    const hex = Array.from(sk)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const expected = (BigInt('0x' + hex) % FR_ORDER).toString();
    expect(skToField(sk)).toBe(expected);
  });


  it('never exceeds the Fr order even at the maximum 32-byte value', () => {
    const sk = new Uint8Array(32).fill(0xff);
    expect(BigInt(skToField(sk))).toBeLessThan(FR_ORDER);
  });

  it('is deterministic for the same input', () => {
    const sk = new Uint8Array(32).fill(7);
    expect(skToField(sk)).toBe(skToField(sk));
  });
});
