import { describe, it, expect } from 'vitest';
import {
  canonicalizeRequest,
  deriveMembershipWitness,
  deriveMnemonic,
  deriveTicketSignals,
  generateSecretK,
  mimcHash,
  recoverSecretK,
  requestDigestToField,
  skToField,
} from './crypto.js';

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

describe('paper-aligned indexed tickets', () => {
  const request = {
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 256,
  };

  it('canonicalizes request object keys without changing array order', () => {
    expect(canonicalizeRequest({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
    expect(canonicalizeRequest({ messages: [{ role: 'user' }, { role: 'assistant' }] })).toContain(
      '"messages":[{"role":"user"},{"role":"assistant"}]',
    );
  });

  it('derives a deterministic request field from the canonical body', async () => {
    const left = await requestDigestToField({ b: 2, a: 1 });
    const right = await requestDigestToField({ a: 1, b: 2 });
    const changed = await requestDigestToField({ a: 1, b: 3 });

    expect(left).toEqual(right);
    expect(left.field).not.toBe(changed.field);
    expect(left.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses distinct private ticket indices for unlinkable nullifiers', async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const ticket0 = await deriveTicketSignals(secret, 0, request);
    const ticket1 = await deriveTicketSignals(secret, 1, request);

    expect(ticket0.nullifier).not.toBe(ticket1.nullifier);
    expect(ticket0.signalX).toBe(ticket1.signalX);
    expect(ticket0.signalY).not.toBe(ticket1.signalY);
    expect(ticket0.ticketIndex).toBe(0);
    expect(ticket1.ticketIndex).toBe(1);
  });

  it('keeps the nullifier but changes the share for a forked request', async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const first = await deriveTicketSignals(secret, 7, request);
    const fork = await deriveTicketSignals(secret, 7, {
      ...request,
      messages: [{ role: 'user', content: 'fork' }],
    });

    expect(fork.nullifier).toBe(first.nullifier);
    expect(fork.signalX).not.toBe(first.signalX);
    expect(fork.signalY).not.toBe(first.signalY);
  });

  it('rejects a ticket index outside the fixed Starter range', async () => {
    const secret = generateSecretK();
    await expect(deriveTicketSignals(secret, -1, request)).rejects.toThrow('ticket index');
    await expect(deriveTicketSignals(secret, 100, request)).rejects.toThrow('ticket index');
  });
});

describe('public membership snapshots', () => {
  it('derives the real path for the second indexed leaf', async () => {
    const parent = await mimcHash([11n, 22n]);
    const upper = await mimcHash([BigInt(parent), 0n]);
    const root = await mimcHash([BigInt(upper), 0n]);
    const witness = await deriveMembershipWitness('22', {
      root,
      depth: 3,
      leaves: ['11', '22', '0', '0', '0', '0', '0', '0'],
    });

    expect(witness).toEqual({
      root,
      leafIndex: 1,
      merklePathElements: ['11', '0', '0'],
      merklePathIndices: ['1', '0', '0'],
    });
  });

  it('rejects a snapshot whose leaves do not reproduce its claimed root', async () => {
    await expect(deriveMembershipWitness('22', {
      root: '123',
      depth: 3,
      leaves: ['11', '22', '0', '0', '0', '0', '0', '0'],
    })).rejects.toThrow(/root/i);
  });

  it('uses persisted layers when a removed branch cannot be rebuilt from leaves alone', async () => {
    const removedBranch = await mimcHash([0n, 0n]);
    const activeBranch = await mimcHash([202n, 0n]);
    const upper = await mimcHash([BigInt(removedBranch), BigInt(activeBranch)]);
    const root = await mimcHash([BigInt(upper), 0n]);

    const witness = await deriveMembershipWitness('202', {
      root,
      depth: 3,
      leaves: ['0', '0', '202', '0', '0', '0', '0', '0'],
      layers: [
        ['0', '0', '202', '0', '0', '0', '0', '0'],
        [removedBranch, activeBranch, '0', '0'],
        [upper, '0'],
        [root],
      ],
    });

    expect(witness.merklePathElements).toEqual(['0', removedBranch, '0']);
    expect(witness.merklePathIndices).toEqual(['0', '1', '0']);
  });
});
