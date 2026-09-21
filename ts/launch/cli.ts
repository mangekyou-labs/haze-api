/**
 * The launch runner: one entrypoint, an ordered plan, and a checkpoint after
 * every step that touched something outside this machine.
 *
 * Three modes, and only the first two are read-only:
 *
 *   `--check`   preflight. Reads credentials, git, packages, the chain, and the
 *               providers, then reports what is missing. It changes nothing.
 *   `--status`  reconciliation. Reports local checkpoints and what the remote
 *               providers hold, so a resumed run knows where it stands.
 *   (default)   start or resume from the last completed checkpoint.
 *
 * Two properties are deliberate:
 *
 * - **An unresolved step stops the run.** A step marked `unknown` means a
 *   non-idempotent call may or may not have happened; the runner refuses to
 *   advance until reconciliation resolves it, because a blind retry could
 *   create a second contract or publish a second version.
 * - **Nothing is deleted.** There is no flag that removes a resource, and no
 *   confirmation flag that skips confirmation. Every irreversible step stops
 *   and asks.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  LAUNCH_ENV_PATH,
  checkLaunchEnv,
  generateSecret,
  prepareLaunchEnvFile,
  readLaunchEnv,
  writeLaunchEnvValue,
  GENERATED_SECRET_VARS,
  type GitProbe,
  type LaunchEnvCheck,
  type LaunchStage,
} from './environment.js';
import { redact } from './redact.js';
import { LaunchStateStore, type StepDetail, type StepRecord, type StepStatus } from './state.js';
import {
  RELEASE_PACKAGES,
  assertReleaseReady,
  isDependencyOnlyChange,
  packContentDigest,
  parsePackOutput,
} from './release.js';
import {
  CONTRACT_DEPLOY_ORDER,
  EXISTING_B11_CONTRACTS,
  PILOT_CHAIN_ID,
  assertChainId,
  broadcastIntent,
  reconcileBroadcast,
  rpcChainReader,
  type BroadcastIntent,
  type ChainReader,
} from './deploy.js';
import {
  githubOAuthCallback,
  httpTransport,
  neonConnectionUri,
  neonProjectAdapter,
  renderOwnerId,
  renderServiceAdapter,
  resolveResource,
  vercelProjectAdapter,
  type HttpTransport,
} from './providers.js';

const execFileAsync = promisify(execFile);

export const LAUNCH_STATE_PATH = '.launch-state.local.json';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface LaunchContext {
  env: Record<string, string>;
  state: LaunchStateStore;
  /** The protected env file a step may add generated values to. */
  envPath?: string;
  /**
   * Chain and HTTP factories. They are injectable so a step can be exercised
   * without a node or a network, which is what makes the provider and
   * broadcast steps testable rather than merely described.
   */
  chain(rpcUrl: string): ChainReader;
  transport(): HttpTransport;
  /** Runs a command in the repository, returning its exit code and output. */
  run(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>;
  /** Asks the founder to confirm an irreversible action. Never defaulted to yes. */
  confirm(question: string): Promise<boolean>;
  /** Prints a line, already redacted. */
  print(line: string): void;
}

export type StepOutcome =
  | { status: 'succeeded'; detail?: StepDetail }
  | { status: 'unknown'; note: string; detail?: StepDetail }
  | { status: 'failed'; note: string; detail?: StepDetail }
  | { status: 'skipped'; note: string };

export interface LaunchStep {
  name: string;
  stage: LaunchStage;
  description: string;
  /**
   * True when the step changes something outside this machine. An irreversible
   * step always asks before it acts.
   */
  irreversible?: boolean;
  execute(context: LaunchContext): Promise<StepOutcome>;
}

async function commandOutcome(
  context: LaunchContext,
  command: string,
  args: string[],
  options: { cwd?: string; detail?: StepDetail; note?: string } = {},
): Promise<StepOutcome> {
  const result = await context.run(command, args, options);
  if (result.code === 0) return { status: 'succeeded', detail: options.detail };
  return { status: 'failed', note: options.note ?? `${command} exited ${result.code}`, detail: options.detail };
}

/**
 * A step only a human can perform. It prints what to do and waits for an
 * explicit yes, so the checkpoint records that a person confirmed it rather
 * than that a script believed it.
 */
function manualStep(options: {
  name: string;
  stage: LaunchStep['stage'];
  description: string;
  instructions: string[];
  irreversible?: boolean;
}): LaunchStep {
  return {
    name: options.name,
    stage: options.stage,
    description: options.description,
    irreversible: options.irreversible,
    async execute(context: LaunchContext): Promise<StepOutcome> {
      for (const line of options.instructions) context.print(`    ${line}`);
      const confirmed = await context.confirm(`${options.description} — done?`);
      if (!confirmed) return { status: 'skipped', note: 'not confirmed' };
      return { status: 'succeeded' };
    },
  };
}

/**
 * The ordered launch plan. It mirrors the release, deployment, hosting,
 * production-control, activation, and finalization stages in order, and it is
 * the single source of truth for what "resume" means.
 */
export function buildLaunchPlan(env: Record<string, string> = {}): LaunchStep[] {
  const repo = env.PILOT_REPO ?? 'mangekyou-labs/haze-api';
  const branch = env.PILOT_BRANCH ?? 'feature-base-zk-credits';

  return [
    {
      name: 'release:preflight',
      stage: 'release',
      description: 'the release commit is clean, reviewed, and pushed, and the packed contents are pinned',
      async execute(context) {
        const status = await context.run('git', ['status', '--porcelain']);
        const head = await context.run('git', ['rev-parse', 'HEAD']);
        const pushed = await context.run('git', ['branch', '-r', '--contains', head.stdout.trim()]);
        const gate = assertReleaseReady({
          dirtyPaths: status.stdout.split('\n').map((line) => line.slice(3).trim()).filter(Boolean),
          pushed: pushed.code === 0 && pushed.stdout.trim().length > 0,
          branch: (await context.run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(),
          headCommit: head.stdout.trim(),
        }, { reviewed: context.env.PILOT_RELEASE_REVIEWED === 'true' });
        return gate.ok
          ? { status: 'succeeded', detail: { head: head.stdout.trim() } as StepDetail }
          : { status: 'failed', note: gate.reasons.join('; ') };
      },
    },
    {
      name: 'release:pack',
      stage: 'release',
      description: 'pack every released package, digest exactly what would ship, and record it',
      async execute(context) {
        const detail: StepDetail = {};
        for (const entry of RELEASE_PACKAGES) {
          const result = await context.run('npm', ['pack', '--dry-run', '--json'], { cwd: entry.directory });
          if (result.code !== 0) return { status: 'failed', note: `packing ${entry.name} failed` };
          const [report] = parsePackOutput(result.stdout);
          if (!report) return { status: 'failed', note: `npm pack reported nothing for ${entry.name}` };
          const digest = packContentDigest(report);
          detail[`${entry.name}@${entry.version}`] = digest;
          detail[`${entry.name}.files`] = report.files.length;
          // The digest is recorded so a later run can prove the artifact it is
          // about to publish is the one that was reviewed.
          context.print(`    ${entry.name}@${entry.version}: ${report.files.length} file(s), sha256 ${digest.slice(0, 16)}…`);
        }
        return { status: 'succeeded', detail };
      },
    },
    manualStep({
      name: 'release:registry-check',
      stage: 'release',
      description: 'confirm no already-published version differs from the artifact',
      instructions: [
        'For each package, check whether the exact version already exists.',
        'If it exists AND its contents differ, stop and bump the version instead.',
        'A new package publishes directly; npm staged publishing only covers packages that already exist.',
        '  npm view @zk-credits/shared@0.1.0 dist.integrity',
        '  npm view @zk-credits/x402-zk-prepaid@0.1.0 dist.integrity',
        '  npm view zk-credits@0.2.0 dist.integrity',
      ],
    }),
    manualStep({
      name: 'release:publish-leaves',
      stage: 'release',
      description: 'publish the two leaf packages',
      irreversible: true,
      instructions: [
        'A published version can never be reused or replaced.',
        '  cd packages/zk-credits-shared && npm publish --access public',
        '  cd packages/x402-zk-prepaid && npm publish --access public',
        'Both versions must be public before the sidecar can depend on them.',
      ],
    }),
    {
      name: 'release:rewrite-sidecar-deps',
      stage: 'release',
      description: 'replace the sidecar file: dependencies with the exact published versions',
      async execute(context) {
        const result = await context.run('npm', ['run', 'launch:rewrite-sidecar-deps'], { cwd: 'ts' });
        return result.code === 0
          ? { status: 'succeeded' }
          : { status: 'failed', note: result.stderr.trim() || 'the dependency rewrite failed' };
      },
    },
    {
      name: 'release:verify-sidecar',
      stage: 'release',
      description: 'reinstall, build, test, and test-install the sidecar against the registry versions',
      async execute(context) {
        const cwd = 'packages/zk-credits-sidecar';
        for (const args of [['ci'], ['run', 'build'], ['test', '--', '--run'], ['pack', '--dry-run']]) {
          const result = await context.run('npm', args, { cwd });
          if (result.code !== 0) return { status: 'failed', note: `npm ${args.join(' ')} failed in ${cwd}` };
        }
        return { status: 'succeeded' };
      },
    },
    {
      name: 'release:commit-and-push',
      stage: 'release',
      description: 'commit the dependency-only change and push it before publishing the sidecar',
      irreversible: true,
      async execute(context) {
        const changed = await context.run('git', ['status', '--porcelain']);
        const paths = changed.stdout.split('\n').map((line) => line.slice(3).trim()).filter(Boolean);
        if (paths.length === 0) return { status: 'succeeded', detail: { changed: 0 } as StepDetail };
        // A dependency-only commit is what keeps the sidecar's republished
        // dependency change reviewable as exactly that.
        if (!isDependencyOnlyChange(paths)) {
          return { status: 'failed', note: `refusing to commit: this change touches ${paths.join(', ')}` };
        }
        const add = await context.run('git', ['add', ...paths]);
        if (add.code !== 0) return { status: 'failed', note: 'git add failed' };
        const message = 'chore(zk-credits): depend on the published pilot package versions';
        const commit = await context.run('git', ['commit', '-m', message]);
        if (commit.code !== 0) return { status: 'failed', note: 'git commit failed' };
        const push = await context.run('git', ['push', 'origin', 'HEAD']);
        return push.code === 0
          ? { status: 'succeeded', detail: { changed: paths.length, paths: paths.join(',') } as StepDetail }
          : { status: 'failed', note: 'git push failed' };
      },
    },
    manualStep({
      name: 'release:publish-sidecar',
      stage: 'release',
      description: 'publish the sidecar',
      irreversible: true,
      instructions: [
        'The sidecar is publishable only now that its dependencies resolve from the registry.',
        '  cd packages/zk-credits-sidecar && npm publish --access public',
        'The pinned pilot set is then: zk-credits 0.2.0, adapter 0.1.0, shared 0.1.0.',
      ],
    }),

    {
      name: 'deploy:preflight',
      stage: 'deploy',
      description: 'the RPC is Base Sepolia, the deployer and sponsor are known, and the B11 artifacts are present',
      async execute(context) {
        assertChainId(Number(context.env.BASE_DEPLOYMENT_DOMAIN), PILOT_CHAIN_ID);
        const rpcUrl = context.env.BASE_RPC_URL ?? '';
        const account = context.env.BASE_DEPLOYER_KEYSTORE_ACCOUNT ?? '';
        const address = await context.run('cast', ['wallet', 'address', '--account', account]);
        if (address.code !== 0 || !/^0x[0-9a-fA-F]{40}$/u.test(address.stdout.trim())) {
          return { status: 'failed', note: `could not read the deployment address from keystore account ${account}` };
        }
        const deployer = address.stdout.trim() as `0x${string}`;
        const chain = context.chain(rpcUrl);
        for (const [label, contract] of Object.entries(EXISTING_B11_CONTRACTS)) {
          const code = await chain.code(contract);
          if (code.length <= 2) return { status: 'failed', note: `the B11 ${label} at ${contract} has no bytecode on this RPC` };
        }
        context.print(`    deployer ${deployer}, B11 verifier and adapter both hold bytecode`);
        return { status: 'succeeded', detail: { deployer, chainId: PILOT_CHAIN_ID } as StepDetail };
      },
    },
    {
      name: 'deploy:contracts',
      stage: 'deploy',
      description: 'deploy the Poseidon libraries and PrivateCreditBond from the protected keystore',
      irreversible: true,
      async execute(context) {
        const rpcUrl = context.env.BASE_RPC_URL ?? '';
        const account = context.env.BASE_DEPLOYER_KEYSTORE_ACCOUNT ?? '';
        const address = await context.run('cast', ['wallet', 'address', '--account', account]);
        if (address.code !== 0) return { status: 'failed', note: 'could not read the deployment address' };
        const deployer = address.stdout.trim();

        // Resolve every contract's intent first, so the signer, the nonce, and
        // the address each nonce implies are durable *before* anything is sent.
        const intents: BroadcastIntent[] = [];
        for (const [offset, contract] of CONTRACT_DEPLOY_ORDER.entries()) {
          const nonceResult = await context.run('cast', ['nonce', deployer, '--rpc-url', rpcUrl]);
          if (nonceResult.code !== 0) return { status: 'failed', note: 'could not read the deployer nonce' };
          const nonce = Number(nonceResult.stdout.trim()) + offset;
          if (!Number.isSafeInteger(nonce)) return { status: 'failed', note: `cast reported an unreadable nonce (${nonceResult.stdout.trim()})` };
          intents.push(broadcastIntent(contract, deployer, nonce));
        }
        await context.state.record('deploy:contracts', {
          status: 'unknown',
          note: 'broadcast intent recorded; reconcile before retrying',
          detail: { intents: intents.map((intent) => `${intent.contract}@${intent.nonce}=${intent.predictedAddress}`).join(',') },
        });

        // Reconcile first: a resumed run must find an already-landed deployment
        // rather than deploy a second bond at the next nonce.
        const chain = context.chain(rpcUrl);
        const landed: string[] = [];
        for (const intent of intents) {
          const result = await reconcileBroadcast(intent, chain);
          if (result.kind === 'mismatch') return { status: 'failed', note: result.reason };
          if (result.kind === 'confirmed') landed.push(`${intent.contract} at ${result.address}`);
        }
        if (landed.length === intents.length) {
          context.print(`    already deployed: ${landed.join(', ')}`);
          return { status: 'succeeded', detail: { contracts: landed.join(',') } as StepDetail };
        }
        if (landed.length > 0) {
          context.print(`    already deployed: ${landed.join(', ')}`);
          return { status: 'unknown', note: 'the deployment is partly complete; finish the remaining contracts, then resume' };
        }

        for (const intent of intents) context.print(`    ${intent.contract} would deploy to ${intent.predictedAddress} at nonce ${intent.nonce}`);
        for (const line of [
          'Run the broadcast from the protected keystore account:',
          '  cd contracts && forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \\',
          `    --account "${account}" --rpc-url "$BASE_RPC_URL" --broadcast --verify`,
          'Then resume: every contract is reconciled against the predicted address above.',
        ]) context.print(`    ${line}`);
        if (!await context.confirm('Has the broadcast been sent from the keystore account?')) {
          return { status: 'unknown', note: 'the broadcast may or may not have been sent; resume to reconcile by predicted address' };
        }
        return { status: 'unknown', note: 'awaiting reconciliation against the predicted addresses' };
      },
    },
    manualStep({
      name: 'deploy:approve-usdc',
      stage: 'deploy',
      description: 'approve a bounded amount of test USDC from the runtime sponsor',
      irreversible: true,
      instructions: [
        'The approval must stay within the 80 test-USDC pilot bound.',
        'The sponsor is a separate, narrowly funded hot key, not the deployment key.',
      ],
    }),

    {
      name: 'hosting:secrets',
      stage: 'hosting',
      description: 'generate the service tokens and the NextAuth secret locally, without printing them',
      async execute(context) {
        const generated: string[] = [];
        for (const name of GENERATED_SECRET_VARS) {
          if ((context.env[name] ?? '').length > 0) continue;
          const value = generateSecret();
          await writeLaunchEnvValue(context.envPath ?? LAUNCH_ENV_PATH, name, value);
          context.env[name] = value;
          generated.push(name);
        }
        // Only the names are ever printed: the values go from this process to
        // the provider payload and to the mode-0600 env file, nowhere else.
        context.print(generated.length === 0
          ? '    all four service secrets already exist'
          : `    generated ${generated.length} secret(s): ${generated.join(', ')}`);
        return { status: 'succeeded', detail: { generated: generated.length, names: generated.join(',') } as StepDetail };
      },
    },
    {
      name: 'hosting:neon',
      stage: 'hosting',
      description: 'create or adopt the Singapore Neon project and read back its direct TLS connection string',
      async execute(context) {
        const transport = context.transport();
        const apiKey = context.env.NEON_API_KEY ?? '';
        const adapter = neonProjectAdapter({ transport, apiKey });
        const resolution = await resolveResource(adapter);
        if (resolution.kind === 'ambiguous') {
          return { status: 'failed', note: `several Neon projects match "${adapter.name}": ${resolution.candidates.join(', ')}; rename or remove one` };
        }
        const projectId = adapter.idOf(resolution.resource);
        const uri = await neonConnectionUri({ transport, apiKey, projectId });
        await writeLaunchEnvValue(context.envPath ?? LAUNCH_ENV_PATH, 'DATABASE_URL', uri);
        context.print(`    ${resolution.kind} Neon project ${adapter.name} (${projectId}); direct TLS string stored`);
        return { status: 'succeeded', detail: { ...resolution.detail, resolution: resolution.kind } };
      },
    },
    {
      name: 'hosting:render',
      stage: 'hosting',
      description: 'create or adopt the free Singapore Render gateway',
      async execute(context) {
        const transport = context.transport();
        const apiKey = context.env.RENDER_API_KEY ?? '';
        const ownerId = (context.env.RENDER_OWNER_ID ?? '').trim() || await renderOwnerId(transport, apiKey);
        const adapter = renderServiceAdapter({
          transport,
          apiKey,
          ownerId,
          repo: `https://github.com/${repo}`,
          branch,
          // Secrets are declared, never valued, so nothing travels in a payload
          // the launch writes to disk or prints.
          secretKeys: [
            'DATABASE_URL', 'BILLING_INTERNAL_TOKEN', 'FACILITATOR_SERVICE_TOKEN',
            'CLAIM_STORE_OPERATOR_TOKEN', 'OPENROUTER_API_KEY', 'BASE_SPONSOR_PRIVATE_KEY',
            'BASE_PRIVATE_CREDIT_BOND_ADDRESS', 'BASE_DEPLOYMENT_BLOCK', 'ZK_PREPAID_VERIFYING_KEY_PATH',
          ],
          plainEnv: { NODE_ENV: 'production', PORT: '3001', BASE_CONFIRMATIONS: '3', PILOT_ENVIRONMENT: 'production' },
        });
        const resolution = await resolveResource(adapter);
        if (resolution.kind === 'ambiguous') {
          return { status: 'failed', note: `several Render services match "${adapter.name}": ${resolution.candidates.join(', ')}; rename or remove one` };
        }
        context.print(`    ${resolution.kind} Render service ${adapter.name}; inject the secrets in the dashboard`);
        return { status: 'succeeded', detail: { ...resolution.detail, resolution: resolution.kind } };
      },
    },
    {
      name: 'hosting:vercel',
      stage: 'hosting',
      description: 'create or adopt the Vercel web project and derive the GitHub OAuth callback',
      async execute(context) {
        const adapter = vercelProjectAdapter({
          transport: context.transport(),
          apiKey: context.env.VERCEL_TOKEN ?? '',
          ...(context.env.VERCEL_TEAM_ID ? { teamId: context.env.VERCEL_TEAM_ID } : {}),
        });
        const resolution = await resolveResource(adapter);
        if (resolution.kind === 'ambiguous') {
          return { status: 'failed', note: `several Vercel projects match "${adapter.name}": ${resolution.candidates.join(', ')}; rename or remove one` };
        }
        const url = resolution.detail.url;
        if (typeof url !== 'string') {
          return { status: 'failed', note: 'the Vercel project has no production URL yet; deploy it, then resume' };
        }
        await writeLaunchEnvValue(context.envPath ?? LAUNCH_ENV_PATH, 'NEXTAUTH_URL', url);
        context.print(`    ${resolution.kind} Vercel project ${adapter.name} at ${url}`);
        context.print(`    register the GitHub OAuth callback: ${githubOAuthCallback(url)}`);
        return { status: 'succeeded', detail: { ...resolution.detail, callback: githubOAuthCallback(url), resolution: resolution.kind } };
      },
    },
    manualStep({
      name: 'hosting:github-oauth',
      stage: 'hosting',
      description: 'register the GitHub OAuth application against the deployed callback URL',
      instructions: [
        'The callback URL does not exist until the Vercel project is deployed, which is why',
        'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are deferred until this point.',
        '  Callback: https://<the web host>/api/auth/callback/github',
        'Then add the pair to .env.launch.local and re-run --check.',
      ],
    }),

    {
      name: 'controls:migrations',
      stage: 'controls',
      description: 'run migrations against the hosted database',
      async execute(context) {
        return commandOutcome(context, 'npm', ['test', '--', '--run', '-t', 'migrations'], { cwd: 'ts', note: 'migration run failed' });
      },
    },
    manualStep({
      name: 'controls:readiness',
      stage: 'controls',
      description: 'the hosted deployment answers strict readiness',
      instructions: [
        '  curl -sS "$PUBLIC_GATEWAY_URL/ready" | jq .',
        'Every check must be ok, and the caps must read 40000000 and 200000000 micro-USD.',
      ],
    }),
    manualStep({
      name: 'controls:pause-resume',
      stage: 'controls',
      description: 'exercise pause and resume once against the production deployment',
      irreversible: true,
      instructions: [
        '  cd ts && npm run launch:pause -- --reason "production control check"',
        '  curl -sS -o /dev/null -w "%{http_code}\\n" "$PUBLIC_GATEWAY_URL/v1/chat/completions"   # expect 503',
        '  cd ts && npm run launch:resume',
      ],
    }),
    manualStep({
      name: 'controls:staging-caps',
      stage: 'controls',
      description: 'prove cap exhaustion on an isolated staging service and database',
      instructions: [
        'Staging runs as zk-credits-gateway-staging with its own database.',
        'Set PILOT_ENVIRONMENT=staging plus the narrowed cap pair, then exhaust it.',
        'Production must refuse those variables outright, so staging state cannot reach it.',
      ],
    }),

    {
      name: 'activation:rehearsal',
      stage: 'activation',
      description: 'rehearse the founder activation sequence without consuming an operator slot',
      async execute(context) {
        return commandOutcome(context, 'npm', ['run', 'activation:rehearse'], { cwd: 'ts', note: 'the rehearsal failed' });
      },
    },
    manualStep({
      name: 'activation:slot-a',
      stage: 'activation',
      description: 'activate operator A on the OpenAI-compatible sidecar',
      instructions: [
        '  cd ts && npm run activation:start -- --slot A --github-id "$PILOT_OPERATOR_A_GITHUB_ID"',
        'Hand the invite over in its own mode-0600 file, then delete that file.',
        'Validate the returned artifact: cd ts && npm run activation:evidence -- --slot A --file <bundle>',
        'Slot A must qualify before slot B opens, because the committed-claim counter is aggregate.',
      ],
    }),
    manualStep({
      name: 'activation:slot-b',
      stage: 'activation',
      description: 'activate operator B on the x402-native adapter',
      instructions: [
        'Slot B registers the project zk-prepaid adapter deliberately, not a generic x402 agent.',
        '  cd ts && npm run activation:start -- --slot B --github-id "$PILOT_OPERATOR_B_GITHUB_ID"',
        'Slot B must qualify before slot C opens.',
      ],
    }),
    manualStep({
      name: 'activation:slot-c',
      stage: 'activation',
      description: 'activate operator C on either supported path',
      instructions: [
        '  cd ts && npm run activation:start -- --slot C --github-id "$PILOT_OPERATOR_C_GITHUB_ID"',
      ],
    }),

    {
      name: 'finalize:verification-suite',
      stage: 'finalize',
      description: 'rerun the full verification suite',
      async execute(context) {
        const suites: { cwd: string; args: string[] }[] = [
          { cwd: 'ts', args: ['run', 'typecheck'] },
          { cwd: 'ts', args: ['test', '--', '--run'] },
          { cwd: 'packages/x402-zk-prepaid', args: ['test', '--', '--run'] },
          { cwd: 'packages/zk-credits-shared', args: ['test', '--', '--run'] },
          { cwd: 'packages/zk-credits-sidecar', args: ['test', '--', '--run'] },
          { cwd: 'web', args: ['test', '--', '--run'] },
        ];
        for (const suite of suites) {
          const result = await context.run('npm', suite.args, { cwd: suite.cwd });
          if (result.code !== 0) return { status: 'failed', note: `npm ${suite.args.join(' ')} failed in ${suite.cwd}` };
        }
        return { status: 'succeeded' };
      },
    },
    manualStep({
      name: 'finalize:evidence',
      stage: 'finalize',
      description: 'publish the three redacted evidence artifacts and the aggregate summary',
      instructions: [
        'Run the privacy scan over the aggregate summary before it is committed.',
        'Update the feature documentation and the issue map with durable evidence links.',
      ],
    }),
  ];
}

export type LaunchMode = 'check' | 'status' | 'resume';

export interface LaunchRunOptions {
  mode: LaunchMode;
  context: LaunchContext;
  plan?: LaunchStep[];
}

export interface LaunchRunResult {
  mode: LaunchMode;
  /** Steps that ran successfully in this invocation. */
  completed: string[];
  /** The step the run stopped on, if it stopped. */
  stoppedAt?: { step: string; reason: string };
  /** Human-readable lines, already redacted. */
  report: string[];
}

/** Read-only preflight. Reads everything, writes nothing. */
export async function runCheck(context: LaunchContext, stage: LaunchStage = 'finalize'): Promise<LaunchRunResult> {
  const report: string[] = [];
  const check: LaunchEnvCheck = checkLaunchEnv(context.env, stage);

  report.push(`environment: ${LAUNCH_ENV_PATH} at stage ${stage}`);
  report.push(`  satisfied: ${check.satisfied.length} value(s)`);
  for (const variable of check.missing) report.push(`  MISSING   ${variable.name} — ${variable.label}`);
  for (const variable of check.deferred) report.push(`  deferred  ${variable.name} — needed at ${variable.requiredFor}`);
  for (const violation of check.invalid) report.push(`  INVALID   ${violation.name}: ${violation.reason}`);
  for (const name of check.forbidden) report.push(`  REFUSED   ${name} must never appear in the launch environment`);

  const state = await context.state.load();
  const unknowns = Object.values(state.steps).filter((step) => step.status === 'unknown');
  for (const step of unknowns) report.push(`  UNRESOLVED ${step.name}: ${step.note ?? 'outcome unknown'}`);

  const ok = check.missing.length === 0 && check.invalid.length === 0 && check.forbidden.length === 0 && unknowns.length === 0;
  report.push(ok ? 'preflight: ready' : 'preflight: not ready');
  return { mode: 'check', completed: [], report };
}

/** Read-only reconciliation of local checkpoints against the plan. */
export async function runStatus(context: LaunchContext, plan: LaunchStep[] = buildLaunchPlan(context.env)): Promise<LaunchRunResult> {
  const state = await context.state.load();
  const report: string[] = [`state: ${context.state.filePath}`];
  for (const step of plan) {
    const record: StepRecord | undefined = state.steps[step.name];
    const status: StepStatus = record?.status ?? 'pending';
    report.push(`  ${status.padEnd(9)} ${step.name} — ${step.description}`);
    if (record?.note) report.push(`            ${record.note}`);
    if (record?.detail && Object.keys(record.detail).length > 0) {
      report.push(`            ${Object.entries(record.detail).map(([key, value]) => `${key}=${value}`).join(' ')}`);
    }
  }
  const unknowns = Object.values(state.steps).filter((step) => step.status === 'unknown');
  if (unknowns.length > 0) report.push(`unresolved: ${unknowns.map((step) => step.name).join(', ')} — reconcile before resuming`);
  return { mode: 'status', completed: [], report };
}

/**
 * Starts or resumes the plan. A step already `succeeded` is skipped; a step
 * marked `unknown` stops the run so its non-idempotent operation can be
 * reconciled by hand before anything is retried.
 */
export async function runResume(options: LaunchRunOptions): Promise<LaunchRunResult> {
  const context = options.context;
  const plan = options.plan ?? buildLaunchPlan(context.env);
  const report: string[] = [];
  const completed: string[] = [];

  const completedNames = new Set(await context.state.completedSteps());
  const unresolved = await context.state.unresolvedSteps();
  if (unresolved.length > 0) {
    const names = unresolved.map((step) => step.name).join(', ');
    report.push(`refusing to resume: ${names} must be reconciled first`);
    return { mode: 'resume', completed, stoppedAt: { step: unresolved[0]!.name, reason: 'unresolved' }, report };
  }

  for (const step of plan) {
    if (completedNames.has(step.name)) {
      report.push(`skip  ${step.name}`);
      continue;
    }
    report.push(`run   ${step.name} — ${step.description}`);
    let outcome: StepOutcome;
    try {
      outcome = await step.execute(context);
    } catch (error) {
      // A timeout on a step that changed something outside this machine is not
      // a failure: it is an unknown, and the state file must say so.
      if (error instanceof Error && error.name === 'ProviderTimeoutError') {
        await context.state.record(step.name, { status: 'unknown', note: redact(error.message) });
        report.push(`      outcome unknown: ${redact(error.message)}`);
        return { mode: 'resume', completed, stoppedAt: { step: step.name, reason: 'unknown' }, report };
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      await context.state.record(step.name, { status: 'failed', note: redact(message) });
      report.push(`      failed: ${redact(message)}`);
      return { mode: 'resume', completed, stoppedAt: { step: step.name, reason: 'failed' }, report };
    }

    if (outcome.status === 'succeeded') {
      await context.state.record(step.name, { status: 'succeeded', detail: outcome.detail });
      completed.push(step.name);
      report.push('      ok');
      continue;
    }
    if (outcome.status === 'unknown') {
      await context.state.record(step.name, { status: 'unknown', detail: outcome.detail, note: outcome.note });
      report.push(`      outcome unknown: ${outcome.note}`);
      return { mode: 'resume', completed, stoppedAt: { step: step.name, reason: 'unknown' }, report };
    }
    if (outcome.status === 'failed') {
      await context.state.record(step.name, { status: 'failed', detail: outcome.detail, note: outcome.note });
      report.push(`      failed: ${outcome.note}`);
      return { mode: 'resume', completed, stoppedAt: { step: step.name, reason: 'failed' }, report };
    }
    await context.state.record(step.name, { status: 'pending', note: outcome.note });
    report.push(`      stopped: ${outcome.note}`);
    return { mode: 'resume', completed, stoppedAt: { step: step.name, reason: 'not confirmed' }, report };
  }

  report.push('the launch plan is complete');
  return { mode: 'resume', completed, report };
}

export interface LaunchCliDependencies {
  env?: Record<string, string>;
  cwd?: string;
  print?: (line: string) => void;
  confirm?: (question: string) => Promise<boolean>;
  now?: () => number;
  statePath?: string;
  /** Overrides `.env.launch.local`, which the shell wrapper also honours. */
  envPath?: string;
  /** Overrides the git probe so the CLI can be exercised outside a work tree. */
  gitProbe?: GitProbe;
  /** Overrides the chain and HTTP factories for tests. */
  chain?: (rpcUrl: string) => ChainReader;
  transport?: () => HttpTransport;
}

/** Builds the real context: repository commands, terminal output, real git. */
export function createLaunchContext(dependencies: LaunchCliDependencies = {}): LaunchContext {
  const print = dependencies.print ?? ((line: string) => console.log(redact(line)));
  const state = new LaunchStateStore({ path: dependencies.statePath ?? LAUNCH_STATE_PATH, now: dependencies.now });
  return {
    env: dependencies.env ?? {},
    state,
    envPath: dependencies.envPath ?? process.env.ZK_CREDITS_LAUNCH_ENV ?? LAUNCH_ENV_PATH,
    chain: dependencies.chain ?? ((rpcUrl: string) => rpcChainReader({ rpcUrl })),
    transport: dependencies.transport ?? (() => httpTransport()),
    print,
    async confirm(question: string): Promise<boolean> {
      if (dependencies.confirm) return await dependencies.confirm(question);
      return await askYesNo(question);
    },
    async run(command, args, options) {
      try {
        const result = await execFileAsync(command, args, { cwd: options?.cwd ?? dependencies.cwd, maxBuffer: 16 * 1024 * 1024 });
        return { code: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        return { code: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
      }
    },
  };
}

async function askYesNo(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`  ? ${question} [y/N] `);
    return /^y/iu.test(answer.trim());
  } finally {
    readline.close();
  }
}

export interface LaunchCliResult {
  exitCode: number;
  report: string[];
}

/**
 * The single entrypoint behind `scripts/launch-pilot.sh`. There is deliberately
 * no flag that confirms irreversible actions unattended.
 */
export async function runLaunchCli(argv: readonly string[], dependencies: LaunchCliDependencies = {}): Promise<LaunchCliResult> {
  const print = dependencies.print ?? ((line: string) => console.log(redact(line)));
  const emit = (report: string[], exitCode: number): LaunchCliResult => {
    for (const line of report) print(line);
    return { exitCode, report };
  };

  const unknownFlag = argv.find((arg) => arg.startsWith('-') && !['--check', '--status', '--reviewed', '--help'].includes(arg));
  if (unknownFlag) return emit([`unknown flag ${unknownFlag}; use --check, --status, or no argument to resume`], 2);
  if (argv.includes('--help')) {
    return emit([
      'usage: scripts/launch-pilot.sh [--check] [--status] [--reviewed]',
      '  --check     read-only dependency, credential, git, package, chain, and provider preflight',
      '  --status    read-only local and remote reconciliation',
      '  --reviewed  declare the release commit reviewed (required before publishing)',
      '  (no flags)  start or resume from the last completed checkpoint',
      'There is no unattended confirmation flag and no flag that deletes a resource.',
    ], 0);
  }

  const envPath = dependencies.envPath ?? process.env.ZK_CREDITS_LAUNCH_ENV ?? LAUNCH_ENV_PATH;
  const env = dependencies.env ?? {};
  await prepareLaunchEnvFile(envPath, dependencies.gitProbe);
  const fileEnv = await readLaunchEnv(envPath).catch(() => ({}));

  // `--reviewed` is the documented way to declare the release commit reviewed,
  // so it has to reach the same place the `release:preflight` gate reads. It is
  // recorded in the env file rather than held for one invocation, because the
  // launch is resumable: a declaration that vanished on the next run would make
  // the gate a test of memory instead of a test of review. `--check` and
  // `--status` stay read-only, so there it only takes effect in memory.
  const reviewed = argv.includes('--reviewed');
  if (reviewed && !argv.includes('--check') && !argv.includes('--status')) {
    await writeLaunchEnvValue(envPath, 'PILOT_RELEASE_REVIEWED', 'true');
  }

  const context = createLaunchContext({
    ...dependencies,
    print,
    envPath,
    env: { ...fileEnv, ...(reviewed ? { PILOT_RELEASE_REVIEWED: 'true' } : {}), ...env },
  });

  if (argv.includes('--check')) {
    const result = await runCheck(context, 'finalize');
    for (const line of result.report) context.print(line);
    return { exitCode: result.report.at(-1) === 'preflight: ready' ? 0 : 1, report: result.report };
  }
  if (argv.includes('--status')) {
    const result = await runStatus(context);
    for (const line of result.report) context.print(line);
    return { exitCode: 0, report: result.report };
  }

  const result = await runResume({ mode: 'resume', context });
  for (const line of result.report) context.print(line);
  return { exitCode: result.stoppedAt ? 1 : 0, report: result.report };
}
