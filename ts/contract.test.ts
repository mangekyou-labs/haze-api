import { describe, expect, it } from 'vitest';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import {
  groth16ProofToScVal,
  groth16PublicSignalsToScVal,
  nullifierSpentEventFilter,
} from './contract.js';

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
  it('serializes snarkjs BLS points as a named Soroban struct map', () => {
    const native = scValToNative(groth16ProofToScVal(fixtureProof)) as {
      a: Uint8Array;
      b: Uint8Array;
      c: Uint8Array;
    };

    expect(Object.keys(native).sort()).toEqual(['a', 'b', 'c']);
    expect([native.a, native.b, native.c].map((point) => point.length)).toEqual([96, 192, 96]);
    expect(Buffer.from(native.a).toString('hex')).toBe(`${'00'.repeat(47)}01${'00'.repeat(47)}02`);
    expect(Buffer.from(native.b).toString('hex')).toBe(
      `${'00'.repeat(47)}04${'00'.repeat(47)}03${'00'.repeat(47)}06${'00'.repeat(47)}05`,
    );
    expect(Buffer.from(native.c).toString('hex')).toBe(`${'00'.repeat(47)}07${'00'.repeat(47)}08`);
  });

  it('rejects projective points that need affine reduction', () => {
    expect(() =>
      groth16ProofToScVal({
        ...fixtureProof,
        pi_a: ['1', '2', '9'],
      }),
    ).toThrow('G1 proof point z must be 1');
  });

  it('encodes every public signal as a Soroban u256', () => {
    const signals = groth16PublicSignalsToScVal([
      '1',
      '340282366920938463463374607431768211456',
    ]);

    expect(signals.vec()?.map((value) => value.switch().name)).toEqual(['scvU256', 'scvU256']);
    expect(scValToNative(signals)).toEqual([
      1n,
      340282366920938463463374607431768211456n,
    ]);
  });

  it('encodes the NullifierSpent topic as ScVal XDR for RPC event filters', () => {
    const filter = nullifierSpentEventFilter('C' + 'A'.repeat(55));
    const topic = filter.topics?.[0]?.[0];

    expect(typeof topic).toBe('string');
    expect(xdr.ScVal.fromXDR(topic as string, 'base64').sym().toString()).toBe('NullifierSpent');
  });
});
