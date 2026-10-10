import { describe, expect, it } from 'vitest';
import { codingTaskEvidence, codingTaskProviderArgs, validateCodingTaskArgs } from './task-evidence.js';
import { createBaseProofMetrics } from './proof-metrics.js';
import { createZkPrepaidLifecycleMetrics, lifecycleStage } from '@zk-credits/x402-zk-prepaid';

describe('coding-task evidence', () => {
  it('rejects configuration that could redirect the coding agent', () => {
    for (const args of [['--profile=other'], ['-p', 'other'], ['-c', 'model_provider=other'], ['--config=model_providers.zk_task.base_url=other']]) {
      expect(() => validateCodingTaskArgs(args)).toThrow('task_evidence_provider_override');
    }
    expect(() => validateCodingTaskArgs(['exec', '-m', 'model', '-c', 'approval_policy=never', 'fix the indexer'])).not.toThrow();
  });
  it('exports only fixed counters from the dedicated process', () => {
    const proof = createBaseProofMetrics();
    const lifecycle = createZkPrepaidLifecycleMetrics();
    proof.recordAttempt({ outcome: 'success', durationMs: 10 });
    for (const stage of ['challenge_received', 'payment_prepared', 'settlement_confirmed', 'exchange_succeeded'] as const) lifecycle.observe(lifecycleStage(stage));
    const metrics = { ...proof.snapshot(), exchange: lifecycle.snapshot(), secret: 'never-export', prompt: 'never-export' };
    const evidence = codingTaskEvidence(metrics, 0);
    expect(evidence.status).toBe('exchange_verified');
    expect(evidence.x402).toEqual({ challengesReceived: 1, localProofsVerified: 1, paymentsPrepared: 1, committedClaims: 1, successfulResponses: 1, failures: 0 });
    expect(JSON.stringify(evidence)).not.toContain('never-export');
    expect(codingTaskEvidence(metrics, 1).status).toBe('incomplete');
    expect(codingTaskEvidence({ ...metrics, exchange: createZkPrepaidLifecycleMetrics().snapshot() }, 0).status).toBe('incomplete');
  });
  it('uses an environment token and a distinct provider rather than saved sidecar auth', () => {
    const args = codingTaskProviderArgs('http://127.0.0.1:43125');
    expect(args).toContain('model="openai/gpt-4o-mini"');
    expect(args).toContain('model_reasoning_effort="none"');
    expect(args.join(' ')).toContain('model_provider="zk_task"');
    expect(args.join(' ')).toContain('env_key="ZK_CREDITS_TASK_TOKEN"');
    expect(args.join(' ')).not.toContain('experimental_bearer_token');
    expect(() => codingTaskProviderArgs('https://example.com')).toThrow();
  });
});
