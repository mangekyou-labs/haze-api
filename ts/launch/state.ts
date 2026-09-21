/**
 * Resumable launch state.
 *
 * The launch sequence spans irreversible operations, so progress has to survive
 * an interruption at any point. The state file is therefore the launch's memory
 * and nothing else: for each step it holds a status, a timestamp, and
 * secret-free detail (a provider id, a URL, a hash, a block number).
 *
 * Two properties make it trustworthy:
 *
 * - it refuses to persist anything that still looks like a secret, so the state
 *   file can be read, diffed, and pasted without leaking a credential; and
 * - a step whose outcome is unknowable is recorded as `unknown` rather than
 *   guessed at, which is what forces reconciliation before a retry.
 *
 * The file is mode 0600 and must not be tracked by git.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertSecretFree } from './redact.js';

export const LAUNCH_STATE_VERSION = 1 as const;

/**
 * `unknown` is the important one: a non-idempotent call that timed out may or
 * may not have happened, so the next run reconciles it against the provider by
 * exact name instead of creating a second resource.
 */
export type StepStatus = 'pending' | 'succeeded' | 'unknown' | 'failed';

/** Secret-free detail attached to a step: ids, URLs, hashes, counts. */
export type StepDetail = Record<string, string | number | boolean | null>;

export interface StepRecord {
  name: string;
  status: StepStatus;
  updatedAt: string;
  detail: StepDetail;
  /** Why the step is not `succeeded`, in one human sentence. */
  note?: string;
}

export interface LaunchState {
  version: typeof LAUNCH_STATE_VERSION;
  updatedAt: string;
  steps: Record<string, StepRecord>;
}

export interface LaunchStateStoreOptions {
  path: string;
  now?: () => number;
  /** Injected so tests do not need a git work tree. */
  isTracked?: (path: string) => Promise<boolean>;
}

export function emptyLaunchState(now: () => number = Date.now): LaunchState {
  return { version: LAUNCH_STATE_VERSION, updatedAt: new Date(now()).toISOString(), steps: {} };
}

/** Force mode 0600 and report what the filesystem actually holds. */
export async function requirePrivateMode(path: string): Promise<void> {
  await chmod(path, 0o600);
  const info = await stat(path);
  const mode = info.mode & 0o777;
  if (mode !== 0o600) throw new Error(`${path} has mode ${mode.toString(8)}; a launch file requires 600`);
}

export class LaunchStateStore {
  private readonly path: string;
  private readonly now: () => number;
  private readonly isTracked: (path: string) => Promise<boolean>;

  constructor(options: LaunchStateStoreOptions) {
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.isTracked = options.isTracked ?? (async () => false);
  }

  get filePath(): string {
    return this.path;
  }

  /** Reads the state, or returns an empty one when the file does not exist yet. */
  async load(): Promise<LaunchState> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLaunchState(this.now);
      throw error;
    }
    const parsed = JSON.parse(raw) as LaunchState;
    if (parsed.version !== LAUNCH_STATE_VERSION) throw new Error(`launch state version ${parsed.version} is not supported`);
    return { ...parsed, steps: parsed.steps ?? {} };
  }

  /** Writes the state, refusing anything secret-shaped and forcing mode 0600. */
  async save(state: LaunchState): Promise<void> {
    if (await this.isTracked(this.path)) throw new Error(`${this.path} is tracked by git; refusing to write launch state into it`);
    const next: LaunchState = { ...state, version: LAUNCH_STATE_VERSION, updatedAt: new Date(this.now()).toISOString() };
    assertSecretFree(next, this.path);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await requirePrivateMode(this.path);
  }

  /** Records one step's outcome and returns the updated state. */
  async record(
    name: string,
    record: { status: StepStatus; detail?: StepDetail; note?: string },
  ): Promise<LaunchState> {
    const state = await this.load();
    const next: StepRecord = {
      name,
      status: record.status,
      updatedAt: new Date(this.now()).toISOString(),
      detail: record.detail ?? {},
      ...(record.note === undefined ? {} : { note: record.note }),
    };
    const updated: LaunchState = { ...state, steps: { ...state.steps, [name]: next } };
    await this.save(updated);
    return updated;
  }

  /**
   * Steps whose outcome is unknown. A resume must reconcile these before it may
   * advance, because a retry could duplicate an irreversible operation.
   */
  async unresolvedSteps(): Promise<StepRecord[]> {
    const state = await this.load();
    return Object.values(state.steps).filter((step) => step.status === 'unknown');
  }

  /** Step names that finished successfully, in insertion order. */
  async completedSteps(): Promise<string[]> {
    const state = await this.load();
    return Object.values(state.steps).filter((step) => step.status === 'succeeded').map((step) => step.name);
  }
}
