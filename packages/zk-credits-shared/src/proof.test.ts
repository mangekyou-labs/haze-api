import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeDepositCommitment,
  generateDepositProof,
  generateRlnProofSelfVerified,
  ProofSelfVerificationError,
  proveGroth16,
  verifyGroth16Proof,
} from './proof.js';
import { generateSecretK, skToField } from './crypto.js';

// Circuit artifacts are built by M1.0 (slow snarkjs bls12381 Groth16 setup).
// These tests are skipped until the artifacts exist so the shared package
// stays green independent of the background circuit build.
const CIRCUITS_DIR = process.env.CIRCUITS_DIR || resolve(import.meta.dirname, '..', '..', 'circuits');
const depositWasm = resolve(CIRCUITS_DIR, 'deposit_membership.wasm');
const depositZkey = resolve(CIRCUITS_DIR, 'deposit_membership_final.zkey');
const depositVkPath = resolve(CIRCUITS_DIR, 'verification_key_deposit.json');
const artifactsReady = existsSync(depositZkey) && existsSync(depositWasm) && existsSync(depositVkPath);
const rlnWasm = resolve(CIRCUITS_DIR, 'rln_nullifier.wasm');
const rlnZkey = resolve(CIRCUITS_DIR, 'rln_nullifier_final.zkey');
const rlnVkPath = resolve(CIRCUITS_DIR, 'verification_key_rln.json');
const rlnReady = existsSync(rlnZkey) && existsSync(rlnWasm) && existsSync(rlnVkPath);

const DEPOSIT_INPUT = {
  merkle_path_elements: ['0', '0', '0'],
  merkle_path_indices: ['0', '0', '0'],
};

function loadDepositVk(): unknown {
  return JSON.parse(readFileSync(depositVkPath, 'utf-8'));
}

describe('computeDepositCommitment', () => {
  it.runIf(artifactsReady)(
    'is deterministic and differs for different secret_k',
    async () => {
      const sk1 = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
      const sk2 = Uint8Array.from({ length: 32 }, (_, i) => 32 - i);
      const resources = { depositWasm, depositZkey };

      const c1 = await computeDepositCommitment(sk1, resources);
      const c1again = await computeDepositCommitment(sk1, resources);
      const c2 = await computeDepositCommitment(sk2, resources);

      expect(c1).toBe(c1again);
      expect(c1).not.toBe(c2);
    },
    120_000,
  );
});

describe('proveGroth16 + generateDepositProof + verifyGroth16Proof', () => {
  it.runIf(artifactsReady)(
    'round-trips a deposit proof: prove then verify with the same VK',
    async () => {
      const skField = skToField(generateSecretK());
      const resources = { depositWasm, depositZkey };

      const viaInput = await generateDepositProof(
        { secret_k: skField, ...DEPOSIT_INPUT },
        resources,
      );
      expect(viaInput.publicSignals).toHaveLength(2); // [root, commitment]

      const valid = await verifyGroth16Proof(
        loadDepositVk(),
        viaInput.publicSignals,
        viaInput.proof,
      );
      expect(valid).toBe(true);
    },
    180_000,
  );

  it.runIf(artifactsReady)(
    'rejects a tampered proof (defense-in-depth negative path)',
    async () => {
      const skField = skToField(generateSecretK());
      const { proof, publicSignals } = await proveGroth16(
        { secret_k: skField, ...DEPOSIT_INPUT },
        depositWasm,
        depositZkey,
      );

      const tamperedSignals = publicSignals.map((s) => (BigInt(s) + 1n).toString());
      const valid = await verifyGroth16Proof(
        loadDepositVk(),
        tamperedSignals,
        proof,
      );
      expect(valid).toBe(false);
    },
    180_000,
  );
});

describe('generateRlnProofSelfVerified', () => {
  const rlnInput = {
    secret_k: '0',
    signal_value: '0',
    epoch: '0',
    merkle_path_elements: ['0', '0', '0'],
    merkle_path_indices: ['0', '0', '0'],
  };

  function rlnResources(vk: unknown) {
    return { rlnWasm, rlnZkey, rlnVk: vk };
  }

  it.runIf(rlnReady)(
    'self-verifies a valid RLN proof before returning it (proof never leaves the client unverified)',
    async () => {
      const resources = rlnResources(JSON.parse(readFileSync(rlnVkPath, 'utf-8')));
      const result = await generateRlnProofSelfVerified(
        { ...rlnInput, secret_k: skToField(generateSecretK()) },
        resources,
      );
      expect(result.publicSignals).toHaveLength(5); // [root, nullifier, share_x, share_y, epoch]
      expect(result.nullifier).toBe(result.publicSignals[1]);
    },
    180_000,
  );

  it.runIf(rlnReady)(
    'throws ProofSelfVerificationError when local verification fails (wrong VK)',
    async () => {
      // A VK from a different circuit must fail local verification.
      const wrongVk = JSON.parse(readFileSync(depositVkPath, 'utf-8'));
      await expect(
        generateRlnProofSelfVerified(
          { ...rlnInput, secret_k: skToField(generateSecretK()) },
          rlnResources(wrongVk),
        ),
      ).rejects.toBeInstanceOf(ProofSelfVerificationError);
    },
    180_000,
  );
});
