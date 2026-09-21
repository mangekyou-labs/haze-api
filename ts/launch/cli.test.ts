/**
 * The launch runner: preflight, status, and resumption.
 *
 * The property this file exists to prove is that an interruption at *any* step
 * leaves the launch recoverable and never silently repeats an operation that
 * may already have happened. So the resumption test is parameterised over every
 * step in the real plan: interrupt there, observe that the checkpoint is
 * recorded, observe that a second resume refuses to advance past an unresolved
 * step, and observe that once it is reconciled the run continues from there
 * rather than from the beginning.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LAUNCH_STATE_PATH,
  buildLaunchPlan,
  createLaunchContext,
  runCheck,
  runLaunchCli,
  runResume,
  runStatus,
  type CommandResult,
  type LaunchContext,
} from './cli.js';
import {
  PILOT_NEON_REGION,
  PILOT_RENDER_REGION,
  RESOURCE_NAMES,
  ProviderTimeoutError,
} from './providers.js';
import { LaunchStateStore } from './state.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function sandbox(): Promise<{ directory: string; statePath: string; envPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-launch-cli-'));
  directories.push(directory);
  return {
    directory,
    statePath: join(directory, LAUNCH_STATE_PATH),
    envPath: join(directory, '.env.launch.local'),
  };
}

/** The temp sandbox is outside a work tree, so git is stubbed as permissive. */
const PERMISSIVE = { isIgnored: async () => true, isTracked: async () => false };

const COMPLETE_ENV: Record<string, string> = {
  NPM_TOKEN: 'npm_abcdefghijklmnopqrstuvwx',
  BASE_RPC_URL: 'https://alchemy.example/v2/key',
  BASE_DEPLOYMENT_DOMAIN: '84532',
  BASE_USDC_ADDRESS: '0x1111111111111111111111111111111111111111',
  BASE_DEPLOYER_KEYSTORE_ACCOUNT: 'pilot-deployer',
  BASE_TREASURY_ADDRESS: '0x1111111111111111111111111111111111111111',
  BASE_REFUND_VAULT: '0x2222222222222222222222222222222222222222',
  BASE_SPONSOR_PRIVATE_KEY: `0x${'cd'.repeat(32)}`,
  BASESCAN_API_KEY: 'abcdefghijklmnopqrstuvwx',
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
  PILOT_RELEASE_REVIEWED: 'true',
};

const DEPLOYER = '0x1111111111111111111111111111111111111111';

/** A pack report shaped like `npm pack --dry-run --json`. */
const PACK_JSON = JSON.stringify([
  { filename: 'zk-credits-0.2.0.tgz', files: [{ path: 'package.json', size: 1_200 }, { path: 'dist/zk-credits.js', size: 40_000 }] },
]);

/**
 * A provider stub that models the create-then-read-back sequence: the first
 * exact-name lookup returns nothing, the create stores the resource, and the
 * read-back lookup the adapter performs must then find exactly one.
 */
function providerStub(): (request: { method: string; url: string }) => unknown {
  const created = new Set<string>();
  const neon = { id: 'proj_1', name: RESOURCE_NAMES.neonProject, region_id: PILOT_NEON_REGION };
  const render = {
    id: 'srv_1',
    name: RESOURCE_NAMES.renderService,
    serviceDetails: { region: PILOT_RENDER_REGION, plan: 'free', healthCheckPath: '/health' },
  };
  const vercel = { id: 'prj_1', name: RESOURCE_NAMES.vercelProject, targets: { production: { url: 'zk-credits-web.vercel.app' } } };

  return ({ method, url }) => {
    if (url.includes('console.neon.tech')) {
      if (method === 'GET' && url.includes('connection_uri')) {
        return { uri: `postgresql://u:p@ep-pilot.aws.neon.tech/${RESOURCE_NAMES.neonDatabase}?sslmode=require` };
      }
      if (method === 'POST') {
        created.add('neon');
        return { project: neon };
      }
      return { projects: created.has('neon') ? [neon] : [] };
    }
    if (url.includes('api.render.com')) {
      if (url.includes('/owners')) return [{ owner: { id: 'tea-1', name: 'personal' } }];
      if (method === 'POST') {
        created.add('render');
        return { service: render };
      }
      return created.has('render') ? [{ service: render }] : [];
    }
    if (method === 'POST') {
      created.add('vercel');
      return vercel;
    }
    return { projects: created.has('vercel') ? [vercel] : [] };
  };
}

interface Harness {
  context: LaunchContext;
  statePath: string;
  printed: string[];
  commands: string[];
  confirmed: string[];
  /** Requests the provider adapters made, so a test can assert read-back. */
  requests: { method: string; url: string }[];
}

async function harness(options: {
  env?: Record<string, string>;
  confirm?: boolean;
  /** Provider responses keyed by a substring of the request URL. */
  provider?: (request: { method: string; url: string }) => unknown;
  /** Bytecode the fake chain reports for every address. */
  code?: string;
} = {}): Promise<Harness> {
  const { statePath } = await sandbox();
  const printed: string[] = [];
  const commands: string[] = [];
  const confirmed: string[] = [];
  const requests: { method: string; url: string }[] = [];
  // One stub per harness, so its create-then-read-back state persists.
  const provider = options.provider ?? providerStub();
  const state = new LaunchStateStore({ path: statePath, now: () => 1_800_000_000_000, isTracked: async () => false });

  const context: LaunchContext = {
    env: options.env ?? COMPLETE_ENV,
    state,
    print: (line) => printed.push(line),
    async confirm(question) {
      confirmed.push(question);
      return options.confirm ?? true;
    },
    chain: () => ({
      receipt: async () => undefined,
      code: async () => options.code ?? '0x6080604052600436106100',
    }),
    transport: () => ({
      async send(request) {
        requests.push({ method: request.method, url: request.url });
        return { status: 200, body: provider(request) };
      },
    }),
    async run(command, args): Promise<CommandResult> {
      commands.push([command, ...args].join(' '));
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
      if (command === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: 'feature-base-zk-credits\n', stderr: '' };
      if (command === 'git' && args[0] === 'branch') return { code: 0, stdout: '  origin/feature-base-zk-credits\n', stderr: '' };
      if (command === 'git' && args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
      if (command === 'npm' && args[0] === 'pack') return { code: 0, stdout: PACK_JSON, stderr: '' };
      if (command === 'cast' && args[0] === 'wallet') return { code: 0, stdout: `${DEPLOYER}\n`, stderr: '' };
      if (command === 'cast' && args[0] === 'nonce') return { code: 0, stdout: '42\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { context, statePath, printed, commands, confirmed, requests };
}

describe('preflight', () => {
  it('is ready on a complete environment and writes nothing', async () => {
    const { context, statePath } = await harness();
    const result = await runCheck(context);
    expect(result.report.at(-1)).toBe('preflight: ready');
    await expect(stat(statePath)).rejects.toThrow(/ENOENT/u);
  });

  it('lists what is missing, invalid, deferred, and refused', async () => {
    const { context } = await harness({
      env: {
        ...COMPLETE_ENV,
        BASE_RPC_URL: '0x...',
        NEON_API_KEY: '',
        BASE_TREASURY_PRIVATE_KEY: `0x${'ff'.repeat(32)}`,
      },
    });
    const result = await runCheck(context);
    const report = result.report.join('\n');

    expect(report).toMatch(/INVALID {3}BASE_RPC_URL: still a placeholder/u);
    expect(report).toMatch(/MISSING {3}NEON_API_KEY/u);
    expect(report).toMatch(/REFUSED {3}BASE_TREASURY_PRIVATE_KEY must never appear/u);
    expect(result.report.at(-1)).toBe('preflight: not ready');
  });

  it('reports an unresolved step as a blocker instead of pretending to be ready', async () => {
    const { context } = await harness();
    await context.state.record('deploy:contracts', { status: 'unknown', note: 'broadcast timed out' });
    const result = await runCheck(context);
    expect(result.report.join('\n')).toMatch(/UNRESOLVED deploy:contracts: broadcast timed out/u);
    expect(result.report.at(-1)).toBe('preflight: not ready');
  });
});

describe('status', () => {
  it('reports every plan step, defaulting to pending', async () => {
    const { context } = await harness();
    const result = await runStatus(context);
    const report = result.report.join('\n');
    expect(result.report[0]).toMatch(/^state: /u);
    expect(report).toMatch(/pending +release:preflight/u);
    expect(report).toMatch(/pending +activation:slot-c/u);
  });

  it('surfaces the recorded detail a resumed run needs', async () => {
    const { context } = await harness();
    await context.state.record('hosting:neon', { status: 'succeeded', detail: { projectId: 'proj_1', region: 'aws-ap-southeast-1' } });
    const result = await runStatus(context);
    expect(result.report.join('\n')).toMatch(/succeeded +hosting:neon/u);
    expect(result.report.join('\n')).toMatch(/projectId=proj_1 region=aws-ap-southeast-1/u);
  });
});

describe('the plan', () => {
  it('orders the stages so a release precedes a deployment and a rehearsal precedes an operator', async () => {
    const plan = buildLaunchPlan(COMPLETE_ENV);
    const index = (name: string) => plan.findIndex((step) => step.name === name);

    expect(index('release:preflight')).toBeLessThan(index('deploy:preflight'));
    expect(index('deploy:contracts')).toBeLessThan(index('hosting:neon'));
    expect(index('hosting:neon')).toBeLessThan(index('activation:rehearsal'));
    expect(index('activation:rehearsal')).toBeLessThan(index('activation:slot-a'));
    expect(index('activation:slot-a')).toBeLessThan(index('activation:slot-b'));
    expect(index('activation:slot-b')).toBeLessThan(index('activation:slot-c'));
    expect(index('release:publish-sidecar')).toBeLessThan(index('deploy:contracts'));
  });

  it('marks the irreversible steps so they always stop and ask', () => {
    const irreversible = buildLaunchPlan().filter((step) => step.irreversible).map((step) => step.name);
    expect(irreversible).toEqual(expect.arrayContaining([
      'release:publish-leaves',
      'release:publish-sidecar',
      'deploy:contracts',
      'deploy:approve-usdc',
    ]));
  });

  it('runs to completion when every command succeeds and every question is answered', async () => {
    const { context } = await harness();
    const result = await runResume({ mode: 'resume', context });
    if (result.stoppedAt) {
      // Surface the recorded reason rather than only the step name.
      const record = (await context.state.load()).steps[result.stoppedAt.step];
      throw new Error(`stopped at ${result.stoppedAt.step} (${result.stoppedAt.reason}): ${record?.note ?? 'no note'}`);
    }
    expect(result.report.at(-1)).toBe('the launch plan is complete');
    expect(result.completed).toEqual(buildLaunchPlan(COMPLETE_ENV).map((step) => step.name));
  });
});

/**
 * The core resumption contract, checked at every step of the real plan rather
 * than at a convenient one.
 */
describe('checkpoint resumption after every non-idempotent operation', () => {
  const plan = buildLaunchPlan(COMPLETE_ENV);

  for (const [index, step] of plan.entries()) {
    it(`recovers from an interruption during ${step.name}`, async () => {
      const { context } = await harness();
      const interrupted = plan.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              async execute() {
                throw new ProviderTimeoutError(`${entry.name} timed out`);
              },
            }
          : entry,
      );

      const first = await runResume({ mode: 'resume', context, plan: interrupted });
      if (index === 0) {
        expect(first.stoppedAt).toEqual({ step: step.name, reason: 'unknown' });
      } else {
        // Everything before the interruption is durably recorded as done.
        expect(first.completed).toEqual(plan.slice(0, index).map((entry) => entry.name));
        expect(first.stoppedAt).toEqual({ step: step.name, reason: 'unknown' });
      }

      const recorded = (await context.state.load()).steps[step.name];
      expect(recorded?.status).toBe('unknown');
      expect(recorded?.note).toMatch(/timed out/u);

      // A resume must refuse to advance: the operation may already have happened.
      const second = await runResume({ mode: 'resume', context, plan: interrupted });
      expect(second.completed).toEqual([]);
      expect(second.stoppedAt).toEqual({ step: step.name, reason: 'unresolved' });
      expect(second.report.join('\n')).toMatch(/must be reconciled first/u);

      // Reconciling the unknown is what unblocks the run, and it resumes here.
      await context.state.record(step.name, { status: 'succeeded', detail: { reconciled: true } });
      const third = await runResume({ mode: 'resume', context, plan });
      expect(third.report.join('\n')).toMatch(new RegExp(`skip {2}${step.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
      expect(third.stoppedAt).toBeUndefined();
      expect(third.report.at(-1)).toBe('the launch plan is complete');
    });
  }

  it('records a failure distinctly from an unknown, so a definite failure may be retried', async () => {
    const { context } = await harness();
    const failing = plan.map((entry, entryIndex) =>
      entryIndex === 2
        ? { ...entry, async execute() { throw new Error('the registry rejected the pack'); } }
        : entry,
    );
    const result = await runResume({ mode: 'resume', context, plan: failing });
    expect(result.stoppedAt).toEqual({ step: plan[2]!.name, reason: 'failed' });

    const recorded = (await context.state.load()).steps[plan[2]!.name];
    expect(recorded?.status).toBe('failed');
    expect(await context.state.unresolvedSteps()).toEqual([]);
  });

  it('stops at a step whose confirmation was refused, and holds the checkpoint', async () => {
    const { context } = await harness({ confirm: false });
    const result = await runResume({ mode: 'resume', context });
    expect(result.stoppedAt).toMatchObject({ reason: 'not confirmed' });
    expect((await context.state.load()).steps['release:registry-check']).toMatchObject({
      status: 'pending',
      note: 'not confirmed',
    });
  });

  it('redacts a failure note before it reaches the state file', async () => {
    const { context } = await harness();
    const leaking = plan.map((entry, entryIndex) =>
      entryIndex === 1
        ? { ...entry, async execute() { throw new Error(`publish failed with token ${'npm_abcdefghijklmnopqrstuvwx'}`); } }
        : entry,
    );
    await runResume({ mode: 'resume', context, plan: leaking });
    const recorded = (await context.state.load()).steps[plan[1]!.name];
    expect(recorded?.note).toContain('[redacted]');
    expect(recorded?.note).not.toContain('npm_abcdefghijklmnopqrstuvwx');
  });
});

describe('the CLI surface', () => {
  it('rejects an unknown flag rather than ignoring it', async () => {
    const { envPath, statePath } = await sandbox();
    const result = await runLaunchCli(['--force'], { envPath, statePath, gitProbe: PERMISSIVE, env: COMPLETE_ENV, print: () => {}, confirm: async () => true });
    expect(result.exitCode).toBe(2);
    expect(result.report.join('\n')).toMatch(/unknown flag --force/u);
  });

  it('offers no flag that confirms irreversible work unattended', async () => {
    const { envPath, statePath } = await sandbox();
    const printed: string[] = [];
    const result = await runLaunchCli(['--help'], {
      envPath,
      statePath,
      gitProbe: PERMISSIVE,
      env: COMPLETE_ENV,
      print: (line) => printed.push(line),
    });
    // The help text has to reach the terminal, not just the returned report.
    expect(printed).toEqual(result.report);
    expect(printed.join('\n')).toMatch(/usage: scripts\/launch-pilot\.sh/u);
    const help = result.report.join('\n');
    expect(help).toMatch(/no unattended confirmation flag and no flag that deletes a resource/u);
    expect(help).not.toMatch(/--yes|--force|--non-interactive/u);
  });

  it('prints the refusal when a flag is not recognised', async () => {
    const { envPath, statePath } = await sandbox();
    const printed: string[] = [];
    await runLaunchCli(['--force'], {
      envPath,
      statePath,
      gitProbe: PERMISSIVE,
      env: COMPLETE_ENV,
      print: (line) => printed.push(line),
    });
    expect(printed.join('\n')).toMatch(/unknown flag --force/u);
  });

  it('makes --reviewed reach the gate the release step actually reads', async () => {
    // Without the declaration the first step fails, so the flag must set it.
    const withoutFlag = await harness({ env: { ...COMPLETE_ENV, PILOT_RELEASE_REVIEWED: '' } });
    expect((await runResume({ mode: 'resume', context: withoutFlag.context })).stoppedAt)
      .toEqual({ step: 'release:preflight', reason: 'failed' });

    const { envPath, statePath } = await sandbox();
    const { readLaunchEnv } = await import('./environment.js');
    const result = await runLaunchCli(['--reviewed'], {
      envPath,
      statePath,
      gitProbe: PERMISSIVE,
      env: COMPLETE_ENV,
      print: () => {},
      confirm: async () => false,
    });
    // Recorded, not held for one invocation: the launch resumes across runs, so
    // a declaration that vanished would gate on memory rather than on review.
    expect((await readLaunchEnv(envPath)).PILOT_RELEASE_REVIEWED).toBe('true');
    expect(result.report.join('\n')).not.toMatch(/not been confirmed as reviewed/u);
  });

  it('keeps --check read-only even when --reviewed is passed', async () => {
    const { envPath, statePath } = await sandbox();
    const { readLaunchEnv } = await import('./environment.js');
    const result = await runLaunchCli(['--check', '--reviewed'], {
      envPath,
      statePath,
      gitProbe: PERMISSIVE,
      env: COMPLETE_ENV,
      print: () => {},
    });
    expect(result.report.join('\n')).toMatch(/preflight: ready/u);
    expect((await readLaunchEnv(envPath)).PILOT_RELEASE_REVIEWED).toBeUndefined();
  });

  it('runs the read-only preflight and reports readiness through the exit code', async () => {
    const { envPath, statePath } = await sandbox();
    const ready = await runLaunchCli(['--check'], { envPath, statePath, gitProbe: PERMISSIVE, env: COMPLETE_ENV, print: () => {} });
    expect(ready.exitCode).toBe(0);

    const blocked = await runLaunchCli(['--check'], { envPath, statePath, gitProbe: PERMISSIVE, env: {}, print: () => {} });
    expect(blocked.exitCode).toBe(1);
  });

  it('honours the env path the shell wrapper passes', async () => {
    const { envPath, statePath } = await sandbox();
    const { writeLaunchEnvValue, prepareLaunchEnvFile } = await import('./environment.js');
    await prepareLaunchEnvFile(envPath, PERMISSIVE);
    await writeLaunchEnvValue(envPath, 'NPM_TOKEN', 'npm_abcdefghijklmnopqrstuvwx');

    const result = await runLaunchCli(['--check'], { envPath, statePath, gitProbe: PERMISSIVE, print: () => {} });
    expect(result.report.join('\n')).toMatch(/satisfied: 1 value\(s\)/u);
  });

  it('exposes a context whose default state path is the gitignored launch file', async () => {
    const context = createLaunchContext({ statePath: join(await mkdtemp(join(tmpdir(), 'zk-ctx-')), LAUNCH_STATE_PATH) });
    expect(context.state.filePath).toMatch(/\.launch-state\.local\.json$/u);
  });
});
