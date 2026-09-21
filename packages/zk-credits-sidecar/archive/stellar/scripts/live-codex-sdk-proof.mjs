import { Codex } from '@openai/codex-sdk';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  buildCodexSdkOptions,
  buildCodexThreadOptions,
} from '../dist/codex-sdk-options.js';

async function main() {
  console.log('=== ZK Credits — Live Codex SDK Protocol Proof ===');

  // 1. Read loopback token and check sidecar health
  const stateDir = process.env.ZK_CREDITS_HOME || join(homedir(), '.zk-credits');
  const tokenPath = join(stateDir, 'loopback-token');
  const ledgerPath = join(stateDir, 'tickets.json');

  let token;
  try {
    token = (await readFile(tokenPath, 'utf8')).trim();
  } catch {
    console.error('No loopback token found at', tokenPath);
    process.exit(1);
  }

  const loopbackBaseUrl = 'http://127.0.0.1:3210';
  const healthRes = await fetch(`${loopbackBaseUrl}/health`);
  if (!healthRes.ok) {
    console.error('Sidecar health check failed:', healthRes.status);
    process.exit(1);
  }
  const health = await healthRes.json();
  console.log('Sidecar is healthy:', health);

  // 2. Read initial ticket ledger state
  const initialLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const initialConsumed = (initialLedger.entries || []).filter(
    (e) => e.state === 'consumed',
  );
  console.log(`Initial consumed tickets: ${initialConsumed.length}`);
  console.log(
    `Last consumed index: ${initialConsumed.length ? initialConsumed[initialConsumed.length - 1].index : 'none'}`,
  );

  // 3. Set up isolated CODEX_HOME
  const isolatedCodexHome = await mkdtemp(join(tmpdir(), 'zk-codex-sdk-home-'));
  const isolatedWorkspace = await mkdtemp(join(tmpdir(), 'zk-codex-workspace-'));
  console.log(`Isolated CODEX_HOME: ${isolatedCodexHome}`);
  console.log(`Isolated workspace: ${isolatedWorkspace}`);

  // 4. Instantiate Codex SDK with helper options
  const codexOptions = buildCodexSdkOptions({
    loopbackBaseUrl,
    token,
    codexHome: isolatedCodexHome,
  });

  const threadOptions = buildCodexThreadOptions({
    model: 'openai/gpt-4o-mini',
    workingDirectory: isolatedWorkspace,
  });

  console.log('Instantiating Codex SDK with options:', {
    baseUrl: codexOptions.baseUrl,
    apiKey: '***[redacted]***',
    envKeys: Object.keys(codexOptions.env || {}),
  });

  const codex = new Codex(codexOptions);
  const thread = codex.startThread(threadOptions);

  const marker = '[CODEX-SDK-LIVE]';
  const prompt = `Reply with exactly: ${marker}`;
  console.log(`Running prompt through Codex SDK: "${prompt}"...`);

  const result = await thread.run(prompt);
  console.log('Codex turn completed!');
  console.log('Final response:', result.finalResponse);

  if (!result.finalResponse || !result.finalResponse.includes(marker)) {
    console.error(`FAILED: Response did not contain expected marker ${marker}`);
    process.exit(1);
  }

  // 5. Verify ticket ledger advanced by one index
  const finalLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const finalConsumed = (finalLedger.entries || []).filter(
    (e) => e.state === 'consumed',
  );
  console.log(`Final consumed tickets: ${finalConsumed.length}`);

  if (finalConsumed.length !== initialConsumed.length + 1) {
    console.error(
      `FAILED: Expected consumed count to increase by 1, but went from ${initialConsumed.length} to ${finalConsumed.length}`,
    );
    process.exit(1);
  }

  const newlyConsumed = finalConsumed[finalConsumed.length - 1];
  console.log('Newly consumed ticket:', newlyConsumed);
  console.log('SUCCESS: Codex SDK live protocol proof verified!');
}

main().catch((err) => {
  console.error('Live proof error:', err);
  process.exit(1);
});
