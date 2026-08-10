// Isomorphic crypto core — shared by the browser and Node runtimes.
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export const FR_ORDER = '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001';

function toHexBytes(secretK) {
  return Array.from(secretK).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSecretK() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function deriveMnemonic(secretK) {
  return entropyToMnemonic(secretK, wordlist);
}

export function recoverSecretK(mnemonic) {
  return mnemonicToEntropy(mnemonic.trim(), wordlist);
}

export function skToField(secretK) {
  const val = BigInt('0x' + toHexBytes(secretK));
  return (val % BigInt(FR_ORDER)).toString();
}
