import { describe, expect, it } from 'vitest';
import { computeCommitment, createRecoveryCapsuleFile, generateSecret, verifyRecoveryCapsule, wrapActivatedCredential, decryptAnyCredentialExport } from './base.js';

describe('passwordless recovery', () => {
  it('re-imports without a password and rejects a different secret after activation', async () => {
    const secret = generateSecret();
    const file = await createRecoveryCapsuleFile(secret);
    expect(file.version).toBe(3);
    const { commitment } = await verifyRecoveryCapsule(file);
    expect(commitment).toBe(await computeCommitment(secret));
    const activated = wrapActivatedCredential(file.capsule, {
      commitment, tierId: 0, expiry: 1800000000, deploymentDomain: '84532',
      network: 'eip155:84532', contractAddress: '0x0000000000000000000000000000000000000001', transactionHash: '0xabc',
    });
    expect((await decryptAnyCredentialExport(activated)).commitment).toBe(commitment);
    const other = await createRecoveryCapsuleFile(generateSecret());
    await expect(decryptAnyCredentialExport({ ...activated, capsule: other.capsule })).rejects.toThrow(/commitment/);
  });
  it('rejects mismatched versions and malformed secrets', async () => {
    const file = await createRecoveryCapsuleFile(generateSecret());
    await expect(verifyRecoveryCapsule({ ...file, version: 2 })).rejects.toThrow(/Unsupported/);
    await expect(verifyRecoveryCapsule({ ...file, capsule: { version: 3, algorithm: 'plaintext', secret: 'invalid' } } as never)).rejects.toThrow();
    await expect(createRecoveryCapsuleFile(new Uint8Array(31))).rejects.toThrow();
  });
});
