/**
 * Redaction for everything the launch system prints or persists.
 *
 * The launch system handles founder credentials, so it is written so that a
 * secret cannot reach a log line or the state file by accident. Every value on
 * its way out passes one of the two functions here: `redact` for text that a
 * human reads, and `findSecrets` for a structural check that refuses a state
 * file outright.
 *
 * The patterns describe the shapes the providers actually issue, so a leaked
 * credential is caught by what it looks like rather than by remembering which
 * variable it came from.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface SecretPattern {
  /** Short label used in the refusal message. */
  name: string;
  source: string;
  flags: string;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'evm_private_key', source: '\\b0x[0-9a-fA-F]{64}\\b', flags: 'g' },
  { name: 'openrouter_key', source: 'sk-or-v1-[A-Za-z0-9_-]{8,}', flags: 'g' },
  { name: 'github_token', source: '\\bgh[opsur]_[A-Za-z0-9]{20,}\\b', flags: 'g' },
  { name: 'npm_token', source: '\\bnpm_[A-Za-z0-9]{20,}\\b', flags: 'g' },
  { name: 'neon_key', source: '\\bnapi_[A-Za-z0-9_-]{16,}\\b', flags: 'g' },
  { name: 'render_key', source: '\\brnd_[A-Za-z0-9_-]{16,}\\b', flags: 'g' },
  { name: 'vercel_token', source: '\\b(?:vercel|vc)_[A-Za-z0-9]{20,}\\b', flags: 'g' },
  { name: 'pem_private_key', source: '-----BEGIN[^-]*PRIVATE KEY-----', flags: 'g' },
  // A connection string only matters when it carries credentials.
  { name: 'postgres_credential_url', source: 'postgres(?:ql)?://[^\\s:@/]+:[^\\s@/]+@\\S+', flags: 'g' },
  { name: 'https_basic_auth_url', source: 'https://[^\\s:@/]+:[^\\s@/]+@\\S+', flags: 'g' },
];

const REDACTION = '[redacted]';

function fresh(pattern: SecretPattern): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

/** Replaces every secret-shaped substring. Safe to call on output text. */
export function redact(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) result = result.replace(fresh(pattern), REDACTION);
  return result;
}

/**
 * Names every secret shaped value found anywhere in a structure, including in
 * string leaves only. Object *keys* are reported too, so a key named
 * `privateKey` cannot be smuggled into the state file.
 */
export function findSecrets(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const pattern of SECRET_PATTERNS) {
        if (fresh(pattern).test(item)) found.add(pattern.name);
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        for (const pattern of SECRET_PATTERNS) {
          if (fresh(pattern).test(key)) found.add(pattern.name);
        }
        visit(child);
      }
    }
  };
  visit(value);
  return [...found].sort();
}

/**
 * Refuses a value that still carries a secret. Used at the state-file boundary,
 * where the guarantee has to hold rather than be hoped for.
 */
export function assertSecretFree(value: unknown, label: string): void {
  const found = findSecrets(value);
  if (found.length > 0) throw new Error(`${label} would carry a secret (${found.join(', ')})`);
}
