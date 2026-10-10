import type { SidecarMetricsSnapshot } from './sidecar.js';
import { DEFAULT_CODEX_MODEL } from './codex-profile.js';

/** Only aggregate counters from a dedicated, fresh sidecar are exportable.
 * No gateway-global deltas or identifying run labels enter this record. */
export function codingTaskEvidence(metrics: SidecarMetricsSnapshot, exitCode: number) {
  const exchange = metrics.exchange;
  const counts = [metrics.successes, exchange.challengesReceived, exchange.paymentsPrepared,
    exchange.settlementsConfirmed, exchange.exchangeSuccesses, exchange.failures];
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('invalid_task_metrics');
  return {
    path: 'codex-coding-task', source: 'dedicated-local-sidecar',
    agentExitCode: exitCode,
    status: exitCode === 0 && exchange.settlementsConfirmed > 0 && exchange.exchangeSuccesses > 0 ? 'exchange_verified' : 'incomplete',
    x402: { challengesReceived: exchange.challengesReceived, localProofsVerified: metrics.successes,
      paymentsPrepared: exchange.paymentsPrepared, committedClaims: exchange.settlementsConfirmed,
      successfulResponses: exchange.exchangeSuccesses, failures: exchange.failures },
  } as const;
}

export function codingTaskProviderArgs(address: string): string[] {
  const url = new URL(address);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('invalid_task_sidecar');
  // Apply the bounded route's defaults at launch, including for older setups.
  // A user's global Codex model/reasoning settings must not break this path.
  return ['-c', `model=${JSON.stringify(DEFAULT_CODEX_MODEL)}`,
    '-c', 'model_reasoning_effort="none"', '-c', 'model_provider="zk_task"', '-c',
    `model_providers.zk_task={name="Haze coding task",base_url=${JSON.stringify(`${url.origin}/v1`)},wire_api="responses",env_key="ZK_CREDITS_TASK_TOKEN"}`];
}

/** Keep the provider fixed so exported counters cover the launched agent. */
export function validateCodingTaskArgs(args: readonly string[]): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-p' || arg === '--profile' || arg.startsWith('--profile=') || /^-p.+/u.test(arg)) {
      throw new Error('task_evidence_provider_override');
    }
    const config = arg === '-c' || arg === '--config' ? args[++i] ?? ''
      : arg.startsWith('--config=') ? arg.slice(9) : arg.startsWith('-c') ? arg.slice(2) : '';
    if (/^\s*(model_provider|model_providers)(\s*=|\.)/u.test(config)) throw new Error('task_evidence_provider_override');
  }
}
