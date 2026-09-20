import { describe, expect, it } from 'vitest';
import {
  FUNDED_TIER_ID,
  computeCommitment,
  createCredential,
  createRecoveryCapsuleFile,
  decryptAnyCredentialExport,
  encryptCredentialExport,
  generateSecret,
  openRecoveryCapsule,
  secretToBase64Url,
  verifyActivatedCredential,
  verifyRecoveryCapsule,
  wrapActivatedCredential,
} from './base.js';

const PASSWORD = 'correct horse battery staple';
const FIXTURE_EXPIRY = 1_800_000_000;
const FIXTURE_DOMAIN = '84532';
const CONTRACT = '0x0000000000000000000000000000000000000001';
const NETWORK = 'eip155:84532';

async function capsuleFixture() {
  const secret = generateSecret();
  const file = await createRecoveryCapsuleFile(secret, PASSWORD);
  return { secret, file, commitment: await computeCommitment(secret) };
}

describe('version-2 recovery capsule and activated credential', () => {
  it('encrypts only the locally generated secret and re-imports it before funding', async () => {
    const { secret, file, commitment } = await capsuleFixture();
    expect(file.format).toBe('zk-credits-credential');
    expect(file.version).toBe(2);
    expect(file.kind).toBe('recovery-capsule');
    expect(file.capsule.algorithm).toBe('PBKDF2-AES-GCM');
    expect(JSON.stringify(file)).not.toContain(secretToBase64Url(secret));

    const reopened = await verifyRecoveryCapsule(file, PASSWORD);
    expect(secretToBase64Url(reopened.secret)).toBe(secretToBase64Url(secret));
    expect(reopened.commitment).toBe(commitment);
  });

  it('rejects a wrong password and a tampered capsule ciphertext', async () => {
    const { file } = await capsuleFixture();
    await expect(verifyRecoveryCapsule(file, 'wrong password')).rejects.toThrow(/invalid/u);
    const tampered = { ...file, capsule: { ...file.capsule, ciphertext: `${file.capsule.ciphertext.slice(0, -2)}aa` } };
    await expect(verifyRecoveryCapsule(tampered, PASSWORD)).rejects.toThrow(/invalid|malformed/u);
    await expect(openRecoveryCapsule({ ...file.capsule, version: 1 as never }, PASSWORD)).rejects.toThrow(/Unsupported/u);
  });

  it('wraps the same encrypted capsule with authoritative funding metadata after funding', async () => {
    const { file, commitment, secret } = await capsuleFixture();
    const activated = wrapActivatedCredential(file.capsule, {
      commitment,
      tierId: FUNDED_TIER_ID,
      expiry: FIXTURE_EXPIRY,
      deploymentDomain: FIXTURE_DOMAIN,
      network: NETWORK,
      contractAddress: CONTRACT,
      transactionHash: '0xabc',
    });
    expect(activated.capsule).toBe(file.capsule);
    expect(activated.kind).toBe('activated-credential');

    const credential = await verifyActivatedCredential(activated, PASSWORD);
    expect(credential.secret).toBe(secretToBase64Url(secret));
    expect(credential.commitment).toBe(commitment);
    expect(credential.tierId).toBe(FUNDED_TIER_ID);
    expect(credential.expiry).toBe(FIXTURE_EXPIRY);
    expect(credential.deploymentDomain).toBe(FIXTURE_DOMAIN);
  });

  it('rejects activation metadata that does not match the local secret', async () => {
    const { file, commitment } = await capsuleFixture();
    const activation = {
      commitment,
      tierId: FUNDED_TIER_ID,
      expiry: FIXTURE_EXPIRY,
      deploymentDomain: FIXTURE_DOMAIN,
      network: NETWORK,
      contractAddress: CONTRACT,
      transactionHash: '0xabc',
    };
    const otherCommitment = await computeCommitment(generateSecret());
    const mismatched = wrapActivatedCredential(file.capsule, { ...activation, commitment: otherCommitment });
    await expect(verifyActivatedCredential(mismatched, PASSWORD)).rejects.toThrow(/commitment/u);

    expect(() => wrapActivatedCredential(file.capsule, { ...activation, tierId: 1 })).toThrow(/tier/u);
    expect(() => wrapActivatedCredential(file.capsule, { ...activation, expiry: 0 })).toThrow(/malformed/u);
    expect(() => wrapActivatedCredential(file.capsule, { ...activation, contractAddress: '' })).toThrow(/malformed/u);
    expect(() => wrapActivatedCredential(file.capsule, { ...activation, network: '' })).toThrow(/malformed/u);
    expect(() => wrapActivatedCredential(file.capsule, { ...activation, transactionHash: '' })).toThrow(/malformed/u);
  });

  it('keeps accepting version-1 activated exports', async () => {
    const secret = generateSecret();
    const credential = await createCredential(secret, FUNDED_TIER_ID, FIXTURE_EXPIRY, FIXTURE_DOMAIN);
    const encrypted = await encryptCredentialExport(credential, PASSWORD);
    const v1File = { format: 'zk-credits-credential', version: 1, encrypted };
    expect(await decryptAnyCredentialExport(v1File, PASSWORD)).toEqual(credential);
  });

  it('recovers a credential from either export version', async () => {
    const { file, commitment } = await capsuleFixture();
    const activated = wrapActivatedCredential(file.capsule, {
      commitment,
      tierId: FUNDED_TIER_ID,
      expiry: FIXTURE_EXPIRY,
      deploymentDomain: FIXTURE_DOMAIN,
      network: NETWORK,
      contractAddress: CONTRACT,
      transactionHash: '0xabc',
    });
    const credential = await decryptAnyCredentialExport(activated, PASSWORD);
    expect(credential.commitment).toBe(commitment);
    await expect(decryptAnyCredentialExport(activated, 'wrong password')).rejects.toThrow(/invalid/u);
    await expect(decryptAnyCredentialExport({ format: 'zk-credits-credential', version: 1 }, PASSWORD)).rejects.toThrow(/Unsupported|malformed/u);
    await expect(decryptAnyCredentialExport(null, PASSWORD)).rejects.toThrow(/Unsupported|malformed/u);
  });
});
