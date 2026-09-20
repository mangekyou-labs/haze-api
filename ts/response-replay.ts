/**
 * Hybrid-encrypts a response for the public key carried in a zk-prepaid
 * payload. The gateway stores only this envelope, never plaintext model
 * output or prompts.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';

/** Maximum plaintext provider response retained for replay. */
export const MAX_REPLAY_BYTES = 1 * 1024 * 1024;
/** Base64url envelope overhead is bounded separately from provider bytes. */
export const MAX_ENCRYPTED_REPLAY_BYTES = 2 * MAX_REPLAY_BYTES;
export const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function decodePublicKey(value: string): string | Buffer {
  if (value.includes('BEGIN PUBLIC KEY')) return value;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < 32) throw new Error('response_key_invalid');
  return decoded;
}

export interface EncryptedReplayEnvelope {
  version: 1;
  algorithm: 'RSA-OAEP-256/AES-256-GCM';
  key: string;
  iv: string;
  tag: string;
  ciphertext: string;
  expiresAt: number;
  contentType: string;
  status: number;
}

/** Returns undefined when a response is too large for the bounded replay cache. */
export function encryptResponseReplay(
  responseKey: string,
  body: Uint8Array,
  metadata: { contentType: string; status: number; now?: number },
): string | undefined {
  if (body.byteLength > MAX_REPLAY_BYTES) return undefined;
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(body)), cipher.final()]);
  const key = publicEncrypt({ key: decodePublicKey(responseKey), oaepHash: 'sha256' }, aesKey);
  const envelope: EncryptedReplayEnvelope = {
    version: 1,
    algorithm: 'RSA-OAEP-256/AES-256-GCM',
    key: base64Url(key),
    iv: base64Url(iv),
    tag: base64Url(cipher.getAuthTag()),
    ciphertext: base64Url(ciphertext),
    expiresAt: (metadata.now ?? Date.now()) + REPLAY_TTL_MS,
    contentType: metadata.contentType,
    status: metadata.status,
  };
  return JSON.stringify(envelope);
}
