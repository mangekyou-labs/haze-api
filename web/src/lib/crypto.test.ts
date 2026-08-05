import { describe, it, expect } from 'vitest';
import {
  generateSecretK,
  deriveMnemonic,
  recoverSecretK,
  secretKToField,
} from './crypto';

describe('web/src/lib/crypto (browser wiring of @zk-credits/shared)', () => {
  it('generateSecretK returns a 32-byte secret', () => {
    const sk = generateSecretK();
    expect(sk).toBeInstanceOf(Uint8Array);
    expect(sk.byteLength).toBe(32);
  });

  it('deriveMnemonic -> recoverSecretK round-trips the same 32 bytes', () => {
    const sk = generateSecretK();
    const mnemonic = deriveMnemonic(sk);
    // 24-word BIP-39 English mnemonic backing a 32-byte (256-bit) secret.
    // (32 bytes of entropy = 24 words; the shared package's deriveMnemonic
    // uses the full entropy, unlike a 128-bit/12-word wallet seed.)
    expect(mnemonic.split(' ')).toHaveLength(24);
    expect(recoverSecretK(mnemonic)).toEqual(sk);
  });

  it('secretKToField reduces into the BLS12-381 Fr field as a decimal string', () => {
    // All-zero secret reduces to 0.
    expect(secretKToField(new Uint8Array(32))).toBe('0');
    // A value above the Fr modulus is reduced.
    const frOrder = BigInt(
      '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001'
    );
    const big = new Uint8Array(32);
    big.fill(0xff);
    const field = BigInt(secretKToField(big));
    expect(field).toBeLessThan(frOrder);
    // Deterministic: same input -> same output.
    expect(secretKToField(big)).toBe(secretKToField(big));
  });

  it('secretKToField is the v1 alias `secretKToField` (stable surface)', () => {
    const sk = generateSecretK();
    expect(secretKToField(sk)).toBe(secretKToField(sk));
  });
});