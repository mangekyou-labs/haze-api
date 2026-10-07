import { join } from 'node:path';
import { readLoopbackToken } from './sidecar-state.js';
import { sidecarStatePaths } from './sidecar-config.js';
import { readRpcConfig } from './rpc-config.js';
import { readSetupConfig } from './setup-config.js';

export interface DiagnosticOptions {
  baseUrl: string;
  stateDirectory: string;
  write(line: string): void;
}

type Health = 'running' | 'stopped' | 'unrelated listener' | 'unreachable';

function origin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
    throw new Error('Diagnostics require a 127.0.0.1 HTTP URL with an explicit port');
  }
  return url.origin;
}

async function health(baseUrl: string): Promise<Health> {
  try {
    const response = await fetch(`${origin(baseUrl)}/health`, { signal: AbortSignal.timeout(1_000), redirect: 'error' });
    const body = await response.json().catch(() => null) as { service?: unknown; status?: unknown } | null;
    return response.ok && body?.service === 'zk-credits-sidecar' && body.status === 'ok'
      ? 'running' : 'unrelated listener';
  } catch (error) {
    return (error as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED' ? 'stopped' : 'unreachable';
  }
}

async function operatorRequest(options: DiagnosticOptions, path: string, method = 'GET'): Promise<Response> {
  const token = await readLoopbackToken(sidecarStatePaths(options.stateDirectory).tokenPath);
  return fetch(`${origin(options.baseUrl)}${path}`, {
    method, headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2_000), redirect: 'error',
  });
}

export async function diagnoseSidecar(options: DiagnosticOptions): Promise<void> {
  const { write, stateDirectory } = options;
  const baseUrl = origin(options.baseUrl);
  write(`Loopback URL: ${baseUrl}`);
  write(`State directory: ${stateDirectory}`);
  write(`Startup log (auto-launched sidecar): ${sidecarStatePaths(stateDirectory).logPath}`);
  const state = await health(baseUrl);
  write(`Sidecar: ${state}`);
  if (state === 'running') {
    try {
      const response = await operatorRequest(options, '/runtime');
      const body = await response.json() as { service?: unknown; pid?: unknown };
      if (!response.ok || body.service !== 'zk-credits-sidecar' || !Number.isSafeInteger(body.pid) || Number(body.pid) <= 0) throw new Error();
      write(`Sidecar PID: ${body.pid} (authenticated)`);
    } catch {
      write('Sidecar PID: unavailable (older sidecar or missing/mismatched local token).');
    }
  }
  try {
    write(`Saved setup: ${await readSetupConfig(join(stateDirectory, 'config.json')) ? 'configured' : 'missing'}`);
  } catch { write('Saved setup: invalid or unreadable; rerun zk-credits setup.'); }
  write('OS credential access: not checked; doctor does not request access.');
  try {
    const configured = await readRpcConfig(stateDirectory);
    write(`RPC source: ${process.env.BASE_RPC_URL?.trim() ? 'BASE_RPC_URL environment override' : configured ? 'saved custom RPC' : 'saved setup or release default'} (URL redacted)`);
  } catch { write('RPC config: invalid or unreadable; run zk-credits config rpc.'); }
  if (state === 'running') write('Stop: zk-credits stop');
  else if (state === 'stopped') write('Start: zk-credits serve. If setup is missing, run zk-credits setup first.');
  else write('Inspect the listener before starting or stopping a process on this port.');
  write('RPC sync failure: run zk-credits config rpc, then stop and restart the sidecar. BASE_RPC_URL overrides saved RPC.');
  write(`Manual inspection: lsof -nP -iTCP:${new URL(baseUrl).port} -sTCP:LISTEN; inspect the PID with ps before kill -TERM <PID>.`);
}

export async function stopSidecar(options: DiagnosticOptions): Promise<void> {
  const state = await health(origin(options.baseUrl));
  if (state === 'stopped') {
    options.write('Sidecar is already stopped.');
    return;
  }
  if (state !== 'running') throw new Error(`Sidecar is ${state}; refusing shutdown. Run zk-credits doctor to inspect the listener.`);
  let response: Response;
  try { response = await operatorRequest(options, '/shutdown', 'POST'); }
  catch { throw new Error('Could not authenticate or reach the running sidecar. Run zk-credits doctor; inspect its PID before stopping it manually.'); }
  if (!response.ok) {
    throw new Error('Sidecar refused shutdown (older sidecar or mismatched token). Run zk-credits doctor; use Ctrl+C for foreground serve, or inspect its PID before kill -TERM <PID>.');
  }
  const body = await response.json() as { service?: unknown; status?: unknown };
  if (body.service !== 'zk-credits-sidecar' || body.status !== 'stopping') throw new Error('Shutdown response was not recognized. Run zk-credits doctor.');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await health(options.baseUrl) === 'stopped') {
      options.write('Sidecar listener stopped. Active requests may still be draining.');
      return;
    }
  }
  throw new Error('Shutdown requested; the sidecar may still be draining active requests. Run zk-credits doctor to check.');
}
