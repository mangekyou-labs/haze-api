import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEFAULT_BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
export function resolveBaseSepoliaRpc(environment: NodeJS.ProcessEnv, legacyRpc?: string): string {
  return environment.BASE_RPC_URL?.trim() || legacyRpc?.trim() || DEFAULT_BASE_SEPOLIA_RPC_URL;
}
export const RPC_GUIDANCE = 'The built-in public Base Sepolia endpoint is rate-limited. To use your own endpoint (chain ID 84532), run zk-credits config rpc. Providers: https://docs.base.org/base-chain/node-operators/node-providers .';
export function validateRpcUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error('RPC endpoint must be an HTTP(S) URL. ' + RPC_GUIDANCE); }
}
export async function checkBaseSepoliaRpc(value: string, request: typeof fetch = fetch): Promise<string> {
  const rpcUrl = validateRpcUrl(value);
  let result: unknown;
  try {
    const response = await request(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error();
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error) throw new Error();
    result = body.result;
  } catch { throw new Error('RPC endpoint could not be reached or rejected eth_chainId. Check the provider URL and access key; the URL is redacted. ' + RPC_GUIDANCE); }
  if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result) || BigInt(result) !== 84532n) {
    throw new Error('RPC endpoint is not Base Sepolia (chain ID 84532). ' + RPC_GUIDANCE);
  }
  return rpcUrl;
}
export async function readRpcConfig(directory: string): Promise<string | undefined> {
  const path = join(directory, 'rpc.json');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('RPC config must be an owner-only regular file.');
    const config = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown; rpcUrl?: unknown };
    if (config.version !== 1 || typeof config.rpcUrl !== 'string') throw new Error('RPC config is malformed; run zk-credits config rpc.');
    return validateRpcUrl(config.rpcUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function writeRpcConfig(directory: string, rpcUrl: string): Promise<void> {
  const path = join(directory, 'rpc.json');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('RPC config home must be a regular directory.');
  await chmod(directory, 0o700);
  const temporary = join(directory, '.rpc-' + randomUUID());
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ version: 1, rpcUrl: validateRpcUrl(rpcUrl) }) + '\n'); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
/** Explicit environment wins, then independently saved RPC, then legacy setup config. */
export async function applyRpcConfig(environment: NodeJS.ProcessEnv, directory: string): Promise<void> {
  if (!environment.BASE_RPC_URL?.trim()) {
    const rpcUrl = await readRpcConfig(directory);
    if (rpcUrl) environment.BASE_RPC_URL = rpcUrl;
  }
}
