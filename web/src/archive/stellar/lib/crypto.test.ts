import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  computeCommitment,
  fetchMembershipTreeSnapshot,
  generateSecretK,
  deriveMnemonic,
  recoverSecretK,
  secretKToField,
} from './crypto';
import { mimcHash } from '@zk-credits/shared';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

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

  it('derives the deposit commitment without loading Groth16 artifacts', async () => {
    const secretK = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const expected = await mimcHash([BigInt(secretKToField(secretK))]);

    await expect(computeCommitment(secretK)).resolves.toBe(expected);
  });

  it('fetches a fresh parameter-free public membership snapshot', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      root: '0',
      depth: 3,
      leaves: Array<string>(8).fill('0'),
      layers: [Array<string>(8).fill('0'), Array<string>(4).fill('0'), Array<string>(2).fill('0'), ['0']],
      generatedAt: new Date().toISOString(),
    }), { status: 200 })) as unknown as typeof fetch;

    await expect(fetchMembershipTreeSnapshot()).resolves.toMatchObject({ root: '0', depth: 3 });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/v1/membership-tree',
      { cache: 'no-store' },
    );
  });
});
