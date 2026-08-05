// Isomorphic crypto core — shared by the browser (web) and Node (gateway/CLI).
// Pure functions only: no `fs`/`path`/`createRequire`, no Node `Buffer`, no
// `globalThis`/`window` usage. `crypto.getRandomValues` is available in both
// modern browsers and Node 18+.

import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// BLS12-381 Fr order (matches the Circom circuits and the v1 gateway).
export const FR_ORDER =
  '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001';

function toHexBytes(secretK: Uint8Array): string {
  return Array.from(secretK)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSecretK(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function deriveMnemonic(secretK: Uint8Array): string {
  return entropyToMnemonic(secretK, wordlist);
}

export function recoverSecretK(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic.trim(), wordlist);
}

// Reduce the 32-byte secret_k into the BLS12-381 Fr field as a decimal string.
export function skToField(secretK: Uint8Array): string {
  const val = BigInt('0x' + toHexBytes(secretK));
  return (val % BigInt(FR_ORDER)).toString();
}