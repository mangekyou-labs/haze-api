// Gateway API key and session management

import crypto from 'crypto';

export interface ApiKeyRecord {
  keyHash: string;
  commitment: string;
  label: string;
  createdAt: number;
  lastUsed: number;
  callCount: number;
}

export interface ZkProofHeader {
  proof: object;
  pubSignals: string[];
}

export function generateApiKey(): string {
  return 'sk-zk-' + crypto.randomBytes(32).toString('hex');
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function parseZkProofHeader(header: string): ZkProofHeader {
  return JSON.parse(Buffer.from(header, 'base64').toString());
}

export function serializeZkProofHeader(proof: object, pubSignals: string[]): string {
  return Buffer.from(JSON.stringify({ proof, pubSignals })).toString('base64');
}
