// This gate precedes configuration, module import, OS storage and network access.
if (process.env.INVESTIGATOR_AUTHORIZE_PREPAID_CONSUMPTION !== 'yes') {
  console.log(JSON.stringify({ status: 'SKIP', reason: 'explicit_prepaid_consumption_not_authorized' }));
} else {
  try {
    const { readFile, access } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const { resolve, isAbsolute } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const config = JSON.parse(await readFile(process.env.INVESTIGATOR_SMOKE_CONFIG, 'utf8'));
    if (!isAbsolute(config.transportModule) || !isAbsolute(config.stateDir) ||
        !/^[a-f0-9]{64}$/.test(config.transportSha256) ||
        !/^[a-f0-9]{40}$/.test(config.sourceCommit) ||
        config.policy?.inference?.serviceClass !== 'coding-deepseek-v4-flash-v1' ||
        config.policy.inference.deploymentDomain !== '84532') throw Error('configuration');
    const gateway = new URL(config.policy.inference.gateway);
    if (gateway.protocol !== 'https:' || gateway.pathname !== '/v1/chat/completions' ||
        gateway.username || gateway.password || gateway.search || gateway.hash) throw Error('gateway');
    let existingJournal = false;
    try { await access(resolve(config.stateDir, 'journal.json')); existingJournal = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existingJournal) throw Error('fresh_state_required');
    const bytes = await readFile(config.transportModule);
    if (createHash('sha256').update(bytes).digest('hex') !== config.transportSha256) throw Error('identity');
    const { prepareLocalX402Agent } = await import(pathToFileURL(resolve(config.transportModule)).href);
    if (typeof prepareLocalX402Agent !== 'function') throw Error('parity');
    const { createInvestigator } = await import('./investigator.mjs');
    const fixture = JSON.parse(await readFile(new URL('./fixtures/recorded-revert.json', import.meta.url), 'utf8'));
    let prepared;
    const inferenceFactory = async ({ authorization }) => prepared.open(authorization);
    inferenceFactory.acquireOwnership = async () => {
      prepared = await prepareLocalX402Agent(config.runtimeOptions ?? {});
      return prepared.lease;
    };
    const runtime = await createInvestigator({
      stateDir: config.stateDir, inferenceFactory,
      policy: { ...config.policy, inference: { ...config.policy.inference, maxSlots: 1 } },
      rpc: { provenance: 'recorded_authentic', transaction: async () => fixture.transaction,
        receipt: async () => fixture.receipt, block: async () => fixture.block,
        revert: async () => fixture.replay },
    });
    try {
      const report = await runtime.investigate({ schemaVersion: 1, chainId: 8453, transactionHash: fixture.transaction.hash });
      const journal = await runtime.journal();
      const record = journal.find((r) => r.investigationId === report.investigationId);
      const evidence = (record?.inferenceAttempts ?? []).map((a) => ({
        requestDigest: a.requestDigest, state: a.state, outcome: a.outcome,
        reservationObserved: Boolean(a.reservationId),
      }));
      console.log(JSON.stringify({ status: report.inference.confirmedCommitted > 0 ? 'CONFIRMED' : 'UNKNOWN_OR_REFUSED',
        sourceCommit: config.sourceCommit, transportSha256: config.transportSha256,
        executionDataPaymentMode: 'simulated', purchase: report.purchase, inference: report.inference,
        validatedTransportCommitObservations: evidence, stoppingReason: report.stoppingReason,
        limitations: ['No raw receipt is exposed by the transport observer.', 'Does not verify paid trace delivery or released-package parity.'] }, null, 2));
    } finally { await runtime.close(); }
  } catch {
    console.error('Prepaid smoke refused or failed; inspect the private local journal. Unknown exposure remains held.');
    process.exitCode = 1;
  }
}
