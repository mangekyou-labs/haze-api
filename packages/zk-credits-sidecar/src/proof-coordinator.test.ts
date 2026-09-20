import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCircuitManifest } from './artifact-bundle.js';
import type { BaseProofContext, BaseProofInput } from './base-sidecar.js';
import {
  createPinnedBaseProofGenerator,
  ProofCoordinatorError,
  type ProofWorkerFactory,
} from './proof-coordinator.js';
import { createBaseProofMetrics, type BaseProofMetrics } from './proof-metrics.js';
import type { ProofWorkerRequest, ProofWorkerResult } from './proof-child.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function installedBundle() {
  const directory = await mkdtemp(join(tmpdir(), 'zk-credits-coordinator-'));
  temporaryDirectories.push(directory);
  const files = {
    'private_credit_spend.wasm': 'wasm-bytes',
    'private_credit_spend.zkey': 'zkey-bytes',
    'verification_key_private_credit.json': JSON.stringify({ protocol: 'groth16', curve: 'bn128', nPublic: 6 }),
  };
  await Promise.all(Object.entries(files).map(([file, content]) => writeFile(join(directory, file), content)));
  const manifest = parseCircuitManifest({
    version: 1,
    scheme: 'zk-prepaid',
    network: 'eip155:84532',
    circuit: {
      id: 'private-credit-spend-bn254-dev',
      depth: 20,
      wasm: 'private_credit_spend.wasm',
      zkey: 'private_credit_spend.zkey',
      verificationKey: 'verification_key_private_credit.json',
    },
    artifacts: Object.entries(files).map(([file, content]) => ({ file, sha256: digest(content) })),
  });
  return { directory, manifest };
}

const EXPECTED_SIGNALS = ['11', '22', '33', '44', '55', '66'];
/** Gateway-issued challenge second and the millisecond clock inside its window. */
const ISSUED_AT = 1_000_000;
const NOW_MS = 1_000_000_000;
const deadline = (ISSUED_AT + 300) * 1000;

const input = {
  secret: '7',
  tier_id: '0',
  expiry: '1800000000',
  slot: '4',
  merkle_path_elements: Array.from({ length: 20 }, () => '0'),
  merkle_path_indices: Array.from({ length: 20 }, () => '0'),
  root_in: EXPECTED_SIGNALS[0]!,
  timestamp_in: EXPECTED_SIGNALS[1]!,
  domain_in: EXPECTED_SIGNALS[2]!,
  request_signal_in: EXPECTED_SIGNALS[3]!,
} satisfies BaseProofInput;

function context(issuedAt: number, maxTimeoutSeconds = 300): BaseProofContext {
  return {
    requirements: {
      scheme: 'zk-prepaid',
      network: 'eip155:84532',
      amount: '1',
      asset: 'coding-deepseek-v4-flash-v1',
      payTo: '0x00000000000000000000000000000000000000b2',
      maxTimeoutSeconds,
      extra: {
        assetTransferMethod: 'prepaid-claim',
        paymentFlow: 'escrow',
        circuit: 'private-credit-spend-bn254-dev',
        verifyingKey: 'dev',
        deploymentDomain: '84532',
        contract: '0x00000000000000000000000000000000000000a1',
        requirementsVersion: 'zk-prepaid-v1',
        issuedAt,
      },
    },
    credential: {
      version: 1,
      secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      commitment: '1',
      tierId: 0,
      expiry: 1_800_000_000,
      deploymentDomain: '84532',
    },
    expectedPublicSignals: EXPECTED_SIGNALS,
  };
}

function scriptedWorker(scripts: Array<(request: ProofWorkerRequest, call: number) => Promise<ProofWorkerResult> | ProofWorkerResult>) {
  let call = 0;
  let active = 0;
  let maxActive = 0;
  const inputs: ProofWorkerRequest[] = [];
  const terminated: number[] = [];
  const factory: ProofWorkerFactory = (request) => {
    const index = call;
    call += 1;
    inputs.push(request);
    active += 1;
    maxActive = Math.max(maxActive, active);
    const script = scripts[Math.min(index, scripts.length - 1)]!;
    const result = Promise.resolve()
      .then(() => script(request, index))
      .finally(() => { active -= 1; });
    result.catch(() => undefined);
    return {
      result,
      terminate: async () => { terminated.push(index); },
    };
  };
  return { factory, inputs, terminated, maxActive: () => maxActive, calls: () => call };
}

const proof = (publicSignals: string[]): ProofWorkerResult => ({ proof: { pi_a: ['1', '2'], pi_b: [['3']], pi_c: ['4'] }, publicSignals });

async function generator(options: {
  scripts: Parameters<typeof scriptedWorker>[0];
  metrics?: BaseProofMetrics;
  verify?: () => Promise<boolean>;
  timeoutMs?: number;
  now?: () => number;
  artifacts?: Awaited<ReturnType<typeof installedBundle>>;
}) {
  const bundle = options.artifacts ?? await installedBundle();
  const worker = scriptedWorker(options.scripts);
  const prove = await createPinnedBaseProofGenerator({
    artifactDirectory: bundle.directory,
    manifest: bundle.manifest,
    metrics: options.metrics,
    workerFactory: worker.factory,
    verifyProof: options.verify ?? (async () => true),
    timeoutMs: options.timeoutMs ?? 10_000,
    now: options.now,
  });
  return { prove, worker };
}

function clockSequence(values: number[], fallback: number): () => number {
  let index = 0;
  return () => (index < values.length ? values[index++]! : fallback);
}

describe('pinned local proof coordinator', () => {
  it('fails closed on an incomplete installed bundle and records the artifact category', async () => {
    const bundle = await installedBundle();
    await rm(join(bundle.directory, 'private_credit_spend.zkey'));
    const metrics = createBaseProofMetrics();
    await expect(createPinnedBaseProofGenerator({
      artifactDirectory: bundle.directory,
      manifest: bundle.manifest,
      metrics,
      workerFactory: scriptedWorker([() => proof(EXPECTED_SIGNALS)]).factory,
    })).rejects.toThrow('missing from the pinned bundle');
    expect(metrics.snapshot().failuresByCategory.artifact_missing).toBe(1);
  });

  it('serializes proves to one active attempt per process', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { prove, worker } = await generator({
      scripts: [
        async () => { await gate; return proof(EXPECTED_SIGNALS); },
        () => proof(EXPECTED_SIGNALS),
      ],
      now: () => NOW_MS,
    });
    const contextValue = context(ISSUED_AT);
    const first = prove(input, contextValue);
    const second = prove(input, contextValue);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(worker.maxActive()).toBe(1);
    release!();
    await expect(first).resolves.toMatchObject({ publicSignals: EXPECTED_SIGNALS });
    await expect(second).resolves.toMatchObject({ publicSignals: EXPECTED_SIGNALS });
    expect(worker.maxActive()).toBe(1);
  });

  it('terminates a stalled prove at the deadline and records a timeout', async () => {
    const metrics = createBaseProofMetrics();
    const { prove, worker } = await generator({
      scripts: [() => new Promise<ProofWorkerResult>(() => undefined)],
      metrics,
      timeoutMs: 30,
      now: clockSequence([NOW_MS, NOW_MS, NOW_MS], deadline - 20),
    });
    await expect(prove(input, context(ISSUED_AT))).rejects.toThrow('deadline');
    expect(worker.terminated).toEqual([0]);
    expect(metrics.snapshot()).toMatchObject({ attempts: 1, failures: 1, retries: 0 });
    expect(metrics.snapshot().failuresByCategory.timeout).toBe(1);
  });

  it('refuses unverified and reordered statements without retrying', async () => {
    const metrics = createBaseProofMetrics();
    const unverified = await generator({
      scripts: [() => proof(EXPECTED_SIGNALS)],
      metrics,
      verify: async () => false,
      now: () => NOW_MS,
    });
    await expect(unverified.prove(input, context(ISSUED_AT))).rejects.toBeInstanceOf(ProofCoordinatorError);
    await expect(unverified.prove(input, context(ISSUED_AT))).rejects.toThrow('self-verification');
    expect(unverified.worker.calls()).toBe(2);
    expect(metrics.snapshot().failuresByCategory.self_verify_failed).toBe(2);
    expect(metrics.snapshot().retries).toBe(0);

    const reordered = await generator({
      scripts: [() => proof([...EXPECTED_SIGNALS].reverse())],
      now: () => NOW_MS,
    });
    await expect(reordered.prove(input, context(ISSUED_AT))).rejects.toThrow('canonical statement');
    expect(reordered.worker.calls()).toBe(1);
    expect(reordered.worker.terminated).toEqual([0]);
  });

  it('retries a timed-out attempt with the identical payment identity', async () => {
    const metrics = createBaseProofMetrics();
    const { prove, worker } = await generator({
      scripts: [
        () => new Promise<ProofWorkerResult>(() => undefined),
        () => proof(EXPECTED_SIGNALS),
      ],
      metrics,
      timeoutMs: 30,
      now: () => NOW_MS,
    });
    await expect(prove(input, context(ISSUED_AT))).resolves.toMatchObject({ publicSignals: EXPECTED_SIGNALS });
    expect(worker.calls()).toBe(2);
    expect(worker.inputs[1]).toEqual(worker.inputs[0]);
    expect(worker.terminated).toEqual([0, 1]);
    expect(metrics.snapshot()).toMatchObject({ attempts: 2, successes: 1, failures: 1, retries: 1 });
    expect(metrics.snapshot().hotProve.samples).toBe(1);
  });

  it('stops retrying once ten seconds or less remain in the challenge window', async () => {
    const metrics = createBaseProofMetrics();
    const { prove, worker } = await generator({
      scripts: [() => new Promise<ProofWorkerResult>(() => undefined)],
      metrics,
      timeoutMs: 30,
      // The attempt starts with 100 ms of window left and ends with only 20 ms.
      now: clockSequence([deadline - 100, deadline - 100, deadline - 100], deadline - 20),
    });
    await expect(prove(input, context(ISSUED_AT))).rejects.toThrow('deadline');
    expect(worker.calls()).toBe(1);
    expect(metrics.snapshot()).toMatchObject({ attempts: 1, retries: 0 });
    expect(metrics.snapshot().failuresByCategory.timeout).toBe(1);

    const stale = await generator({ scripts: [() => proof(EXPECTED_SIGNALS)], metrics, now: () => deadline - 5_000 });
    await expect(stale.prove(input, context(ISSUED_AT))).rejects.toThrow('too stale');
    expect(stale.worker.calls()).toBe(0);
    expect(metrics.snapshot().failuresByCategory.deadline_exhausted).toBe(1);
  });

  it('records only aggregate attempt data in the metrics snapshot', async () => {
    const metrics = createBaseProofMetrics({ now: () => 0 });
    const { prove } = await generator({ scripts: [() => proof(EXPECTED_SIGNALS)], metrics, now: () => NOW_MS });
    const value = context(ISSUED_AT);
    await prove(input, value);
    await prove(input, value);
    const snapshot = metrics.snapshot();
    expect(snapshot).toMatchObject({
      attempts: 2,
      successes: 2,
      failures: 0,
      retries: 0,
      hotProve: { samples: 1 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/nullifier|nonce|responseKey|commitment|secret|wallet|account/i);
    // No witness, proof, or field element can ride along in an aggregate.
    expect(JSON.stringify(snapshot)).not.toMatch(/"11"|"22"|"33"|"44"|"55"|"66"|\d{20,}/u);
  });
});
