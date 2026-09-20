/**
 * Opt-in artifact test.
 *
 * Runs the real frozen development bundle through `fullProve` inside the
 * compiled worker and requires the real Groth16 self-verification to accept
 * it. CI stays deterministic through the injected worker and crypto fixtures
 * in `proof-coordinator.test.ts`; this file runs only when both the installed
 * bundle and the built worker are present:
 *
 *   npm run build
 *   ZK_CREDITS_ARTIFACT_DIR="$PWD/circuits/artifacts" npx vitest run pinned-artifacts
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  computeCreditLeaf,
  createCredential,
  deriveSparseCreditWitness,
  generateSecret,
  secretFromBase64Url,
  secretToField,
  computeSlotBlinding,
  computeNullifier,
  computeShare,
} from '@zk-credits/shared/base';
import { ArtifactBundleError, resolvePinnedArtifactBundle, loadCircuitManifest } from './artifact-bundle.js';
import type { BaseProofContext, BaseProofInput } from './base-sidecar.js';
import { createPinnedBaseProofGenerator } from './proof-coordinator.js';
import { createBaseProofMetrics } from './proof-metrics.js';

const artifactDirectory = process.env.ZK_CREDITS_ARTIFACT_DIR
  ?? fileURLToPath(new URL('../circuits/artifacts', import.meta.url));
const proverPath = new URL('../dist/proof-child.js', import.meta.url);
const installed = existsSync(join(artifactDirectory, 'private_credit_spend.zkey'))
  && existsSync(join(artifactDirectory, 'private_credit_spend.wasm'))
  && existsSync(join(artifactDirectory, 'verification_key_private_credit.json'));
const proverBuilt = existsSync(fileURLToPath(proverPath));
const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fundedFixture() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const credential = await createCredential(generateSecret(), 0, issuedAt + 86_400, '84532');
  const leaf = await computeCreditLeaf(credential.commitment, credential.tierId, credential.expiry);
  const witness = await deriveSparseCreditWitness(new Map([[3, leaf]]), 3);
  const secret = secretFromBase64Url(credential.secret);
  const slot = 7;
  const signal = '12345678901234567890';
  const slotBlinding = await computeSlotBlinding(secret, slot, credential.deploymentDomain);
  const nullifier = await computeNullifier(slotBlinding);
  const share = await computeShare(secret, signal, slotBlinding);
  const input: BaseProofInput = {
    secret: secretToField(secret),
    tier_id: String(credential.tierId),
    expiry: String(credential.expiry),
    slot: String(slot),
    merkle_path_elements: witness.pathElements,
    merkle_path_indices: witness.pathIndices.map(String),
    root_in: witness.root,
    timestamp_in: String(issuedAt),
    domain_in: credential.deploymentDomain,
    request_signal_in: signal,
  };
  const expectedPublicSignals = [witness.root, String(issuedAt), credential.deploymentDomain, signal, nullifier, share];
  const context: BaseProofContext = {
    requirements: {
      scheme: 'zk-prepaid',
      network: 'eip155:84532',
      amount: '1',
      asset: 'coding-deepseek-v4-flash-v1',
      payTo: '0x00000000000000000000000000000000000000b2',
      maxTimeoutSeconds: 300,
      extra: {
        assetTransferMethod: 'prepaid-claim',
        paymentFlow: 'escrow',
        circuit: 'private-credit-spend-bn254-dev',
        verifyingKey: 'private-credit-spend-vk-dev',
        deploymentDomain: credential.deploymentDomain,
        contract: '0x00000000000000000000000000000000000000a1',
        requirementsVersion: 'zk-prepaid-v1',
        issuedAt,
      },
    },
    credential,
    expectedPublicSignals,
  };
  return { credential, input, context, expectedPublicSignals };
}

describe.skipIf(!installed || !proverBuilt)('frozen development artifact bundle', () => {
  it('proves inside the compiled worker and self-verifies the exact six signals in order', async () => {
    const metrics = createBaseProofMetrics();
    const prove = await createPinnedBaseProofGenerator({
      artifactDirectory,
      proverPath,
      metrics,
      timeoutMs: 20_000,
    });
    const { input, context, expectedPublicSignals } = await fundedFixture();
    const result = await prove(input, context);

    expect(result.publicSignals).toEqual(expectedPublicSignals);
    expect(result.publicSignals).toHaveLength(6);
    expect(result.proof).toMatchObject({ pi_a: expect.any(Array), pi_b: expect.any(Array), pi_c: expect.any(Array) });
    const snapshot = metrics.snapshot();
    expect(snapshot).toMatchObject({ attempts: 1, successes: 1, failures: 0 });
    expect(snapshot.hotProve).toEqual({ samples: 0, p50Ms: null, p95Ms: null });

    const second = await prove(input, context);
    expect(second.publicSignals).toEqual(expectedPublicSignals);
    expect(metrics.snapshot()).toMatchObject({ attempts: 2, successes: 2 });
    expect(metrics.snapshot().hotProve.samples).toBe(1);
    expect(metrics.snapshot().hotProve.p50Ms).toBeGreaterThan(0);
    expect(metrics.snapshot().hotProve.p95Ms).toBeLessThan(10_000);
  }, 120_000);

  it('rejects a reordered statement even when the underlying proof is valid', async () => {
    const prove = await createPinnedBaseProofGenerator({ artifactDirectory, proverPath, timeoutMs: 20_000 });
    const { input, context, expectedPublicSignals } = await fundedFixture();
    const reordered: BaseProofContext = {
      ...context,
      expectedPublicSignals: [expectedPublicSignals[1]!, expectedPublicSignals[0]!, ...expectedPublicSignals.slice(2)],
    };
    await expect(prove(input, reordered)).rejects.toThrow('canonical statement');
  }, 120_000);

  it('refuses a tampered copy of the frozen bundle before proving', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'zk-credits-tampered-'));
    created.push(copy);
    await cp(artifactDirectory, copy, { recursive: true });
    await writeFile(join(copy, 'private_credit_spend.wasm'), 'tampered');
    const manifest = await loadCircuitManifest();
    await expect(resolvePinnedArtifactBundle({ artifactDirectory: copy, manifest }))
      .rejects.toBeInstanceOf(ArtifactBundleError);
  });
});
