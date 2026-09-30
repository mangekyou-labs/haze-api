import { describe, expect, it } from 'vitest';
import { createRecoveryCapsule, generateSecret, computeCommitment, wrapActivatedCredential } from '@zk-credits/shared/base';
import { importStoredCredential, type CredentialStore } from './credential-store.js';
import { createLocalX402Agent } from './local-x402-agent.js';

function memoryStore(): CredentialStore {
  let value: string | undefined;
  return { read: async () => value, write: async (input) => { value = input; } };
}

async function activatedFile() {
  const secret = generateSecret();
  return wrapActivatedCredential(await createRecoveryCapsule(secret), {
    commitment: await computeCommitment(secret), tierId: 0,
    expiry: Math.floor(Date.now() / 1000) + 3600, deploymentDomain: '84532',
    network: 'eip155:84532', contractAddress: 'local-test', transactionHash: 'local-test',
  });
}

describe('passwordless own-agent launch', () => {
  it('loads an imported website activated file without a password or browser export path', async () => {
    const store = memoryStore();
    await importStoredCredential(await activatedFile(), store);
    // The artifact gate is reached after resolving the imported credential.
    await expect(createLocalX402Agent({ stateDirectory: '/operator/a', environment: {}, credentialStore: store }))
      .rejects.toThrow('pinned proving bundle');
  });

  it('does not fall back to a browser export when no credential is stored', async () => {
    await expect(createLocalX402Agent({ stateDirectory: '/operator/a', environment: { ZK_CREDITS_CREDENTIAL_PATH: '/tmp/export.json' }, credentialStore: memoryStore() }))
      .rejects.toThrow('No credential in OS storage');
  });

  it('stops before proving if the OS denies credential access', async () => {
    const store: CredentialStore = { read: async () => { throw new Error('OS access denied'); }, write: async () => {} };
    await expect(createLocalX402Agent({ stateDirectory: '/operator/a', environment: {}, credentialStore: store }))
      .rejects.toThrow('OS access denied');
  });
});
