import { describe, expect, it } from 'vitest';
import { deriveMnemonic } from '@zk-credits/shared';
import { IdentityStore, type CredentialStore } from './identity.js';

class FakeCredentialStore implements CredentialStore {
  value: string | null = null;
  writes = 0;

  async getPassword(): Promise<string | null> {
    return this.value;
  }

  async setPassword(_service: string, _account: string, password: string): Promise<void> {
    this.writes += 1;
    this.value = password;
  }
}

const testMnemonic = deriveMnemonic(new Uint8Array(32).fill(7));

describe('IdentityStore', () => {
  it('reports whether an identity is configured without exposing its value', async () => {
    const credentialStore = new FakeCredentialStore();
    const identities = new IdentityStore(credentialStore);

    await expect(identities.hasIdentity()).resolves.toBe(false);
    await identities.importMnemonic(testMnemonic);
    await expect(identities.hasIdentity()).resolves.toBe(true);
  });

  it('stores only the derived secret and retrieves it after mnemonic import', async () => {
    const credentialStore = new FakeCredentialStore();
    const identities = new IdentityStore(credentialStore);

    const imported = await identities.importMnemonic(testMnemonic);

    expect(imported).toEqual(new Uint8Array(32).fill(7));
    expect(credentialStore.writes).toBe(1);
    expect(credentialStore.value).toMatch(/^[a-f0-9]{64}$/);
    expect(credentialStore.value).not.toContain(testMnemonic.split(' ')[0]!);
    await expect(identities.loadSecretK()).resolves.toEqual(imported);
  });

  it('uses a headless mnemonic only in memory when no credential is stored', async () => {
    const credentialStore = new FakeCredentialStore();
    const identities = new IdentityStore(credentialStore);

    await expect(identities.loadSecretK({ headlessMnemonic: testMnemonic }))
      .resolves.toEqual(new Uint8Array(32).fill(7));
    expect(credentialStore.writes).toBe(0);
  });

  it('rejects an invalid mnemonic before writing a credential', async () => {
    const credentialStore = new FakeCredentialStore();
    const identities = new IdentityStore(credentialStore);

    await expect(identities.importMnemonic('not a recovery phrase')).rejects.toThrow();
    expect(credentialStore.writes).toBe(0);
  });
});
