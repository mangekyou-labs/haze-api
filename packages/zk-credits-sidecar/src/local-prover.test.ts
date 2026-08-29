import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { requestDigestToField, type MembershipWitness } from '@zk-credits/shared';
import { createLocalProofGenerator } from './local-prover.js';

describe('local proof generator', () => {
  it('binds the original request and the local membership witness into one self-verified ticket proof', async () => {
    const secretK = new Uint8Array(32).fill(12);
    const witness: MembershipWitness = {
      root: '99',
      leafIndex: 2,
      merklePathElements: ['11', '22', '33'],
      merklePathIndices: ['0', '1', '0'],
    };
    const membershipClient = { witnessForSecret: vi.fn(async () => witness) };
    const prove = vi.fn(async () => ({ proof: { proof: true }, publicSignals: ['99', '1', '2', '3'] }));
    const request = { model: 'test', input: 'private request' };
    const proofForRequest = await createLocalProofGenerator({
      secretK,
      membershipClient,
      artifactDirectory: resolve(import.meta.dirname!, '..', 'circuits'),
      prove,
    });

    await expect(proofForRequest({ ticketIndex: 7, request })).resolves.toMatchObject({
      pubSignals: ['99', '1', '2', '3'],
    });
    expect(prove).toHaveBeenCalledWith(expect.objectContaining({
      ticket_index: '7',
      request_digest: (await requestDigestToField(request)).field,
      merkle_path_elements: witness.merklePathElements,
      merkle_path_indices: witness.merklePathIndices,
    }), expect.objectContaining({
      rlnWasm: resolve(import.meta.dirname!, '..', 'circuits', 'rln_nullifier.wasm'),
      rlnZkey: resolve(import.meta.dirname!, '..', 'circuits', 'rln_nullifier_final.zkey'),
    }));
  });
});
