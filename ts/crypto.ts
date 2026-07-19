// Browser Crypto Module — secret_k, BIP-39, commitment

import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');

const CIRCUITS_DIR = process.env.CIRCUITS_DIR || resolve(import.meta.dirname!, '..', '..', 'circuits');

// ─── secret_k generation ─────────────────────────────────────────

export function generateSecretK(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

// ─── BIP-39 mnemonic (deterministic from secret_k) ──────────────

export function deriveMnemonic(secretK: Uint8Array): string {
  return entropyToMnemonic(secretK, wordlist);
}

export function recoverSecretK(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

// ─── Commitment computation (via deposit_membership circuit) ─────

function skToField(secretK: Uint8Array): string {
  const hex = Buffer.from(secretK).toString('hex');
  const val = BigInt('0x' + hex);
  // BLS12-381 Fr order (from the circuit's field)
  const frOrder = BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001');
  const reduced = val % frOrder;
  return reduced.toString();
}

export async function computeCommitment(secretK: Uint8Array): Promise<string> {
  const input = {
    secret_k: skToField(secretK),
    merkle_path_elements: ['0', '0', '0'],
    merkle_path_indices: ['0', '0', '0'],
  };

  const wasmPath = resolve(CIRCUITS_DIR, 'deposit_membership.wasm');
  const { publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    resolve(CIRCUITS_DIR, 'deposit_membership_final.zkey'),
  );

  // publicSignals: [root, commitment]
  return publicSignals[1];
}
