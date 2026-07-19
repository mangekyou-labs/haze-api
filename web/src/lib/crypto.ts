// Browser-side crypto: secret_k generation + commitment computation
// Uses snarkjs wtns.calculate for witness computation (WASM only, no zkey needed)

import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require('snarkjs');

export function generateSecretK(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function secretKToField(sk: Uint8Array): string {
  const hex = Array.from(sk)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const val = BigInt('0x' + hex);
  const frOrder = BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001');
  return (val % frOrder).toString();
}

export async function computeCommitment(secretK: Uint8Array): Promise<string> {
  const input = {
    secret_k: secretKToField(secretK),
    merkle_path_elements: ['0', '0', '0'],
    merkle_path_indices: ['0', '0', '0'],
  };
  const { publicSignals } = await snarkjs.groth16.fullProve(
    input,
    '/circuits/deposit_membership.wasm',
    '/circuits/deposit_membership_final.zkey',
  );
  // deposit_membership outputs: [root, commitment]
  return publicSignals[1].toString();
}

export function recoverSecretK(mnemonic: string): Uint8Array {
  return new Uint8Array(mnemonicToEntropy(mnemonic.trim(), wordlist));
}
