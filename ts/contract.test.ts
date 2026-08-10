import { describe, expect, it } from 'vitest';
import { scValToNative } from '@stellar/stellar-sdk';
import { groth16ProofToScVal } from './contract.js';

const fixtureProof = {
  pi_a: ['1', '2', '1'],
  pi_b: [
    ['3', '4'],
    ['5', '6'],
    ['1', '0'],
  ],
  pi_c: ['7', '8', '1'],
  protocol: 'groth16',
  curve: 'bls12381',
};

describe('Groth16 Soroban proof serialization', () => {
  it('serializes snarkjs BLS points as positional Soroban byte vectors', () => {
    const native = scValToNative(groth16ProofToScVal(fixtureProof)) as Uint8Array[];

    expect(native).toHaveLength(3);
    expect(native.map((point) => point.length)).toEqual([96, 192, 96]);
    expect(Buffer.from(native[0]).toString('hex')).toBe(`${'00'.repeat(47)}01${'00'.repeat(47)}02`);
    expect(Buffer.from(native[1]).toString('hex')).toBe(
      `${'00'.repeat(47)}04${'00'.repeat(47)}03${'00'.repeat(47)}06${'00'.repeat(47)}05`,
    );
    expect(Buffer.from(native[2]).toString('hex')).toBe(`${'00'.repeat(47)}07${'00'.repeat(47)}08`);
  });

  it('rejects projective points that need affine reduction', () => {
    expect(() =>
      groth16ProofToScVal({
        ...fixtureProof,
        pi_a: ['1', '2', '9'],
      }),
    ).toThrow('G1 proof point z must be 1');
  });
});
