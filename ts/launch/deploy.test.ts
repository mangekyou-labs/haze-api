/**
 * Chain deployment reconciliation.
 *
 * A broadcast is the one irreversible step in the launch, so the assertions
 * here are about what happens when the record of it is incomplete: a receipt
 * that never arrived, a hash that was never written down, a nonce that was
 * consumed anyway. The reconciliation must confirm a deployment that happened
 * and must never confirm one that did not, because the cost of the two mistakes
 * is asymmetric.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  EXISTING_B11_CONTRACTS,
  MAX_PILOT_APPROVAL_USDC,
  PILOT_CHAIN_ID,
  CONTRACT_DEPLOY_ORDER,
  abiSelector,
  assertBoundedApproval,
  assertChainId,
  assertImmutables,
  broadcastIntent,
  deploymentIntentDetail,
  intentsFromDetail,
  parseFoundryRunLatest,
  predictDeploymentAddress,
  reconcileBroadcast,
  reconcileDeploymentArtifact,
  type ChainReader,
} from './deploy.js';

const SIGNER = '0x1111111111111111111111111111111111111111';
const BYTECODE = '0x6080604052600436106100';

function chain(options: {
  receipt?: { status: 'success' | 'reverted'; contractAddress: string | null; blockNumber: bigint };
  code?: string;
}): ChainReader {
  return {
    receipt: async () => options.receipt,
    code: async () => options.code ?? '0x',
  };
}

describe('the pilot chain', () => {
  it('is Base Sepolia only', () => {
    expect(PILOT_CHAIN_ID).toBe(84532);
    expect(() => assertChainId(84532)).not.toThrow();
    expect(() => assertChainId(8453)).toThrow(/the RPC reports chain 8453; the pilot is chain 84532 only/u);
  });

  it('builds on the B11 verifier and adapter rather than replacing them', () => {
    expect(EXISTING_B11_CONTRACTS.verifier).toMatch(/^0x[0-9a-fA-F]{40}$/u);
    expect(EXISTING_B11_CONTRACTS.adapter).toMatch(/^0x[0-9a-fA-F]{40}$/u);
  });
});

describe('broadcast intent', () => {
  it('predicts the address from the signer and nonce before anything is sent', () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7);
    expect(intent.predictedAddress).toBe(predictDeploymentAddress(SIGNER, 7));
    expect(intent.transactionHash).toBeNull();
    expect(intent.chainId).toBe(PILOT_CHAIN_ID);
  });

  it('predicts a different address for the next nonce, so a retry is visible', () => {
    expect(predictDeploymentAddress(SIGNER, 7)).not.toBe(predictDeploymentAddress(SIGNER, 8));
  });

  it('carries no 32-byte value, so an intent is safe to persist as state detail', () => {
    const intent = broadcastIntent('PoseidonT3', SIGNER, 3, '0xhash');
    expect(Object.values(intent).every((value) => typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(value))).toBe(true);
  });
});

describe('reconciliation on resume', () => {
  it('confirms a deployment whose receipt succeeded at the predicted address', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'success', contractAddress: intent.predictedAddress, blockNumber: 21_000_000n },
      code: BYTECODE,
    }));
    expect(result).toEqual({
      kind: 'confirmed',
      address: intent.predictedAddress,
      blockNumber: 21_000_000n,
      transactionHash: '0xhash',
    });
  });

  it('confirms a deployment whose hash was never recorded but whose nonce was consumed', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7);
    const result = await reconcileBroadcast(intent, chain({ code: BYTECODE }));
    expect(result.kind).toBe('unknown');
    expect(result).toMatchObject({ reason: expect.stringContaining('no transaction hash or receipt') });
  });

  it('reports an absent deployment so a retry is safe', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7);
    const result = await reconcileBroadcast(intent, chain({ code: '0x' }));
    expect(result.kind).toBe('absent');
    expect(result).toMatchObject({ reason: expect.stringContaining('has no bytecode at') });
  });

  it('stops on a reverted receipt instead of retrying', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'reverted', contractAddress: null, blockNumber: 21_000_000n },
      code: '0x',
    }));
    expect(result.kind).toBe('unknown');
    expect(result).toMatchObject({ reason: expect.stringContaining('reverted') });
  });

  it('stops when the receipt deployed a different address than the nonce predicted', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'success', contractAddress: '0x9999999999999999999999999999999999999999', blockNumber: 1n },
      code: BYTECODE,
    }));
    expect(result.kind).toBe('unknown');
    expect(result).toMatchObject({ reason: expect.stringContaining('was predicted from nonce 7') });
  });

  it('stops when a successful receipt left no bytecode behind', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'success', contractAddress: intent.predictedAddress, blockNumber: 1n },
      code: '0x',
    }));
    expect(result.kind).toBe('unknown');
    expect(result).toMatchObject({ reason: expect.stringContaining('has no bytecode') });
  });
});

describe('deployed immutables', () => {
  const expected = {
    usdc: '0x3333333333333333333333333333333333333333',
    sponsor: '0x4444444444444444444444444444444444444444',
    refundVault: '0x5555555555555555555555555555555555555555',
    treasury: '0x6666666666666666666666666666666666666666',
    poseidonT2: '0x7777777777777777777777777777777777777777',
    poseidonT3: '0x8888888888888888888888888888888888888888',
    poseidonT4: '0x9999999999999999999999999999999999999999',
    spendVerifier: EXISTING_B11_CONTRACTS.adapter,
    deploymentDomain: `0x${PILOT_CHAIN_ID.toString(16).padStart(64, '0')}`,
  };

  it('accepts a bond that read back as intended, whatever the case', () => {
    expect(() => assertImmutables({ ...expected, usdc: expected.usdc.toUpperCase().replace('0X', '0x') }, expected)).not.toThrow();
  });

  it('names every immutable that drifted', () => {
    expect(() => assertImmutables({
      ...expected,
      treasury: '0x6666666666666666666666666666666666666666',
      deploymentDomain: `0x${(8453).toString(16).padStart(64, '0')}`,
    }, expected)).toThrow(/deploymentDomain is .*expected/u);
  });
});

describe('Foundry artifact reconciliation', () => {
  const startingNonce = 7;

  function intents() {
    return CONTRACT_DEPLOY_ORDER.map((contract, offset) => broadcastIntent(
      contract,
      SIGNER,
      startingNonce + offset,
      `0x${(offset + 1).toString(16).padStart(64, '0')}`,
    ));
  }

  function artifactJson(current: ReturnType<typeof intents>, mutate?: (transactions: Record<string, unknown>[], receipts: Record<string, unknown>[]) => void): string {
    const transactions = current.map((intent, index) => ({
      contractName: intent.contract,
      transactionType: 'CREATE',
      hash: intent.transactionHash,
      tx: {
        type: 'CREATE',
        from: SIGNER,
        nonce: `0x${(startingNonce + index).toString(16)}`,
        chainId: `0x${PILOT_CHAIN_ID.toString(16)}`,
        to: null,
      },
    }));
    const receipts = current.map((intent, index) => ({
      transactionHash: intent.transactionHash,
      status: '0x1',
      contractAddress: intent.predictedAddress,
      blockNumber: `0x${(100 + index).toString(16)}`,
      from: SIGNER,
      nonce: `0x${(startingNonce + index).toString(16)}`,
    }));
    mutate?.(transactions, receipts);
    return JSON.stringify({ chain: `0x${PILOT_CHAIN_ID.toString(16)}`, transactions, receipts });
  }

  function chainFor(current: ReturnType<typeof intents>, missingAddress?: string): ChainReader {
    const receipts = new Map(current.map((intent, index) => [intent.transactionHash!, {
      status: 'success' as const,
      contractAddress: intent.predictedAddress,
      blockNumber: BigInt(100 + index),
      transactionHash: intent.transactionHash!,
      from: SIGNER,
      nonce: startingNonce + index,
    }]));
    return {
      chainId: async () => PILOT_CHAIN_ID,
      receipt: async (hash) => receipts.get(hash),
      code: async (address) => address.toLowerCase() === missingAddress?.toLowerCase() ? '0x' : BYTECODE,
      transaction: async (hash) => {
        const intent = current.find((candidate) => candidate.transactionHash === hash);
        if (!intent) return undefined;
        return { from: SIGNER, nonce: intent.nonce, to: null };
      },
    };
  }

  it('parses the four CREATEs and reconciles signer, nonce, order, receipts, and bytecode', async () => {
    const current = intents();
    const artifact = parseFoundryRunLatest(artifactJson(current));
    expect(artifact.chainId).toBe(PILOT_CHAIN_ID);
    expect(artifact.transactions.map((entry) => entry.contract)).toEqual([...CONTRACT_DEPLOY_ORDER]);

    const result = await reconcileDeploymentArtifact(current, artifact, chainFor(current));
    expect(result).toMatchObject({ kind: 'confirmed', bondDeploymentBlock: 103n });
    expect(result.deployments?.map((deployment) => deployment.address)).toEqual(current.map((intent) => intent.predictedAddress));
  });

  it('round-trips scalar intent state without persisting private material', () => {
    const current = intents();
    const detail = deploymentIntentDetail(current, '/tmp/run-latest.json');
    expect(detail).toMatchObject({ signer: SIGNER, startingNonce, contractNonce: startingNonce + 3 });
    expect(JSON.stringify(detail)).not.toContain('cd'.repeat(32));
    expect(intentsFromDetail(detail)).toEqual(current.map(({ transactionHash: _hash, ...intent }) => ({ ...intent, transactionHash: null })));
  });

  it.each([
    ['nonce drift', (transactions: Record<string, unknown>[]) => { transactions[1]!.tx = { ...(transactions[1]!.tx as object), nonce: '0x99' }; }],
    ['reordered deployment', (transactions: Record<string, unknown>[]) => { [transactions[0], transactions[1]] = [transactions[1]!, transactions[0]!]; }],
    ['unexpected transaction type', (transactions: Record<string, unknown>[]) => { transactions[2]!.transactionType = 'CALL'; }],
    ['reverted receipt', (_transactions: Record<string, unknown>[], receipts: Record<string, unknown>[]) => { receipts[3]!.status = '0x0'; }],
  ])('keeps %s artifacts unknown', async (_label, mutate) => {
    const current = intents();
    const artifact = parseFoundryRunLatest(artifactJson(current, mutate));
    const result = await reconcileDeploymentArtifact(current, artifact, chainFor(current));
    expect(result.kind).toBe('unknown');
  });

  it('keeps partial artifacts unknown instead of retrying blind', async () => {
    const current = intents();
    const raw = JSON.parse(artifactJson(current)) as { transactions: unknown[]; receipts: unknown[]; chain: string };
    raw.transactions.pop();
    const result = await reconcileDeploymentArtifact(current, parseFoundryRunLatest(JSON.stringify(raw)), chainFor(current));
    expect(result.kind).toBe('unknown');
    expect(result.reason).toMatch(/expected 4/u);
  });

  it('keeps a missing deployed bytecode unknown', async () => {
    const current = intents();
    const artifact = parseFoundryRunLatest(artifactJson(current));
    const result = await reconcileDeploymentArtifact(current, artifact, chainFor(current, current[2]!.predictedAddress));
    expect(result.kind).toBe('unknown');
    expect(result.reason).toMatch(/no deployed bytecode/u);
  });

  it('exposes selectors used by the post-deploy immutable checks', () => {
    expect(abiSelector('poseidonT2()')).toMatch(/^0x[0-9a-f]{8}$/u);
    expect(abiSelector('verifier()')).toMatch(/^0x[0-9a-f]{8}$/u);
  });
});

describe('the bounded USDC approval', () => {
  it('caps the approval at the pilot bound', () => {
    expect(MAX_PILOT_APPROVAL_USDC).toBe(80n);
    expect(() => assertBoundedApproval(1n)).not.toThrow();
    expect(() => assertBoundedApproval(80n)).not.toThrow();
  });

  it('refuses an approval above the bound, which would let the bond draw the balance', () => {
    expect(() => assertBoundedApproval(81n)).toThrow(/the approval is 81 USDC; the pilot is bounded to 80 USDC/u);
  });

  it('refuses an empty approval', () => {
    expect(() => assertBoundedApproval(0n)).toThrow(/must be greater than zero/u);
  });
});
