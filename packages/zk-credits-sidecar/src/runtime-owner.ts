/** One credential, one authoritative local ledger. No cross-device coordination. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
export interface CredentialRuntimeLeaseOptions {
  credential: { secret: string };
  stateDirectory: string;
  homeDirectory?: string;
}
export interface CredentialRuntimeLease { stateDirectory: string; close(): Promise<void> }
const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;
/** Durable binding is established on import and also for credentials imported by older releases. */
export async function bindCredentialStateDirectory(options: CredentialRuntimeLeaseOptions): Promise<{ stateDirectory: string; registryDirectory: string }> {
  await mkdir(options.stateDirectory, { recursive: true, mode: 0o700 });
  const stateDirectory = await realpath(options.stateDirectory);
  const registryDirectory = join(options.homeDirectory ?? homedir(), '.zk-credits-runtime-owners', createHash('sha256').update(options.credential.secret).digest('hex'));
  await mkdir(registryDirectory, { recursive: true, mode: 0o700 });
  const binding = join(registryDirectory, 'state-directory');
  try { await writeFile(binding, stateDirectory, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (code(error) !== 'EEXIST') throw error; }
  if (await readFile(binding, 'utf8') !== stateDirectory) throw new Error('Credential already belongs to another authoritative state directory; alternate directories are refused');
  return { stateDirectory, registryDirectory };
}
export async function acquireCredentialRuntimeLease(options: CredentialRuntimeLeaseOptions): Promise<CredentialRuntimeLease> {
  const { stateDirectory, registryDirectory } = await bindCredentialStateDirectory(options);
  const lock = join(registryDirectory, 'owner');
  const token = `${process.pid}-${randomUUID()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
      try { await writeFile(join(lock, token), '', { flag: 'wx', mode: 0o600 }); }
      catch (error) { await rmdir(lock); throw error; }
      let closed = false;
      return { stateDirectory, async close() { if (closed) return; closed = true; await unlink(join(lock, token)); await rmdir(lock); } };
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error;
      const entries = await readdir(lock);
      // Missing/malformed ownership metadata is ambiguous: never recover by time alone.
      if (entries.length !== 1 || !/^\d+-[0-9a-f-]{36}$/u.test(entries[0]!)) throw new Error('Credential runtime is owned or recovery metadata is ambiguous');
      const owner = entries[0]!;
      const pid = Number(owner.split('-')[0]);
      try { process.kill(pid, 0); throw new Error('Credential runtime is already owned by a live process'); }
      catch (error) { if (code(error) !== 'ESRCH') throw error; }
      // Only the exact dead owner's token is removed. A concurrent recoverer cannot
      // remove a new owner's different token, even if the PID was reused.
      try { await unlink(join(lock, owner)); await rmdir(lock); }
      catch (error) { throw new Error('Credential runtime recovery raced another owner; retry after verifying termination', { cause: error }); }
    }
  }
  throw new Error('Credential runtime is already owned');
}
