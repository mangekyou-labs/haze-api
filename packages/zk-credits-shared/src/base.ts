/**
 * Base private-credit primitives.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const BN254_FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const BASE_MEMBERSHIP_TREE_DEPTH = 20;
export const BASE_MEMBERSHIP_TREE_CAPACITY = 2 ** BASE_MEMBERSHIP_TREE_DEPTH;
export const CREDENTIAL_VERSION = 1;
export const FUNDED_TIER_ID = 0;
export const FUNDED_SLOT_ALLOWANCE = 250;
export const REQUEST_SIGNAL_DOMAIN_TAG = 'zk-prepaid-request-signal-v1';

const textEncoder = new TextEncoder();
let poseidonPromise: Promise<{
  (inputs: bigint[]): unknown;
  F: { toObject(value: unknown): bigint | number | string };
}> | undefined;

function mod(value: bigint): bigint {
  const result = value % BN254_FIELD_ORDER;
  return result < 0n ? result + BN254_FIELD_ORDER : result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new Error('Invalid base64url value');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toField(value: bigint | number | string, label: string): bigint {
  let result: bigint;
  try {
    result = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  if (result < 0n || result >= BN254_FIELD_ORDER) throw new Error(`Invalid ${label}`);
  return result;
}

async function poseidon(): Promise<{
  (inputs: bigint[]): unknown;
  F: { toObject(value: unknown): bigint | number | string };
}> {
  if (!poseidonPromise) {
    poseidonPromise = import('circomlibjs').then(async (module) => {
      const { buildPoseidon } = module as unknown as {
        buildPoseidon: () => Promise<{
          (inputs: bigint[]): unknown;
          F: { toObject(value: unknown): bigint | number | string };
        }>;
      };
      return buildPoseidon();
    });
  }
  return poseidonPromise;
}

/** Poseidon over the Circom BN254 field. Out-of-range inputs are rejected, not wrapped. */
export async function poseidonHash(inputs: readonly (bigint | number | string)[]): Promise<string> {
  if (inputs.length === 0) throw new Error('Poseidon requires at least one input');
  const normalized = inputs.map((input, index) => toField(input, `Poseidon input ${index}`));
  const hash = await poseidon();
  return BigInt(hash.F.toObject(hash(normalized))).toString();
}

function modInverse(value: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = BN254_FIELD_ORDER;
  let newR = mod(value);
  if (newR === 0n) throw new Error('Value is not invertible');
  while (newR !== 0n) {
    const quotient = r / newR;
    [t, newT] = [newT, t - quotient * newT];
    [r, newR] = [newR, r - quotient * newR];
  }
  return mod(t);
}

export function generateSecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  if (bytesToBigInt(secret) >= BN254_FIELD_ORDER) return generateSecret();
  return secret;
}

export function secretToField(secret: Uint8Array): string {
  if (secret.length !== 32) throw new Error('Secret must be exactly 32 bytes');
  return toField(bytesToBigInt(secret), 'secret').toString();
}

export function secretFromBase64Url(value: string): Uint8Array {
  const secret = fromBase64Url(value);
  if (secret.length !== 32) throw new Error('Credential secret must be exactly 32 bytes');
  toField(bytesToBigInt(secret), 'credential secret');
  return secret;
}

export function secretToBase64Url(secret: Uint8Array): string {
  if (secret.length !== 32) throw new Error('Secret must be exactly 32 bytes');
  return toBase64Url(secret);
}

export async function computeCommitment(secret: Uint8Array): Promise<string> {
  return poseidonHash([secretToField(secret)]);
}

export async function computeCreditLeaf(
  commitment: string,
  tierId: number,
  expiry: number,
): Promise<string> {
  if (!Number.isSafeInteger(tierId) || tierId !== FUNDED_TIER_ID) throw new Error('Invalid tier id');
  if (!Number.isSafeInteger(expiry) || expiry <= 0) throw new Error('Invalid expiry');
  return poseidonHash([toField(commitment, 'commitment'), tierId, expiry]);
}

export async function computeSlotBlinding(
  secret: Uint8Array,
  slot: number,
  deploymentDomain: string,
): Promise<string> {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= FUNDED_SLOT_ALLOWANCE) throw new Error('Invalid slot');
  return poseidonHash([secretToField(secret), slot, toField(deploymentDomain, 'deployment domain')]);
}

export async function computeNullifier(slotBlinding: string): Promise<string> {
  const blinding = toField(slotBlinding, 'slot blinding');
  if (blinding === 0n) throw new Error('Slot blinding must not be zero');
  return poseidonHash([blinding]);
}

export async function computeShare(
  secret: Uint8Array,
  signal: string,
  slotBlinding: string,
): Promise<string> {
  const signalField = toField(signal, 'signal');
  if (signalField === 0n) throw new Error('Request signal must not be zero');
  const secretField = toField(secretToField(secret), 'secret');
  const blinding = toField(slotBlinding, 'slot blinding');
  if (blinding === 0n) throw new Error('Slot blinding must not be zero');
  return mod(secretField + blinding * signalField).toString();
}

export function recoverSlotBlinding(
  share1: string,
  share2: string,
  signal1: string,
  signal2: string,
): string {
  const x1 = toField(signal1, 'signal');
  const x2 = toField(signal2, 'signal');
  if (x1 === x2) throw new Error('Conflicting transcripts require different request signals');
  const s1 = toField(share1, 'share');
  const s2 = toField(share2, 'share');
  return mod((s1 - s2) * modInverse(x1 - x2)).toString();
}

export function recoverSecret(share: string, slotBlinding: string, signal: string): string {
  const x = toField(signal, 'signal');
  if (x === 0n) throw new Error('Request signal must not be zero');
  return mod(toField(share, 'share') - toField(slotBlinding, 'slot blinding') * x).toString();
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function canonicalValue(value: unknown, path = '$'): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalValue(record[key], `${path}.${key}`)]),
    );
  }
  throw new Error(`Unsupported value at ${path}`);
}

export function canonicalizeBaseJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', value as unknown as BufferSource));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** RFC 8785 JSON Canonicalization Scheme for JSON values. */
export function canonicalizeRfc8785(value: unknown, path = '$'): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalizeRfc8785(item, `${path}[${index}]`)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeRfc8785(record[key], `${path}.${key}`)}`).join(',')}}`;
  }
  throw new Error(`Unsupported value at ${path}`);
}

function lengthPrefixed(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += 4 + part.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.length, false);
    offset += 4;
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function requireAbsoluteHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Request URL must be absolute');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Request URL must be absolute');
  }
}

export interface RequestSignalInput {
  method: string;
  url: string;
  body: Uint8Array;
  requirements: unknown;
  nonce: string;
  responseKey: string;
}

export interface RequestSignal {
  canonical: string;
  digest: string;
  field: string;
}

/** Domain-separated SHA-256 hash-to-BN254 of length-prefixed request binding inputs. */
export async function deriveRequestSignal(input: RequestSignalInput): Promise<RequestSignal> {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(input.nonce)) throw new Error('Invalid request nonce');
  if (!input.responseKey) throw new Error('Response encryption key is required');
  if (!(input.body instanceof Uint8Array)) throw new Error('Request body must be the exact bytes sent');
  requireAbsoluteHttpUrl(input.url);
  const method = textEncoder.encode(input.method.toUpperCase());
  const url = textEncoder.encode(input.url);
  const bodyHash = await sha256Bytes(input.body);
  const requirementsCanonical = canonicalizeRfc8785(input.requirements);
  const requirementsHash = await sha256Bytes(textEncoder.encode(requirementsCanonical));
  const nonce = textEncoder.encode(input.nonce);
  const responseKey = textEncoder.encode(input.responseKey);
  const domain = textEncoder.encode(REQUEST_SIGNAL_DOMAIN_TAG);
  const payload = lengthPrefixed([domain, method, url, bodyHash, requirementsHash, nonce, responseKey]);
  const digestBytes = await sha256Bytes(payload);
  const field = bytesToBigInt(digestBytes) % BN254_FIELD_ORDER;
  if (field === 0n) throw new Error('Request signal must not be zero');
  return { canonical: requirementsCanonical, digest: hex(digestBytes), field: field.toString() };
}

export interface CreditCredential {
  version: typeof CREDENTIAL_VERSION;
  secret: string;
  commitment: string;
  tierId: number;
  expiry: number;
  deploymentDomain: string;
}

export interface EncryptedCredentialExport {
  version: typeof CREDENTIAL_VERSION;
  algorithm: 'PBKDF2-AES-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
}

function validateCredentialShape(credential: Partial<CreditCredential>): CreditCredential {
  if (
    credential.version !== CREDENTIAL_VERSION
    || typeof credential.secret !== 'string'
    || typeof credential.commitment !== 'string'
    || typeof credential.tierId !== 'number'
    || !Number.isSafeInteger(credential.tierId)
    || typeof credential.expiry !== 'number'
    || !Number.isSafeInteger(credential.expiry)
    || credential.expiry <= 0
    || typeof credential.deploymentDomain !== 'string'
  ) {
    throw new Error('Credential export is malformed');
  }
  if (credential.tierId !== FUNDED_TIER_ID) throw new Error('Invalid tier id');
  const secret = secretFromBase64Url(credential.secret);
  if (secretToField(secret) === '0') throw new Error('Credential secret must not be zero');
  const commitment = toField(credential.commitment, 'credential commitment').toString();
  const deploymentDomain = toField(credential.deploymentDomain, 'deployment domain').toString();
  return {
    version: CREDENTIAL_VERSION,
    secret: secretToBase64Url(secret),
    commitment,
    tierId: credential.tierId,
    expiry: credential.expiry,
    deploymentDomain,
  };
}

function requirePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Credential export password must contain at least 12 characters');
  }
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function createCredential(
  secret: Uint8Array,
  tierId: number,
  expiry: number,
  deploymentDomain: string,
): Promise<CreditCredential> {
  const credential: CreditCredential = {
    version: CREDENTIAL_VERSION,
    secret: secretToBase64Url(secret),
    commitment: await computeCommitment(secret),
    tierId,
    expiry,
    deploymentDomain: toField(deploymentDomain, 'deployment domain').toString(),
  };
  return validateCredentialShape(credential);
}

/** Encrypts the credential locally; the returned value is safe to download, not to log. */
export async function encryptCredentialExport(
  credential: CreditCredential,
  password: string,
): Promise<EncryptedCredentialExport> {
  requirePassword(password);
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: asArrayBuffer(salt), iterations: 310_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const plaintext = textEncoder.encode(canonicalizeBaseJson(credential));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv) }, key, plaintext));
  return { version: CREDENTIAL_VERSION, algorithm: 'PBKDF2-AES-GCM', salt: toBase64Url(salt), iv: toBase64Url(iv), ciphertext: toBase64Url(ciphertext) };
}

export async function decryptCredentialExport(
  exported: EncryptedCredentialExport,
  password: string,
): Promise<CreditCredential> {
  requirePassword(password);
  if (exported.version !== CREDENTIAL_VERSION || exported.algorithm !== 'PBKDF2-AES-GCM') {
    throw new Error('Unsupported credential export');
  }
  const salt = fromBase64Url(exported.salt);
  const iv = fromBase64Url(exported.iv);
  const ciphertext = fromBase64Url(exported.ciphertext);
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: asArrayBuffer(salt), iterations: 310_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv) }, key, asArrayBuffer(ciphertext));
  } catch {
    throw new Error('Credential export password or ciphertext is invalid');
  }
  let parsed: Partial<CreditCredential>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<CreditCredential>;
  } catch {
    throw new Error('Credential export is malformed');
  }
  const credential = validateCredentialShape(parsed);
  const secret = secretFromBase64Url(credential.secret);
  if (await computeCommitment(secret) !== credential.commitment) throw new Error('Credential commitment mismatch');
  return credential;
}

export interface MerkleWitness {
  root: string;
  leafIndex: number;
  pathElements: string[];
  pathIndices: number[];
}

/**
 * Creates a depth-20 witness from sparse append-only leaves. Missing nodes are
 * the contract's deterministic zero subtrees, so local event synchronization
 * does not need to allocate a million-element array for every request.
 */
export async function deriveSparseCreditWitness(
  leaves: ReadonlyMap<number, string>,
  leafIndex: number,
): Promise<MerkleWitness> {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= BASE_MEMBERSHIP_TREE_CAPACITY) {
    throw new Error('Invalid leaf index');
  }
  const nodes = new Map<number, string>();
  for (const [index, leaf] of leaves) {
    if (!Number.isInteger(index) || index < 0 || index >= BASE_MEMBERSHIP_TREE_CAPACITY) throw new Error('Invalid sparse leaf index');
    nodes.set(index, toField(leaf, `leaf ${index}`).toString());
  }
  if (!nodes.has(leafIndex)) throw new Error('Sparse leaves do not contain the requested leaf');

  const zeroHashes: string[] = ['0'];
  for (let level = 0; level < BASE_MEMBERSHIP_TREE_DEPTH; level += 1) {
    zeroHashes.push(await poseidonHash([zeroHashes[level]! , zeroHashes[level]! ]));
  }

  const pathElements: string[] = [];
  const pathIndices: number[] = [];
  let currentIndex = leafIndex;
  let currentNodes = nodes;
  for (let level = 0; level < BASE_MEMBERSHIP_TREE_DEPTH; level += 1) {
    pathIndices.push(currentIndex & 1);
    pathElements.push(currentNodes.get(currentIndex ^ 1) ?? zeroHashes[level]!);

    const parentIndices = new Set<number>();
    for (const index of currentNodes.keys()) parentIndices.add(Math.floor(index / 2));
    const parents = new Map<number, string>();
    for (const parentIndex of parentIndices) {
      const left = currentNodes.get(parentIndex * 2) ?? zeroHashes[level]!;
      const right = currentNodes.get(parentIndex * 2 + 1) ?? zeroHashes[level]!;
      parents.set(parentIndex, await poseidonHash([left, right]));
    }
    currentNodes = parents;
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    root: currentNodes.get(0) ?? zeroHashes[BASE_MEMBERSHIP_TREE_DEPTH]!,
    leafIndex,
    pathElements,
    pathIndices,
  };
}
