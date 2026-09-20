import { describe, expect, it } from 'vitest';
import {
  BASE_MEMBERSHIP_TREE_DEPTH,
  BN254_FIELD_ORDER,
  FUNDED_SLOT_ALLOWANCE,
  FUNDED_TIER_ID,
  REQUEST_SIGNAL_DOMAIN_TAG,
  computeCommitment,
  computeCreditLeaf,
  computeNullifier,
  computeShare,
  computeSlotBlinding,
  createCredential,
  decryptCredentialExport,
  deriveRequestSignal,
  deriveSparseCreditWitness,
  encryptCredentialExport,
  generateSecret,
  poseidonHash,
  recoverSecret,
  recoverSlotBlinding,
  secretToBase64Url,
  secretToField,
} from './base.js';

const FIXTURE_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const FIXTURE_SLOT = 7;
const FIXTURE_DOMAIN = '1234';
const FIXTURE_EXPIRY = 1_800_000_000;
/** Independent circomlibjs Poseidon(secret, 7, 1234) over BN254. */
const FIXTURE_SLOT_BLINDING = '1911812699644766498332168042239771660199295119298035647216180696157284158486';
/** Independent circomlibjs Poseidon(slotBlinding). */
const FIXTURE_NULLIFIER = '3018868336897366874189054800414760262860200660079775010062207867762743153602';
/** secret + slotBlinding * 42 (mod p). */
const FIXTURE_SHARE_42 = '15087272125883058474721785515802992066115338196419013289149161861593245981369';
/** secret + slotBlinding * 99 (mod p). */
const FIXTURE_SHARE_99 = '14619381646438372768423335197183601254733337994326873461980440609679400536986';
/** Rejected share = secret * 42 + Poseidon(secret, slot, domain). */
const REJECTED_SHARE_42 = '21058241665113797381749857097424891002580823379582039408111958370176230254422';
const FIXTURE_COMMITMENT = '8687213900595150509063186631634067671233157784124627437219499552928422827997';
const FIXTURE_LEAF_TIER0 = '12992319314469106065811618978512789981623859879058485908347559722389823331150';

describe('Base private-credit primitives', () => {
  it('uses a depth-20 tree and a single funded 250-slot tier', () => {
    expect(BASE_MEMBERSHIP_TREE_DEPTH).toBe(20);
    expect(FUNDED_TIER_ID).toBe(0);
    expect(FUNDED_SLOT_ALLOWANCE).toBe(250);
  });

  it('restores slot-blinding algebra against independent Poseidon literals', async () => {
    expect(await computeCommitment(FIXTURE_SECRET)).toBe(FIXTURE_COMMITMENT);
    const slotBlinding = await computeSlotBlinding(FIXTURE_SECRET, FIXTURE_SLOT, FIXTURE_DOMAIN);
    expect(slotBlinding).toBe(FIXTURE_SLOT_BLINDING);
    expect(await computeNullifier(slotBlinding)).toBe(FIXTURE_NULLIFIER);
    expect(await computeShare(FIXTURE_SECRET, '42', slotBlinding)).toBe(FIXTURE_SHARE_42);
    expect(await computeShare(FIXTURE_SECRET, '99', slotBlinding)).toBe(FIXTURE_SHARE_99);
    expect(FIXTURE_SHARE_42).not.toBe(REJECTED_SHARE_42);
    expect(await computeCreditLeaf(FIXTURE_COMMITMENT, FUNDED_TIER_ID, FIXTURE_EXPIRY)).toBe(FIXTURE_LEAF_TIER0);
  });

  it('rejects Poseidon inputs outside the BN254 field instead of wrapping', async () => {
    await expect(poseidonHash([BN254_FIELD_ORDER])).rejects.toThrow(/Poseidon input/u);
    await expect(poseidonHash([-1n])).rejects.toThrow(/Poseidon input/u);
  });

  it('rejects a zero request signal, a zero slot blinding, and a slot at or above the funded allowance', async () => {
    await expect(computeShare(FIXTURE_SECRET, '0', FIXTURE_SLOT_BLINDING)).rejects.toThrow(/signal/u);
    await expect(computeNullifier('0')).rejects.toThrow(/blinding/u);
    await expect(computeSlotBlinding(FIXTURE_SECRET, FUNDED_SLOT_ALLOWANCE, FIXTURE_DOMAIN)).rejects.toThrow(/slot/u);
    await expect(computeCreditLeaf(FIXTURE_COMMITMENT, 1, FIXTURE_EXPIRY)).rejects.toThrow(/tier/u);
  });

  it('recovers slot blinding then secret from two transcripts and not from one', async () => {
    const slotBlinding = await computeSlotBlinding(FIXTURE_SECRET, FIXTURE_SLOT, FIXTURE_DOMAIN);
    const recoveredBlinding = recoverSlotBlinding(FIXTURE_SHARE_42, FIXTURE_SHARE_99, '42', '99');
    expect(recoveredBlinding).toBe(slotBlinding);
    expect(recoverSecret(FIXTURE_SHARE_42, recoveredBlinding, '42')).toBe(secretToField(FIXTURE_SECRET));
    expect(FIXTURE_SHARE_42).not.toBe(secretToField(FIXTURE_SECRET));
    expect(FIXTURE_SHARE_42).not.toBe(slotBlinding);
    expect(() => recoverSlotBlinding(FIXTURE_SHARE_42, FIXTURE_SHARE_42, '42', '42')).toThrow(/signal/u);
  });

  it('binds a domain-separated length-prefixed request signal to exact body bytes and RFC 8785 requirements', async () => {
    expect(REQUEST_SIGNAL_DOMAIN_TAG).toBe('zk-prepaid-request-signal-v1');
    const encoder = new TextEncoder();
    const body = encoder.encode('{"model":"demo","messages":[{"content":"private"}]}');
    const reorderedBody = encoder.encode('{"messages":[{"content":"private"}],"model":"demo"}');
    const base = {
      method: 'post',
      url: 'https://api.example.test/v1/chat/completions',
      body,
      requirements: { scheme: 'zk-prepaid', amount: '1' },
      nonce: '0123456789abcdef',
      responseKey: 'ed25519-public-key',
    };
    const first = await deriveRequestSignal(base);
    expect(first.field).toMatch(/^\d+$/u);
    expect(BigInt(first.field)).not.toBe(0n);
    expect((await deriveRequestSignal({ ...base, method: 'POST' })).field).toBe(first.field);
    expect((await deriveRequestSignal({ ...base, requirements: { amount: '1', scheme: 'zk-prepaid' } })).field).toBe(first.field);
    expect((await deriveRequestSignal({ ...base, body: reorderedBody })).field).not.toBe(first.field);
    expect((await deriveRequestSignal({ ...base, nonce: 'fedcba9876543210' })).field).not.toBe(first.field);
    expect((await deriveRequestSignal({ ...base, responseKey: 'another-key' })).field).not.toBe(first.field);

    const empty = new Uint8Array();
    const requirements = { scheme: 'zk-prepaid' };
    const ab = await deriveRequestSignal({
      method: 'AB',
      url: 'https://example.test/CD',
      body: empty,
      requirements,
      nonce: '0123456789abcdef',
      responseKey: 'k',
    });
    const collision = await deriveRequestSignal({
      method: 'ABC',
      url: 'https://example.test/D',
      body: empty,
      requirements,
      nonce: '0123456789abcdef',
      responseKey: 'k',
    });
    expect(ab.field).not.toBe(collision.field);
  });

  it('round trips a password-encrypted credential and rejects a wrong password or tamper', async () => {
    const secret = generateSecret();
    const credential = await createCredential(secret, FUNDED_TIER_ID, FIXTURE_EXPIRY, FIXTURE_DOMAIN);
    const exported = await encryptCredentialExport(credential, 'correct horse battery staple');
    const recovered = await decryptCredentialExport(exported, 'correct horse battery staple');
    expect(recovered).toEqual(credential);
    await expect(decryptCredentialExport(exported, 'wrong password')).rejects.toThrow(/invalid/u);
    const tampered = { ...exported, ciphertext: `${exported.ciphertext.slice(0, -2)}aa` };
    await expect(decryptCredentialExport(tampered, 'correct horse battery staple')).rejects.toThrow(/invalid|malformed/u);
    expect(secretToBase64Url(secret)).toBe(credential.secret);
    await expect(createCredential(new Uint8Array(32), FUNDED_TIER_ID, FIXTURE_EXPIRY, FIXTURE_DOMAIN)).rejects.toThrow('must not be zero');
    await expect(createCredential(secret, 1, FIXTURE_EXPIRY, FIXTURE_DOMAIN)).rejects.toThrow(/tier/u);
  });

  it('derives a bounded witness from sparse append-only leaves', async () => {
    const witness = await deriveSparseCreditWitness(new Map([[7, '123']]), 7);
    expect(witness.leafIndex).toBe(7);
    expect(witness.pathElements).toHaveLength(BASE_MEMBERSHIP_TREE_DEPTH);
    expect(witness.pathIndices[0]).toBe(1);
    expect(witness.root).toMatch(/^\d+$/u);
  });
});
