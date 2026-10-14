import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';

it('serves health while initial chain synchronization is stalled', async () => {
  const rpc = createServer(() => { /* Keep the RPC response pending. */ });
  rpc.listen(0, '127.0.0.1');
  await once(rpc, 'listening');
  const rpcPort = (rpc.address() as { port: number }).port;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('.', import.meta.url),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', PORT: '0',
      BASE_RPC_URL: `http://127.0.0.1:${rpcPort}`,
      BASE_PRIVATE_CREDIT_BOND_ADDRESS: '0x1111111111111111111111111111111111111111',
      BASE_CURRENT_ROOT: '1', BASE_SYNC_INTERVAL_MS: '100',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gateway did not listen while RPC was stalled')), 5_000);
      child.stdout.on('data', chunk => {
        const match = String(chunk).match(/gateway listening on (\d+)/u);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Gateway exited before listening')); });
    });
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  } finally {
    child.kill('SIGKILL');
    await once(child, 'exit');
    rpc.closeAllConnections();
    await new Promise<void>(resolve => rpc.close(() => resolve()));
  }
}, 10_000);
