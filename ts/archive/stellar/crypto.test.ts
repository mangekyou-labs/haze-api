import { describe, it, expect } from 'vitest';
import { generateSecretK, computeCommitment, deriveMnemonic, recoverSecretK } from './crypto.js';
import { generateDepositProof } from './prover.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');

const CIRCUITS_DIR = process.env.CIRCUITS_DIR || path.resolve(import.meta.dirname!, '..', '..', 'circuits');

describe('crypto', () => {
  describe('generateSecretK', () => {
    it('generates a 32-byte Uint8Array', () => {
      const sk = generateSecretK();
      expect(sk).toBeInstanceOf(Uint8Array);
      expect(sk.length).toBe(32);
    });

    it('generates unique values', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const sk = generateSecretK();
        const hex = Array.from(sk).map((b) => b.toString(16).padStart(2, '0')).join('');
        expect(seen.has(hex)).toBe(false);
        seen.add(hex);
      }
    });
  });

  describe('deriveMnemonic', () => {
    it('derives a 24-word mnemonic from 32 bytes', () => {
      const sk = generateSecretK();
      const mnemonic = deriveMnemonic(sk);
      expect(mnemonic.split(' ').length).toBe(24);
    });

    it('recoverSecretK restores original bytes', () => {
      const sk = generateSecretK();
      const mnemonic = deriveMnemonic(sk);
      const recovered = recoverSecretK(mnemonic);
      expect(Array.from(recovered).join(',')).toBe(Array.from(sk).join(','));
    });
  });

  describe('computeCommitment', () => {
    it('produces a deterministic commitment from secret_k', async () => {
      const sk = new Uint8Array(32).fill(42);
      const c1 = await computeCommitment(sk);
      const c2 = await computeCommitment(sk);
      expect(c1).toBe(c2);
    }, 60000);

    it('produces different commitments for different secret_k', async () => {
      const sk1 = new Uint8Array(32).fill(1);
      const sk2 = new Uint8Array(32).fill(2);
      const c1 = await computeCommitment(sk1);
      const c2 = await computeCommitment(sk2);
      expect(c1).not.toBe(c2);
    }, 60000);
  });
});

describe('proof generation', () => {
  it('generates and verifies deposit proof', async () => {
    const sk = new Uint8Array(32).fill(1);
    const skField = BigInt(
      '0x' + Array.from(sk).map((b) => b.toString(16).padStart(2, '0')).join(''),
    ).toString();

    const result = await generateDepositProof({
      secret_k: skField,
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    });

    expect(result.proof).toBeDefined();
    expect(result.publicSignals).toHaveLength(2); // [root, commitment]
    expect(result.publicSignals[1]).toBeDefined();

    // Verify the proof with snarkjs
    const vkPath = path.join(CIRCUITS_DIR, 'verification_key_deposit.json');
    const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
    const valid = await snarkjs.groth16.verify(vk, result.publicSignals, result.proof);
    expect(valid).toBe(true);
  }, 60000);
});
