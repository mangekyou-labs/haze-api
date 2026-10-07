import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInvestigator } from './investigator.mjs';
import { LIVE_DEFAULTS } from './.generated/live-defaults.mjs';

const CHAINS = { base: 8453, 'base-sepolia': 84532 };
const RPC = { 8453: 'https://mainnet.base.org', 84532: 'https://sepolia.base.org' };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

async function boundedJson(response, limit = 98304) {
  if (!response.ok || response.redirected) throw Error('Evidence service unavailable; retry only after checking the local outcome.');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Evidence service returned no body');
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) { await reader.cancel(); throw Error('Evidence response exceeds the collection limit'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Fixed read-only providers; no wallet, exact authorization, or fixture fallback. */
export function createLiveRpc(chainId, fetcher = fetch) {
  let id = 0, verified = false;
  async function request(method, params) {
    const requestId = ++id;
    const response = await fetcher(RPC[chainId], {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const envelope = await boundedJson(response);
    if (envelope.jsonrpc !== '2.0' || envelope.id !== requestId || envelope.error || !Object.hasOwn(envelope, 'result'))
      throw Error('RPC returned an invalid response; no evidence was substituted');
    return envelope.result;
  }
  async function read(method, params) {
    if (!verified) {
      if (Number(await request('eth_chainId', [])) !== chainId) throw Error('RPC chain does not match the investigated chain');
      verified = true;
    }
    return request(method, params);
  }
  return {
    provenance: 'live_rpc',
    transaction: hash => read('eth_getTransactionByHash', [hash]),
    receipt: hash => read('eth_getTransactionReceipt', [hash]),
    block: number => read('eth_getBlockByNumber', [number, false]),
    async revert(binding) {
      // Public original execution recording. Unavailable delivery remains missing evidence.
      const url = `https://api.tenderly.co/api/v1/public-contract/${chainId}/tx/${binding.transactionHash}`;
      const raw = await boundedJson(await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10000) }));
      if (!same(raw.hash, binding.transactionHash) || !same(raw.block_hash, binding.blockHash) ||
          Number(raw.block_number) !== Number(binding.blockNumber) || Number(raw.network_id) !== chainId ||
          !Array.isArray(raw.call_trace)) throw Error('Original execution identity does not match live RPC');
      // A caught child revert cannot establish the transaction's returned error.
      const call = raw.status === false && raw.call_trace.find(c =>
        (c.trace_address === undefined || (Array.isArray(c.trace_address) && c.trace_address.length === 0)) &&
        c.error && typeof c.output === 'string' && c.output.startsWith('0x08c379a0'));
      if (!call) throw Error('Original Error(string) evidence unavailable');
      return {
        kind: 'original_execution', chainId, transactionHash: raw.hash,
        blockHash: raw.block_hash, atBlock: binding.blockNumber, data: call.output,
        originalCallReference: [], origin: url, provenance: 'live_public_execution',
      };
    },
  };
}

/** Public installed command boundary. Internal injection is solely for acceptance tests. */
export async function runLiveInvestigation(args, options = {}) {
  if (args.length !== 3 || args[0] !== '--chain' || !Object.hasOwn(CHAINS, args[1]) || !/^0x[0-9a-f]{64}$/i.test(args[2]))
    throw Error('Usage: zk-credits investigate --chain <base|base-sepolia> <transaction-hash>');
  const chainId = CHAINS[args[1]], transactionHash = args[2].toLowerCase();
  const stateDirectory = options.stateDirectory ?? process.env.ZK_CREDITS_HOME ?? join(homedir(), '.zk-credits');
  const prepare = options.prepare ?? (await import('zk-credits/x402')).prepareLocalX402Agent;
  let prepared, runtime;
  const observations = new Map();
  let challengeObserved = 0, modelDeliveryObserved = false;
  const inferenceFactory = async ({ authorization }) => {
    const agent = await prepared.open({
      async beforeProof(request) {
        if ([...observations.values()].some(a => a.state === 'retired' && a.outcome === 'unknown'))
          throw Error('unknown_inference_outcome');
        await authorization.beforeProof(request);
        challengeObserved++;
        observations.set(request.attemptId, { state: 'reserved', outcome: 'unknown' });
      },
      async observe(event) {
        await authorization.observe(event);
        const attempt = observations.get(event.attemptId);
        if (!attempt) return;
        if (event.type === 'released') { attempt.state = 'released'; attempt.outcome = 'failed'; }
        if (event.type === 'retired') attempt.state = 'retired';
        if (event.type === 'settlement' && !['confirmed', 'failed'].includes(attempt.outcome)) attempt.outcome = event.outcome;
      },
    });
    return { ...agent, client: { ...agent.client, async fetch(url, init) {
      const response = await agent.client.fetch(url, init);
      if (response.ok) modelDeliveryObserved = true;
      return response;
    } } };
  };
  const policy = { executionDataPaymentChain: 84532, inference: {
    ...LIVE_DEFAULTS.inference, maxSlots: 3, maxRequests: 3,
  } };
  inferenceFactory.acquireOwnership = async () => {
    prepared = await prepare({ stateDirectory, port: 0 });
    policy.inference.credentialExpiry = prepared.credentialExpiry;
    return prepared.lease;
  };
  try {
    runtime = await createInvestigator({
      stateDir: join(stateDirectory, 'investigations', chainId.toString(), transactionHash),
      rpc: createLiveRpc(chainId, options.fetch), policy, inferenceFactory,
    });
    const report = await runtime.investigate({ schemaVersion: 1, chainId, transactionHash });
    const attempts = [...observations.values()];
    report.paymentEvidence = {
      challengeObserved,
      confirmed: attempts.filter(a => a.outcome === 'confirmed').length,
      failed: attempts.filter(a => a.outcome === 'failed').length,
      unknown: attempts.filter(a => a.state !== 'released' && a.outcome === 'unknown').length,
      retired: attempts.filter(a => a.state === 'retired').length,
      modelDeliveryObserved,
      recoveredPriorTask: attempts.length === 0 && report.inference.authorizedAllocation > 0,
      build: LIVE_DEFAULTS.build,
    };
    return report;
  } finally {
    if (runtime) await runtime.close();
    else await prepared?.lease.close();
  }
}

export function formatLiveReport(report) {
  const lines = [
    `Investigation: ${report.investigationId}`,
    `Transaction: ${report.transactionHash}`,
    `Evidence chain: ${report.chainId === 8453 ? 'Base mainnet' : 'Base Sepolia'}`,
    `Result: ${report.completion} (${report.stoppingReason})`, '',
  ];
  for (const [label, items] of [ ['Observed', report.observedFacts], ['Supported', report.supportedDiagnoses],
    ['Hypothesis', report.hypotheses], ['Next check', report.suggestedChecks] ]) {
    for (const item of items ?? []) lines.push(`${label}: ${item.text} ${item.evidenceIds?.map(id => `[${id}]`).join(' ') ?? ''}`.trim());
  }
  for (const gap of [...report.missingEvidence ?? [], ...report.uncertainty ?? []]) lines.push(`Uncertainty: ${gap}`);
  if (report.paymentEvidence.unknown > 0 || report.inference?.unknownOutcomes > 0) lines.push('Action: preserve this task and credential state; resolve the unknown outcome before starting another paid task. Repeating this hash only recovers the local report.');
  if (report.stoppingReason === 'inference_unavailable') lines.push('Action: run zk-credits doctor and check gateway/model availability. A useful model diagnosis is unavailable; inspect the separate payment counters.');
  if (['rpc_unavailable', 'evidence_unavailable', 'insufficient_evidence', 'unsupported_input'].includes(report.stoppingReason)) lines.push('Action: check transaction availability on the selected chain and public RPC access; missing evidence cannot be replaced with fixtures.');
  for (const entry of report.evidence ?? []) lines.push(`[${entry.id}] ${entry.operation}: ${entry.provenance}; SHA-256 ${entry.contentDigest}`);
  if (report.paymentEvidence.recoveredPriorTask) lines.push(`Recovered prior task accounting; no new inference was authorized. Prior confirmed credits: ${report.inference.confirmedCommitted}; prior unknown outcomes: ${report.inference.unknownOutcomes}.`);
  lines.push('', 'Payment: custom zk-prepaid; bundle funding on Base Sepolia, credit consumption offchain.',
    'Execution-data purchases: disabled.',
    `Confirmed consumed credits: ${report.paymentEvidence.confirmed} (this invocation)`,
    `Failed outcomes: ${report.paymentEvidence.failed}`,
    `Retired slots: ${report.paymentEvidence.retired}`,
    `Unknown outcomes: ${report.paymentEvidence.unknown}`,
    `Task payment evidence: ${JSON.stringify(report.paymentEvidence)}`);
  return lines.join('\n');
}
