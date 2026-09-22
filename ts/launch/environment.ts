/**
 * The protected founder environment for the pilot launch.
 *
 * One gitignored, mode-0600 file holds every credential the launch needs. The
 * checks here are the gate in front of it, and they encode three rules that
 * matter more than the parsing:
 *
 * - **The planes stay apart.** Treasury and refund-vault *private keys* and
 *   every operator variable are refused outright. The launch holds addresses
 *   and a bounded hot sponsor key; it never holds custody.
 * - **Requirements are staged.** A credential needed for the npm release is not
 *   demanded before the release, and the GitHub OAuth pair is deferred until
 *   the deployed web host has produced the real callback URL.
 * - **The three operators are three people.** The GitHub ids must be numeric
 *   and pairwise distinct, so a slot cannot be double-counted.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const LAUNCH_ENV_PATH = '.env.launch.local';

/** The ordered launch stages. A stage requires everything up to and including it. */
export const LAUNCH_STAGES = ['release', 'deploy', 'hosting', 'controls', 'activation', 'finalize'] as const;
export type LaunchStage = (typeof LAUNCH_STAGES)[number];

export type ValueShape =
  | 'rpc_url'
  | 'address'
  | 'private_key'
  | 'keystore_account'
  | 'password_file'
  | 'github_id'
  | 'https_url'
  | 'api_token'
  | 'usdc_units'
  | 'postgres_direct_url'
  | 'boolean';

export interface LaunchEnvVar {
  name: string;
  label: string;
  shape: ValueShape;
  /** The stage at which this value must already be present. */
  requiredFor: LaunchStage;
  /**
   * Known at a later moment inside its own stage: the GitHub OAuth pair can
   * only exist once the web host has an address to call back to.
   */
  deferred?: boolean;
  /** Optional provider material; absence must not block deployment. */
  optional?: boolean;
}

export const LAUNCH_VARS: readonly LaunchEnvVar[] = [
  // ── npm release ────────────────────────────────────────────────────────
  { name: 'NPM_TOKEN', label: 'npm publish token', shape: 'api_token', requiredFor: 'release' },
  // Recorded by `--reviewed`. It is declared here so `--check` surfaces the
  // gate and so a near miss like `yes` is refused rather than silently read as
  // "not reviewed" much later, at the publish step.
  { name: 'PILOT_RELEASE_REVIEWED', label: 'release commit reviewed', shape: 'boolean', requiredFor: 'release' },

  // ── Base Sepolia deployment ────────────────────────────────────────────
  { name: 'BASE_RPC_URL', label: 'dedicated Base Sepolia RPC', shape: 'rpc_url', requiredFor: 'deploy' },
  { name: 'BASE_DEPLOYMENT_DOMAIN', label: 'chain id', shape: 'usdc_units', requiredFor: 'deploy' },
  { name: 'BASE_USDC_ADDRESS', label: 'test USDC address', shape: 'address', requiredFor: 'deploy' },
  { name: 'BASE_DEPLOYER_KEYSTORE_ACCOUNT', label: 'Foundry keystore account', shape: 'keystore_account', requiredFor: 'deploy' },
  { name: 'BASE_DEPLOYER_PASSWORD_FILE', label: 'absolute Foundry keystore password-file path', shape: 'password_file', requiredFor: 'deploy' },
  { name: 'BASE_TREASURY_ADDRESS', label: 'treasury address', shape: 'address', requiredFor: 'deploy' },
  { name: 'BASE_REFUND_VAULT', label: 'refund vault address', shape: 'address', requiredFor: 'deploy' },
  { name: 'BASE_SPONSOR_PRIVATE_KEY', label: 'bounded runtime sponsor key', shape: 'private_key', requiredFor: 'deploy' },
  { name: 'BASE_SPEND_VERIFIER_ADDRESS', label: 'reviewed SpendVerifier adapter address', shape: 'address', requiredFor: 'deploy' },
  { name: 'BASESCAN_API_KEY', label: 'BaseScan verification key', shape: 'api_token', requiredFor: 'deploy', optional: true },

  // These are launcher-managed outputs. Hosting is deliberately deferred
  // until the four CREATE receipts and the post-deploy invariant checks have
  // completed and all deployment outputs have been written atomically.
  { name: 'BASE_SPONSOR_ADDRESS', label: 'derived sponsor address', shape: 'address', requiredFor: 'hosting' },
  { name: 'BASE_POSEIDON_T2_ADDRESS', label: 'deployed Poseidon T2 address', shape: 'address', requiredFor: 'hosting' },
  { name: 'BASE_POSEIDON_T3_ADDRESS', label: 'deployed Poseidon T3 address', shape: 'address', requiredFor: 'hosting' },
  { name: 'BASE_POSEIDON_T4_ADDRESS', label: 'deployed Poseidon T4 address', shape: 'address', requiredFor: 'hosting' },
  { name: 'BASE_BOND_ADDRESS', label: 'deployed PrivateCreditBond address', shape: 'address', requiredFor: 'hosting' },
  { name: 'BASE_BOND_DEPLOYMENT_BLOCK', label: 'PrivateCreditBond deployment block', shape: 'usdc_units', requiredFor: 'hosting' },
  { name: 'BASE_CONFIRMATIONS', label: 'Base confirmation count', shape: 'usdc_units', requiredFor: 'hosting' },
  { name: 'BASE_PRIVATE_CREDIT_BOND_ADDRESS', label: 'legacy deployed bond address', shape: 'address', requiredFor: 'hosting' },
  { name: 'BASE_DEPLOYMENT_BLOCK', label: 'legacy bond deployment block', shape: 'usdc_units', requiredFor: 'hosting' },

  // ── hosted infrastructure ──────────────────────────────────────────────
  { name: 'NEON_API_KEY', label: 'Neon API key', shape: 'api_token', requiredFor: 'hosting' },
  { name: 'RENDER_API_KEY', label: 'Render API key', shape: 'api_token', requiredFor: 'hosting' },
  { name: 'RENDER_OWNER_ID', label: 'Render owner id', shape: 'api_token', requiredFor: 'hosting' },
  { name: 'VERCEL_TOKEN', label: 'Vercel token', shape: 'api_token', requiredFor: 'hosting' },
  { name: 'OPENROUTER_API_KEY', label: 'OpenRouter key', shape: 'api_token', requiredFor: 'hosting' },

  // ── the three operator slots ───────────────────────────────────────────
  { name: 'PILOT_OPERATOR_A_GITHUB_ID', label: 'operator A GitHub account id', shape: 'github_id', requiredFor: 'activation' },
  { name: 'PILOT_OPERATOR_B_GITHUB_ID', label: 'operator B GitHub account id', shape: 'github_id', requiredFor: 'activation' },
  { name: 'PILOT_OPERATOR_C_GITHUB_ID', label: 'operator C GitHub account id', shape: 'github_id', requiredFor: 'activation' },

  // The web host must exist before GitHub will accept a callback URL.
  { name: 'GITHUB_CLIENT_ID', label: 'GitHub OAuth client id', shape: 'api_token', requiredFor: 'activation', deferred: true },
  { name: 'GITHUB_CLIENT_SECRET', label: 'GitHub OAuth client secret', shape: 'api_token', requiredFor: 'activation', deferred: true },
];

export const OPERATOR_GITHUB_ID_VARS = [
  'PILOT_OPERATOR_A_GITHUB_ID',
  'PILOT_OPERATOR_B_GITHUB_ID',
  'PILOT_OPERATOR_C_GITHUB_ID',
] as const;

/**
 * Values the launch must never be handed. Treasury and refund custody stay
 * offline, and every operator-owned secret stays on the operator's machine.
 */
export const FORBIDDEN_LAUNCH_VARS: readonly string[] = [
  'BASE_TREASURY_PRIVATE_KEY',
  'BASE_REFUND_VAULT_PRIVATE_KEY',
  'BASE_REFUND_PRIVATE_KEY',
  'BASE_TREASURY_KEY',
  'ZK_CREDITS_CREDENTIAL_PATH',
  'ZK_CREDITS_CREDENTIAL_PASSWORD',
  'ZK_CREDITS_OPERATOR_SECRET',
  'ZK_CREDITS_ARTIFACT_DIR',
  'ZK_CREDITS_WITNESS_PATH',
  'ZK_CREDITS_HOME',
];

/** Secrets the launch generates itself and sends straight to a provider. */
export const GENERATED_SECRET_VARS = [
  'BILLING_INTERNAL_TOKEN',
  'FACILITATOR_SERVICE_TOKEN',
  'CLAIM_STORE_OPERATOR_TOKEN',
  'NEXTAUTH_SECRET',
] as const;

/** Values produced by launch-pilot after on-chain reconciliation, never wizard inputs. */
export const LAUNCH_OUTPUT_VARS = [
  'BASE_SPONSOR_ADDRESS',
  'BASE_POSEIDON_T2_ADDRESS',
  'BASE_POSEIDON_T3_ADDRESS',
  'BASE_POSEIDON_T4_ADDRESS',
  'BASE_BOND_ADDRESS',
  'BASE_BOND_DEPLOYMENT_BLOCK',
  'BASE_CONFIRMATIONS',
  // Legacy names remain as atomically-written compatibility aliases for the
  // gateway and sidecar, but are still launcher-managed outputs.
  'BASE_PRIVATE_CREDIT_BOND_ADDRESS',
  'BASE_DEPLOYMENT_BLOCK',
] as const;

export interface LaunchEnvViolation {
  name: string;
  reason: string;
}

export interface LaunchEnvCheck {
  /** Present and well formed at the requested stage. */
  satisfied: string[];
  /** Required by the stage but absent. */
  missing: LaunchEnvVar[];
  /** Required later, or blocked on the deployed callback URL. */
  deferred: LaunchEnvVar[];
  /** Present but refusing to pass validation. */
  invalid: LaunchEnvViolation[];
  /** Present when they must never be. */
  forbidden: string[];
}

export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    values[key] = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/u, '$2');
  }
  return values;
}

export async function readLaunchEnv(path: string = LAUNCH_ENV_PATH): Promise<Record<string, string>> {
  const text = await readFile(path, 'utf8');
  return parseEnvFile(text);
}

/** A secret the launch generates locally and never prints. */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const PLACEHOLDERS = [
  '0x...', '...', 'todo', 'tbd', 'change-me', 'change_me', 'replace-with', 'your-', 'your_', 'paste-',
];

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.length === 0) return true;
  if (PLACEHOLDERS.some((placeholder) => lower.includes(placeholder))) return true;
  if (value.startsWith('<') && value.endsWith('>')) return true;
  return false;
}

/** Validates one value against its declared shape. Returns the refusal reason, or undefined. */
export function validateShape(value: string, shape: ValueShape): string | undefined {
  if (looksLikePlaceholder(value)) return 'still a placeholder';
  switch (shape) {
    case 'rpc_url':
      if (!/^https:\/\/\S+$/u.test(value)) return 'must be an https endpoint';
      if (value.includes('sepolia.base.org')) return 'is the shared public endpoint; use a dedicated RPC';
      return undefined;
    case 'https_url':
      return /^https:\/\/\S+$/u.test(value) ? undefined : 'must be an https URL';
    case 'address':
      if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return 'must be a 20-byte address';
      if (/^0x0{40}$/u.test(value)) return 'is the zero address';
      return undefined;
    case 'private_key':
      return /^0x[0-9a-fA-F]{64}$/u.test(value) ? undefined : 'must be a 32-byte hex key';
    case 'keystore_account':
      return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(value) ? undefined : 'must be a Foundry keystore account name, not a key';
    case 'password_file':
      return isAbsolute(value) ? undefined : 'must be an absolute path';
    case 'github_id':
      return /^[0-9]+$/u.test(value) ? undefined : 'must be the numeric GitHub account id';
    case 'api_token':
      return value.length >= 16 ? undefined : 'is too short to be a token';
    case 'usdc_units':
      return /^[0-9]+$/u.test(value) ? undefined : 'must be a whole number';
    case 'postgres_direct_url':
      if (!/^postgres(ql)?:\/\/\S+$/u.test(value)) return 'must be a postgres connection string';
      if (value.includes('sslmode=disable')) return 'must require TLS';
      return undefined;
    case 'boolean':
      return value === 'true' || value === 'false' ? undefined : 'must be exactly true or false';
  }
}

/**
 * Checks the environment for one stage. Values for later stages are reported as
 * deferred rather than missing, so a preflight before the npm release does not
 * demand a Vercel token that does not exist yet.
 */
export function checkLaunchEnv(values: Record<string, string>, stage: LaunchStage): LaunchEnvCheck {
  const reach = LAUNCH_STAGES.indexOf(stage);
  const satisfied: string[] = [];
  const missing: LaunchEnvVar[] = [];
  const deferred: LaunchEnvVar[] = [];
  const invalid: LaunchEnvViolation[] = [];
  const forbidden: string[] = [];

  for (const name of FORBIDDEN_LAUNCH_VARS) {
    if ((values[name] ?? '').length > 0) forbidden.push(name);
  }

  for (const variable of LAUNCH_VARS) {
    const value = values[variable.name];
    if (LAUNCH_STAGES.indexOf(variable.requiredFor) > reach) {
      deferred.push(variable);
      continue;
    }
    if (value === undefined || value.length === 0) {
      if (variable.optional) {
        deferred.push(variable);
        continue;
      }
      missing.push(variable);
      continue;
    }
    const reason = validateShape(value, variable.shape);
    if (reason) invalid.push({ name: variable.name, reason });
    else satisfied.push(variable.name);
  }

  // Three distinct people, not one person holding three slots.
  if (LAUNCH_STAGES.indexOf('activation') <= reach) {
    const ids = OPERATOR_GITHUB_ID_VARS.map((name) => values[name]).filter((value): value is string => Boolean(value));
    if (ids.length === OPERATOR_GITHUB_ID_VARS.length && new Set(ids).size !== ids.length) {
      invalid.push({ name: OPERATOR_GITHUB_ID_VARS.join('/'), reason: 'the three operator GitHub ids must be distinct' });
    }
  }

  return { satisfied, missing, deferred, invalid, forbidden };
}

export interface GitProbe {
  /** True when git ignores the path. */
  isIgnored(path: string): Promise<boolean>;
  /** True when git tracks the path. */
  isTracked(path: string): Promise<boolean>;
}

async function gitOutput(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: process.cwd() });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

export const defaultGitProbe: GitProbe = {
  async isIgnored(path: string): Promise<boolean> {
    return (await gitOutput(['check-ignore', '-q', path])).ok;
  },
  async isTracked(path: string): Promise<boolean> {
    return (await gitOutput(['ls-files', '--error-unmatch', path])).ok;
  },
};

/**
 * Creates the launch env file if needed at mode 0600, and refuses to use one
 * that git tracks or does not ignore.
 */
export async function prepareLaunchEnvFile(path: string = LAUNCH_ENV_PATH, probe: GitProbe = defaultGitProbe): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`${path} is a symlink; refusing to use it as the launch env file`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(path, '', { mode: 0o600 });
  }
  if (await probe.isTracked(path)) throw new Error(`${path} is tracked by git; a launch env file must never be committed`);
  if (!(await probe.isIgnored(path))) throw new Error(`${path} is not gitignored; add it to .gitignore first`);
  await chmod(path, 0o600);
  const mode = (await stat(path)).mode & 0o777;
  if (mode !== 0o600) throw new Error(`${path} has mode ${mode.toString(8)}; a launch env file requires 600`);
}

/** Requires the Foundry password file to be a regular, non-symlinked 0600 file. */
export async function requirePasswordFile(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error(`${path} is not an absolute password-file path`);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${path} must be a regular non-symlinked file`);
  const mode = info.mode & 0o777;
  if (mode !== 0o600) throw new Error(`${path} has mode ${mode.toString(8)}; the password file requires 600`);
}

function replaceEnvValues(text: string, values: Record<string, string>): string {
  const names = new Set(Object.keys(values));
  const lines = text.split('\n').filter((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/u);
    return !match || !names.has(match[1]!);
  });
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  for (const [name, value] of Object.entries(values)) lines.push(`${name}=${value}`);
  return `${lines.join('\n')}\n`;
}

/** Atomically upserts outputs so a crash cannot leave half a deployment config. */
export async function writeLaunchEnvValuesAtomically(path: string, values: Record<string, string>): Promise<void> {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch {
    text = '';
  }
  const temporary = join(dirname(path), `.${path.split('/').at(-1) ?? 'launch-env'}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(temporary, replaceEnvValues(text, values), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/** Upserts one value, preserving the rest of the file verbatim. */
export async function writeLaunchEnvValue(path: string, name: string, value: string): Promise<void> {
  await writeLaunchEnvValuesAtomically(path, { [name]: value });
}
