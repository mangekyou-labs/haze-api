import { describe, expect, it } from 'vitest';
import { mkdtemp, stat, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecoveryCapsuleFile, generateSecret, verifyRecoveryCapsule, wrapActivatedCredential } from '@zk-credits/shared/base';
import { importStoredCredential, readStoredCredential } from './credential-store.js';
import { resolveBaseSepoliaRpc, applyRpcConfig, checkBaseSepoliaRpc, readRpcConfig, writeRpcConfig } from './rpc-config.js';

it('validates the RPC without exposing provider errors or keys', async () => {
  const url = 'https://rpc.example/secret-provider-key';
  const rpc = (result: string) => (async () => Response.json({ result })) as typeof fetch;
  expect(await checkBaseSepoliaRpc(url, rpc('0x14a34'))).toBe(url);
  await expect(checkBaseSepoliaRpc(url, rpc('0x1'))).rejects.toThrow(/not Base Sepolia/);
  await expect(checkBaseSepoliaRpc(url, (async () => { throw new Error(url); }) as typeof fetch)).rejects.toThrow(/URL is redacted/);
});
it('saves RPC before setup, changes it, and preserves explicit environment precedence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zk-rpc-test-'));
  try {
    await writeRpcConfig(directory, 'https://first.example');
    expect(await readRpcConfig(directory)).toBe('https://first.example/');
    expect((await stat(join(directory, 'rpc.json'))).mode & 0o777).toBe(0o600);
    await writeRpcConfig(directory, 'https://second.example');
    const environment: NodeJS.ProcessEnv = {};
    await applyRpcConfig(environment, directory);
    expect(environment.BASE_RPC_URL).toBe('https://second.example/');
    environment.BASE_RPC_URL = 'https://override.example';
    await applyRpcConfig(environment, directory);
    expect(environment.BASE_RPC_URL).toBe('https://override.example');
    expect(await readFile(join(directory, 'rpc.json'), 'utf8')).not.toContain('credential');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
describe('OS credential storage', () => {
  it('imports and reloads a verified activated credential without passwords', async () => {
    const file = await createRecoveryCapsuleFile(generateSecret());
    const { commitment } = await verifyRecoveryCapsule(file);
    const activated = wrapActivatedCredential(file.capsule, { commitment, tierId: 0, expiry: 1800000000, deploymentDomain: '84532', network: 'eip155:84532', contractAddress: 'contract', transactionHash: 'tx' });
    let value: string | undefined;
    const store = { read: async () => value, write: async (v: string) => { value = v; } };
    const imported = await importStoredCredential(activated, store);
    expect(await readStoredCredential(store)).toEqual(imported);
    await expect(importStoredCredential(activated, { read: async () => undefined, write: async () => { throw new Error('locked'); } })).rejects.toThrow(/OS credential storage/);
    await expect(importStoredCredential(file, store)).rejects.toThrow(/Unsupported/);
  });
});

it('gives actionable, redacted guidance when the public RPC is rate-limited', async () => {
  await expect(checkBaseSepoliaRpc('https://sepolia.base.org', (async () => new Response('', { status: 429 })) as typeof fetch)).rejects.toThrow(/zk-credits config rpc/);
});

it('uses the public RPC only when no configured or legacy endpoint exists', () => {
  expect(resolveBaseSepoliaRpc({})).toBe('https://sepolia.base.org');
  expect(resolveBaseSepoliaRpc({ BASE_RPC_URL: '  ' }, 'https://legacy.example')).toBe('https://legacy.example');
  expect(resolveBaseSepoliaRpc({ BASE_RPC_URL: ' https://configured.example ' }, 'https://legacy.example')).toBe('https://configured.example');
});
