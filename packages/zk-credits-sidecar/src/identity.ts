import * as keytar from 'keytar';
import { recoverSecretK } from '@zk-credits/shared';

const SERVICE = 'zk-credits-sidecar';
const ACCOUNT = 'secret-k-v1';

export interface CredentialStore {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
}

function secretToHex(secretK: Uint8Array): string {
  if (secretK.length !== 32) throw new Error('Expected a 32-byte ZK Credits secret');
  return Array.from(secretK, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToSecret(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('Stored ZK Credits credential is malformed; re-import the mnemonic');
  }
  return new Uint8Array(value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
}

/**
 * Owns the local private identity. The recovery phrase is converted to the
 * 32-byte secret before persistence, so neither the phrase nor a local bearer
 * ever reaches the gateway or ticket ledger.
 */
export class IdentityStore {
  constructor(private readonly credentials: CredentialStore = keytar) {}

  async hasIdentity(): Promise<boolean> {
    return await this.credentials.getPassword(SERVICE, ACCOUNT) !== null;
  }

  async importMnemonic(mnemonic: string): Promise<Uint8Array> {
    const secretK = recoverSecretK(mnemonic);
    if (secretK.length !== 32) throw new Error('Recovery phrase must encode a 32-byte secret');
    await this.credentials.setPassword(SERVICE, ACCOUNT, secretToHex(secretK));
    return secretK;
  }

  async loadSecretK(options: { headlessMnemonic?: string } = {}): Promise<Uint8Array> {
    const stored = await this.credentials.getPassword(SERVICE, ACCOUNT);
    if (stored !== null) return hexToSecret(stored);
    if (options.headlessMnemonic) {
      const secretK = recoverSecretK(options.headlessMnemonic);
      if (secretK.length !== 32) throw new Error('Recovery phrase must encode a 32-byte secret');
      return secretK;
    }
    throw new Error('No ZK Credits identity found; run zk-credits import-mnemonic first');
  }
}
