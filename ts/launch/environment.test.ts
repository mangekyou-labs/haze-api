/**
 * Launch environment validation, permissions, and the plane boundary.
 *
 * The assertions that carry weight are the refusals: custody keys and operator
 * secrets never enter the launch environment, requirements are staged so a
 * preflight does not demand a credential that cannot exist yet, and the three
 * operator ids must be three distinct people.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { chmod, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORBIDDEN_LAUNCH_VARS,
  OPERATOR_GITHUB_ID_VARS,
  checkLaunchEnv,
  generateSecret,
  parseEnvFile,
  prepareLaunchEnvFile,
  requirePasswordFile,
  validateShape,
  writeLaunchEnvValue,
  type GitProbe,
} from './environment.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function sandbox(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-launch-env-'));
  directories.push(directory);
  return directory;
}

const ADDRESS = '0x1111111111111111111111111111111111111111';
const SPONSOR = `0x${'cd'.repeat(32)}`;

/** A fully populated environment for the activation stage. */
function completeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NPM_TOKEN: 'npm_abcdefghijklmnopqrstuvwx',
    PILOT_RELEASE_REVIEWED: 'true',
    BASE_RPC_URL: 'https://base-sepolia.g.alchemy.com/v2/abc',
    BASE_DEPLOYMENT_DOMAIN: '84532',
    BASE_USDC_ADDRESS: ADDRESS,
    BASE_DEPLOYER_KEYSTORE_ACCOUNT: 'pilot-deployer',
    BASE_DEPLOYER_PASSWORD_FILE: '/tmp/foundry-password',
    BASE_TREASURY_ADDRESS: ADDRESS,
    BASE_REFUND_VAULT: '0x2222222222222222222222222222222222222222',
    BASE_SPONSOR_PRIVATE_KEY: SPONSOR,
    BASE_SPEND_VERIFIER_ADDRESS: '0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD',
    BASESCAN_API_KEY: 'abcdefghijklmnopqrstuvwx',
    BASE_SPONSOR_ADDRESS: '0x3333333333333333333333333333333333333333',
    BASE_POSEIDON_T2_ADDRESS: '0x4444444444444444444444444444444444444444',
    BASE_POSEIDON_T3_ADDRESS: '0x5555555555555555555555555555555555555555',
    BASE_POSEIDON_T4_ADDRESS: '0x6666666666666666666666666666666666666666',
    BASE_BOND_ADDRESS: '0x7777777777777777777777777777777777777777',
    BASE_BOND_DEPLOYMENT_BLOCK: '123',
    BASE_CONFIRMATIONS: '3',
    BASE_PRIVATE_CREDIT_BOND_ADDRESS: '0x7777777777777777777777777777777777777777',
    BASE_DEPLOYMENT_BLOCK: '123',
    NEON_API_KEY: 'napi_abcdefghijklmnopqrstuvwx',
    RENDER_API_KEY: 'rnd_abcdefghijklmnopqrstuvwx',
    RENDER_OWNER_ID: 'tea-abcdefghijklmnop',
    VERCEL_TOKEN: 'vercel_abcdefghijklmnopqrstuvwx',
    OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijklmnop',
    PILOT_OPERATOR_A_GITHUB_ID: '1001',
    PILOT_OPERATOR_B_GITHUB_ID: '1002',
    PILOT_OPERATOR_C_GITHUB_ID: '1003',
    GITHUB_CLIENT_ID: 'Iv1.abcdef123456',
    GITHUB_CLIENT_SECRET: 'abcdefghijklmnopqrstuvwx',
    ...overrides,
  };
}

describe('env file parsing', () => {
  it('keeps real values and skips comments, blanks, and malformed lines', () => {
    const values = parseEnvFile([
      '# a comment',
      'BASE_RPC_URL=https://example.test/rpc',
      '',
      'QUOTED="a value with spaces"',
      'NOT_A_LINE',
      '1INVALID=skipped',
      '  SPACED = trimmed  ',
    ].join('\n'));
    expect(values).toEqual({
      BASE_RPC_URL: 'https://example.test/rpc',
      QUOTED: 'a value with spaces',
      SPACED: 'trimmed',
    });
  });

  it('generates a fresh, non-trivial secret each time', () => {
    const first = generateSecret();
    expect(first.length).toBeGreaterThanOrEqual(42);
    expect(generateSecret()).not.toBe(first);
  });
});

describe('value shapes', () => {
  it('refuses placeholders and unresolved templates', () => {
    for (const placeholder of ['0x...', 'todo', 'replace-with-a-token', '<address>', '']) {
      expect(validateShape(placeholder, 'address')).toBeDefined();
    }
  });

  it('refuses the shared public Base Sepolia endpoint', () => {
    expect(validateShape('https://sepolia.base.org', 'rpc_url')).toMatch(/shared public endpoint/u);
    expect(validateShape('https://alchemy.example/v2/key', 'rpc_url')).toBeUndefined();
  });

  it('requires a keystore account name rather than a raw key', () => {
    expect(validateShape('pilot-deployer', 'keystore_account')).toBeUndefined();
    expect(validateShape(SPONSOR, 'keystore_account')).toMatch(/keystore account name/u);
  });

  it('requires a numeric GitHub account id', () => {
    expect(validateShape('4242', 'github_id')).toBeUndefined();
    expect(validateShape('octocat', 'github_id')).toMatch(/numeric/u);
  });

  it('refuses the zero address so a placeholder cannot pass as a real one', () => {
    expect(validateShape(`0x${'0'.repeat(40)}`, 'address')).toMatch(/zero address/u);
  });
});

describe('staged requirements', () => {
  it('accepts the full environment at the activation stage', () => {
    const check = checkLaunchEnv(completeEnv(), 'activation');
    expect(check.missing).toEqual([]);
    expect(check.invalid).toEqual([]);
    expect(check.forbidden).toEqual([]);
    expect(check.deferred).toEqual([]);
  });

  it('does not demand a later stage\'s credentials at an earlier stage', () => {
    const check = checkLaunchEnv({ NPM_TOKEN: 'npm_abcdefghijklmnopqrstuvwx', PILOT_RELEASE_REVIEWED: 'true' }, 'release');
    expect(check.missing).toEqual([]);
    // The Base, hosting, and operator credentials are all still ahead.
    expect(check.deferred.map((variable) => variable.name)).toContain('BASE_RPC_URL');
    expect(check.deferred.map((variable) => variable.name)).toContain('NEON_API_KEY');
    expect(check.deferred.map((variable) => variable.name)).toContain('PILOT_OPERATOR_A_GITHUB_ID');
  });

  it('defers the OAuth pair until the deployed host can produce a callback URL', () => {
    const check = checkLaunchEnv(completeEnv({ GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' }), 'activation');
    expect(check.missing.map((variable) => variable.name)).toEqual(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']);
    expect(check.missing.every((variable) => variable.deferred === true)).toBe(true);
  });

  it('reports an invalid value rather than treating it as present', () => {
    const check = checkLaunchEnv(completeEnv({ BASE_TREASURY_ADDRESS: '0x...' }), 'activation');
    expect(check.invalid).toContainEqual({ name: 'BASE_TREASURY_ADDRESS', reason: 'still a placeholder' });
    expect(check.satisfied).not.toContain('BASE_TREASURY_ADDRESS');
  });
});

describe('the plane boundary', () => {
  it('refuses every custody and operator variable', () => {
    for (const name of FORBIDDEN_LAUNCH_VARS) {
      const check = checkLaunchEnv({ [name]: 'anything' }, 'release');
      expect(check.forbidden).toContain(name);
    }
  });

  it('keeps the three operator ids distinct', () => {
    const duplicated = checkLaunchEnv(completeEnv({
      PILOT_OPERATOR_B_GITHUB_ID: '1001',
    }), 'activation');
    expect(duplicated.invalid).toContainEqual({
      name: OPERATOR_GITHUB_ID_VARS.join('/'),
      reason: 'the three operator GitHub ids must be distinct',
    });
  });

  it('does not apply the distinctness rule before the operator stage', () => {
    const check = checkLaunchEnv({ NPM_TOKEN: 'npm_abcdefghijklmnopqrstuvwx' }, 'release');
    expect(check.invalid).toEqual([]);
  });
});

describe('permissions', () => {
  const permissive: GitProbe = { isIgnored: async () => true, isTracked: async () => false };

  it('creates the env file at mode 0600', async () => {
    const directory = await sandbox();
    const path = join(directory, '.env.launch.local');
    await prepareLaunchEnvFile(path, permissive);
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe('600');
  });

  it('refuses a gitignored-but-tracked file and a file git does not ignore', async () => {
    const directory = await sandbox();
    const path = join(directory, '.env.launch.local');

    await expect(prepareLaunchEnvFile(path, { isIgnored: async () => true, isTracked: async () => true }))
      .rejects.toThrow(/tracked by git/u);

    await expect(prepareLaunchEnvFile(path, { isIgnored: async () => false, isTracked: async () => false }))
      .rejects.toThrow(/not gitignored/u);
  });

  it('tightens a file whose mode drifted', async () => {
    const directory = await sandbox();
    const path = join(directory, '.env.launch.local');
    await writeFile(path, 'NPM_TOKEN=placeholder\n');
    await chmod(path, 0o644);
    await prepareLaunchEnvFile(path, permissive);
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe('600');
  });

  it('requires a regular, non-symlinked password file with mode 0600', async () => {
    const directory = await sandbox();
    const password = join(directory, 'password');
    await writeFile(password, 'secret\n', { mode: 0o600 });
    await expect(requirePasswordFile(password)).resolves.toBeUndefined();

    await chmod(password, 0o644);
    await expect(requirePasswordFile(password)).rejects.toThrow(/requires 600/u);

    const target = join(directory, 'target-password');
    const link = join(directory, 'linked-password');
    await writeFile(target, 'secret\n', { mode: 0o600 });
    await symlink(target, link);
    await expect(requirePasswordFile(link)).rejects.toThrow(/regular non-symlinked file/u);
  });

  it('upserts one value without disturbing the others', async () => {
    const directory = await sandbox();
    const path = join(directory, '.env.launch.local');
    await prepareLaunchEnvFile(path, permissive);

    await writeLaunchEnvValue(path, 'BASE_RPC_URL', 'https://one.example/rpc');
    await writeLaunchEnvValue(path, 'NEON_API_KEY', 'napi_abcdefghijklmnopqrstuvwx');
    await writeLaunchEnvValue(path, 'BASE_RPC_URL', 'https://two.example/rpc');

    const text = await (await import('node:fs/promises')).readFile(path, 'utf8');
    expect(parseEnvFile(text)).toEqual({
      BASE_RPC_URL: 'https://two.example/rpc',
      NEON_API_KEY: 'napi_abcdefghijklmnopqrstuvwx',
    });
    expect(text.match(/BASE_RPC_URL=/gu)).toHaveLength(1);
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe('600');
  });
});
