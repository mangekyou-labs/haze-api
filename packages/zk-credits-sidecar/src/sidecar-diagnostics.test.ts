import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createSidecarServer } from './sidecar.js';
import { diagnoseSidecar, stopSidecar } from './sidecar-diagnostics.js';
import { writeLoopbackToken } from './sidecar-state.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function running(token = 'operator-token') {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'zk-diagnostics-'));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  await writeLoopbackToken(join(stateDirectory, 'loopback-token'), token);
  const sidecar = createSidecarServer({
    localToken: 'operator-token', gatewayBaseUrl: 'https://gateway.example',
    prepaidClient: { fetch: async () => new Response('{}') },
    onShutdown: () => { void sidecar.close(); },
  });
  const baseUrl = await sidecar.listen();
  cleanups.push(() => sidecar.close());
  return { stateDirectory, baseUrl, write: vi.fn(), sidecar };
}
it('diagnoses and stops a real server without exposing its bearer', async () => {
  const options = await running();
  await diagnoseSidecar(options);
  const output = options.write.mock.calls.flat().join('\n');
  expect(output).toContain('Sidecar: running');
  expect(output).toContain(`Sidecar PID: ${process.pid} (authenticated)`);
  expect(output).toContain('Saved setup: missing');
  expect(output).not.toContain('operator-token');
  await stopSidecar(options);
  expect(options.write).toHaveBeenCalledWith('Sidecar listener stopped. Active requests may still be draining.');
  await stopSidecar(options);
  expect(options.write).toHaveBeenCalledWith('Sidecar is already stopped.');
});
it('requires authentication for identity and shutdown', async () => {
  const options = await running('wrong-token');
  for (const [path, method] of [['/runtime', 'GET'], ['/shutdown', 'POST']]) {
    expect((await fetch(options.baseUrl + path, { method })).status).toBe(401);
  }
  await expect(stopSidecar(options)).rejects.toThrow('refused shutdown');
  expect((await fetch(options.baseUrl + '/health')).status).toBe(200);
});
it('continues diagnosing malformed setup and RPC without leaking provider keys', async () => {
  const options = await running();
  await writeFile(join(options.stateDirectory, 'config.json'), 'invalid', { mode: 0o600 });
  await writeFile(join(options.stateDirectory, 'rpc.json'), '{"rpcUrl":"https://secret.example/private-key"}', { mode: 0o600 });
  await diagnoseSidecar(options);
  const output = options.write.mock.calls.flat().join('\n');
  expect(output).toContain('Saved setup: invalid');
  expect(output).toContain('RPC config: invalid');
  expect(output).not.toContain('private-key');
});
it('preserves port-conflict errors when cleanup follows a failed listen', async () => {
  const options = await running();
  const contender = createSidecarServer({ localToken: 'other', gatewayBaseUrl: 'https://gateway.example', prepaidClient: { fetch: async () => new Response('{}') } });
  const start = async () => {
    try { await contender.listen(Number(new URL(options.baseUrl).port)); }
    catch (error) { await contender.close(); throw error; }
  };
  await expect(start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  expect((await fetch(options.baseUrl + '/health')).status).toBe(200);
});

it('refuses shutdown of an unrelated HTTP listener', async () => {
  const options = await running();
  const paths: string[] = [];
  const server = createServer((req, res) => { paths.push(req.url!); res.end('{}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await expect(stopSidecar({ ...options, baseUrl })).rejects.toThrow('unrelated listener');
  expect(paths).toEqual(['/health']);
});
it('drains an in-flight request after authenticated shutdown', async () => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let closed = false;
  const sidecar = createSidecarServer({
    localToken: 'operator-token', gatewayBaseUrl: 'https://gateway.example',
    prepaidClient: { fetch: async () => { entered(); await gate; return new Response('{"done":true}'); } },
    onShutdown: () => { void sidecar.close().then(() => { closed = true; }); },
  });
  const baseUrl = await sidecar.listen();
  cleanups.push(() => sidecar.close());
  const paid = fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer operator-token', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hello' }] }),
  });
  await started;
  try {
    const shutdown = await fetch(baseUrl + '/shutdown', { method: 'POST', headers: { Authorization: 'Bearer operator-token' } });
    expect(shutdown.status).toBe(202);
    await shutdown.json();
    expect(closed).toBe(false);
  } finally { finish(); }
  expect(await (await paid).json()).toEqual({ done: true });
  await vi.waitFor(() => expect(closed).toBe(true), { timeout: 8_000 });
}, 10_000);
