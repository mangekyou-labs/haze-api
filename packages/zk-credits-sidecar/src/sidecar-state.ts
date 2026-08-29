import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeLoopbackToken(tokenPath: string, token: string): Promise<void> {
  if (!token) throw new Error('Loopback token is required');
  await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${tokenPath}.tmp`;
  await writeFile(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, tokenPath);
  await chmod(tokenPath, 0o600);
}

export async function readLoopbackToken(tokenPath: string): Promise<string> {
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error('No active ZK Credits sidecar token; start zk-credits serve first');
  return token;
}
