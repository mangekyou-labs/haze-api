/**
 * Redacted logging.
 *
 * The launch prints progress and persists checkpoints while holding founder
 * credentials, so the assertion that matters is negative: a real credential
 * must not survive a trip through the output path, and a state structure that
 * carries one must be refused rather than written.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { SECRET_PATTERNS, assertSecretFree, findSecrets, redact } from './redact.js';

/** One representative value per pattern, so a new pattern cannot be untested. */
const SAMPLES: Record<string, string> = {
  evm_private_key: `0x${'ab'.repeat(32)}`,
  openrouter_key: 'sk-or-v1-abcdefghijklmnop',
  github_token: 'ghp_abcdefghijklmnopqrstuvwx',
  npm_token: 'npm_abcdefghijklmnopqrstuvwx',
  neon_key: 'napi_abcdefghijklmnopqrst',
  render_key: 'rnd_abcdefghijklmnopqrst',
  vercel_token: 'vercel_abcdefghijklmnopqrstuvwx',
  pem_private_key: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----',
  postgres_credential_url: 'postgresql://user:hunter2@db.example.com:5432/zk',
  https_basic_auth_url: 'https://user:hunter2@gateway.example/ready',
};

describe('secret patterns', () => {
  it('has a sample for every declared pattern', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(SECRET_PATTERNS.map((pattern) => pattern.name).sort());
  });

  it('finds every shaped secret wherever it sits in a structure', () => {
    for (const [name, sample] of Object.entries(SAMPLES)) {
      expect(findSecrets({ outer: { inner: [sample] } })).toContain(name);
      expect(findSecrets({ privateKey: 'not-a-secret' }).length).toBe(0);
    }
  });

  it('reports a secret-shaped key even when its value is innocuous', () => {
    expect(findSecrets({ 'sk-or-v1-abcdefghijklmnop': 'placeholder' })).toContain('openrouter_key');
  });
});

describe('redaction', () => {
  it('replaces every shaped secret and leaves ordinary text alone', () => {
    for (const sample of Object.values(SAMPLES)) {
      const line = `connect using ${sample} then continue`;
      const redacted = redact(line);
      expect(redacted).not.toContain(sample);
      expect(redacted).toContain('[redacted]');
      expect(redacted.startsWith('connect using ')).toBe(true);
      expect(redacted.endsWith(' then continue')).toBe(true);
    }
  });

  it('leaves resource identifiers and plain URLs readable, so a log stays useful', () => {
    const useful = 'project zk-credits-pilot id proj_123 at https://gateway.onrender.com/health, block 21000000';
    expect(redact(useful)).toBe(useful);
  });

  it('is safe to apply twice', () => {
    const once = redact(`0x${'cd'.repeat(32)}`);
    expect(redact(once)).toBe(once);
  });
});

describe('the state-file boundary', () => {
  it('refuses a structure that still carries a secret', () => {
    expect(() => assertSecretFree({ steps: { deploy: { detail: { key: SAMPLES.evm_private_key } } } }, 'launch state'))
      .toThrow(/would carry a secret \(evm_private_key\)/u);
  });

  it('accepts the secret-free detail the launch actually records', () => {
    const detail = {
      steps: {
        'hosting:neon': { status: 'succeeded', detail: { projectId: 'proj_123', region: 'aws-ap-southeast-1' } },
        'deploy:contracts': { status: 'succeeded', detail: { contract: 'PrivateCreditBond', block: 21_000_000 } },
        'release:pack': { status: 'succeeded', detail: { digest: 'a'.repeat(64) } },
      },
    };
    expect(() => assertSecretFree(detail, 'launch state')).not.toThrow();
  });
});
