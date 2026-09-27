import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { EvaluationError, exportEvidence, type Level4Evidence } from './evaluation.js';
import { PostgresEvaluationStore } from './evaluation-postgres.js';

function renderEvidenceMarkdown(evidence: Level4Evidence): string {
  const rows = evidence.participants.map((participant) => [
    `| ${participant.participantCode}`,
    participant.walletAddress,
    `[${participant.transactionHash}](https://stellar.expert/explorer/testnet/tx/${participant.transactionHash})`,
    participant.completedAt,
    '|' ,
  ].join(' '));

  return [
    '# Level 4 redacted evidence',
    '',
    `Generated: ${evidence.generatedAt}`,
    '',
    '| Participant | Wallet | Testnet transaction | Completed |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Aggregate feedback',
    '',
    `- Responses: ${evidence.feedbackSummary.responses}`,
    `- Average ease rating: ${evidence.feedbackSummary.easeAverage}/5`,
    `- Task completion rate: ${Math.round(evidence.feedbackSummary.taskCompletionRate * 100)}%`,
    `- Would use again rate: ${Math.round(evidence.feedbackSummary.wouldUseAgainRate * 100)}%`,
    `- Quote consent count: ${evidence.feedbackSummary.quoteConsentCount}`,
    '',
    '> Raw signatures, complete wallet addresses, identity subjects, and private API data are never exported.',
    '',
  ].join('\n');
}

function outputBase(): string {
  const requested = process.env.LEVEL4_EVIDENCE_OUTPUT || 'docs/evidence/level4/generated';
  return resolve(process.cwd(), requested);
}

async function main(): Promise<void> {
  const pool = createPool();
  try {
    await runMigrations(pool, resolve(__dirname, 'db/migrations'));
    const evidence = await exportEvidence(new PostgresEvaluationStore(pool));
    const base = outputBase();
    mkdirSync(base, { recursive: true });
    writeFileSync(resolve(base, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    writeFileSync(resolve(base, 'evidence.md'), renderEvidenceMarkdown(evidence), 'utf8');
    console.log(JSON.stringify({
      output: base,
      participants: evidence.participants.length,
      generatedAt: evidence.generatedAt,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof EvaluationError && error.code === 'minimum_participants') {
    console.error('Evidence export blocked: at least ten completed, unique participants are required.');
  } else {
    console.error('Evidence export failed:', error instanceof Error ? error.message : 'unknown error');
  }
  process.exitCode = 1;
});

export { renderEvidenceMarkdown };
