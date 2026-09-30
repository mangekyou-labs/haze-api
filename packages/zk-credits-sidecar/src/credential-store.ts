import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { decryptAnyCredentialExport, type CreditCredential } from '@zk-credits/shared/base';

export interface CredentialStore {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}
const STORE_ERROR = 'OS credential storage is unavailable or access was denied. Enable Keychain, Windows Credential Manager, or Linux Secret Service and retry; no plaintext runtime credential was saved.';

/** Native entry scoped to this local home. Never puts secrets in subprocess arguments. */
export function nativeCredentialStore(stateDirectory: string): CredentialStore {
  const account = createHash('sha256').update(resolve(stateDirectory)).digest('hex');
  const entry = async () => {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    return new AsyncEntry('zk-credits', account, { linux: { store: 'secret-service' } });
  };
  return {
    async read() { try { return await (await entry()).getPassword(); } catch { throw new Error(STORE_ERROR); } },
    async write(value) { try { await (await entry()).setPassword(value); } catch { throw new Error(STORE_ERROR); } },
  };
}

export async function importStoredCredential(file: unknown, store: CredentialStore, legacyPassword?: string): Promise<CreditCredential> {
  const candidate = file as { version?: unknown; kind?: unknown } | null;
  if (candidate?.version !== 3 && legacyPassword === undefined) {
    throw new Error('Encrypted export: use zk-credits setup --legacy to import with its original password.');
  }
  const credential = await decryptAnyCredentialExport(file, legacyPassword);
  // Normalize legacy ciphertext into the same OS-protected activated runtime format.
  const value = JSON.stringify({ version: 1, credential });
  try {
    await store.write(value);
    if (await store.read() !== value) throw new Error('readback failed');
  } catch { throw new Error(STORE_ERROR); }
  return credential;
}

export async function readStoredCredential(store: CredentialStore): Promise<CreditCredential> {
  const raw = await store.read();
  if (!raw) throw new Error('No credential in OS storage. Download your activated credential and run zk-credits setup first.');
  try {
    const saved = JSON.parse(raw) as { version?: unknown; credential?: CreditCredential };
    if (saved.version !== 1 || !saved.credential) throw new Error();
    // Revalidate the secret and recompute commitment using the shared validator.
    const c = saved.credential;
    return await decryptAnyCredentialExport({
      format: 'zk-credits-credential', version: 3, kind: 'activated-credential',
      capsule: { version: 3, algorithm: 'plaintext', secret: c.secret },
      activation: { ...c, network: 'eip155:84532', contractAddress: 'local-store', transactionHash: 'local-store' },
    });
  } catch { throw new Error('Stored credential is malformed. Re-import your activated credential with zk-credits setup.'); }
}

export async function importCredentialPath(path: string, store: CredentialStore, password?: string): Promise<CreditCredential> {
  let file: unknown;
  try { file = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('Activated credential file could not be read as JSON.'); }
  return importStoredCredential(file, store, password);
}
