import { execFile } from 'node:child_process';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';

it('reports the packaged version without starting or configuring a sidecar', async () => {
  const directory = await mkdtemp(`${tmpdir()}/zk-version-`);
  try {
    const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist/zk-credits.js', import.meta.url)), '--version'], {
      timeout: 3000,
      env: { ...process.env, ZK_CREDITS_HOME: directory, BASE_RPC_URL: 'https://rpc.invalid' },
    });
    expect(result.stdout.trim()).toBe(metadata.version);
    expect(result.stderr).toBe('');
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
