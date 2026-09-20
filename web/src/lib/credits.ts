/**
 * Browser-side pilot credential helpers.
 *
 * The service never receives the secret, the backup password, or the
 * plaintext capsule. Only ciphertext and public funding metadata are stored
 * locally, and the funding token lives in session storage until funding
 * succeeds.
 */

import {
  computeCommitment,
  createRecoveryCapsuleFile,
  decryptAnyCredentialExport,
  generateSecret,
  verifyRecoveryCapsule,
  wrapActivatedCredential,
  type ActivatedCredentialFile,
  type CreditCredential,
  type RecoveryCapsuleFile,
} from '@zk-credits/shared/base';

export const PILOT_TIER_ID = 0;
export const PILOT_TIER_ALLOWANCE = 250;
export const PILOT_NETWORK = 'eip155:84532';
export const PILOT_CHAIN_ID = 84532;
export const BASE_SEPOLIA_EXPLORER = 'https://sepolia.basescan.org';

const PENDING_CAPSULE_KEY = 'zk-credits:pending-capsule';
const LOCAL_CREDENTIAL_KEY = 'zk-credits:credential-metadata';
const FUNDING_TOKEN_KEY = 'zk-credits:funding-token';

function downloadJson(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadRecoveryCapsule(file: RecoveryCapsuleFile, commitment: string): void {
  downloadJson(file, `zk-credits-recovery-capsule-${commitment.slice(0, 12)}.json`);
}

export function downloadActivatedCredential(file: ActivatedCredentialFile): void {
  downloadJson(file, `zk-credits-credential-${file.activation.commitment.slice(0, 12)}.json`);
}

/** Generates the secret locally and encrypts only that secret in the capsule. */
export async function createRecoveryCapsule(password: string): Promise<{ file: RecoveryCapsuleFile; commitment: string }> {
  const secret = generateSecret();
  const commitment = await computeCommitment(secret);
  return { file: await createRecoveryCapsuleFile(secret, password), commitment };
}

/** Pre-funding re-import: the downloaded capsule must decrypt to the same commitment. */
export async function confirmRecoveryCapsule(
  file: RecoveryCapsuleFile,
  password: string,
  expectedCommitment: string,
): Promise<string> {
  const reopened = await verifyRecoveryCapsule(file, password);
  if (reopened.commitment !== expectedCommitment) {
    throw new Error('That capsule does not match the credential generated in this browser.');
  }
  return reopened.commitment;
}

export function wrapWithActivation(
  capsuleFile: RecoveryCapsuleFile,
  activation: {
    commitment: string;
    tierId: number;
    expiry: number;
    deploymentDomain: string;
    network: string;
    contractAddress: string;
    transactionHash: string;
  },
): ActivatedCredentialFile {
  return wrapActivatedCredential(capsuleFile.capsule, activation);
}

export function savePendingCapsule(file: RecoveryCapsuleFile): void {
  localStorage.setItem(PENDING_CAPSULE_KEY, JSON.stringify(file));
}

export function readPendingCapsule(): RecoveryCapsuleFile | null {
  const raw = localStorage.getItem(PENDING_CAPSULE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RecoveryCapsuleFile;
    if (parsed?.format !== 'zk-credits-credential' || parsed.version !== 2 || parsed.kind !== 'recovery-capsule' || !parsed.capsule) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingCapsule(): void {
  localStorage.removeItem(PENDING_CAPSULE_KEY);
}

/** The funding token is session-scoped and erased as soon as funding succeeds. */
export function saveFundingToken(token: string): void {
  sessionStorage.setItem(FUNDING_TOKEN_KEY, token);
}

export function readFundingToken(): string | null {
  return sessionStorage.getItem(FUNDING_TOKEN_KEY);
}

export function clearFundingToken(): void {
  sessionStorage.removeItem(FUNDING_TOKEN_KEY);
}

export interface LocalCredentialMetadata {
  version: 1 | 2;
  tierId: number;
  expiry: number;
  deploymentDomain: string;
  /** Ciphertext only: a version-2 activated credential or a legacy export. */
  payload: unknown;
  savedAt: number;
}

export function saveLocalCredential(metadata: LocalCredentialMetadata): void {
  localStorage.setItem(LOCAL_CREDENTIAL_KEY, JSON.stringify(metadata));
}

export function readLocalCredential(): LocalCredentialMetadata | null {
  const raw = localStorage.getItem(LOCAL_CREDENTIAL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalCredentialMetadata>;
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      typeof parsed.tierId !== 'number' ||
      typeof parsed.expiry !== 'number' ||
      typeof parsed.deploymentDomain !== 'string' ||
      !parsed.payload
    ) {
      return null;
    }
    return parsed as LocalCredentialMetadata;
  } catch {
    return null;
  }
}

/**
 * Imports a downloaded export for local use. Accepts both the version-2
 * activated credential and the legacy version-1 export; the commitment is
 * recomputed locally, never trusted from the file.
 */
export async function importCredentialFile(
  parsed: unknown,
  password: string,
): Promise<{ credential: CreditCredential; activated: ActivatedCredentialFile | null }> {
  const credential = await decryptAnyCredentialExport(parsed, password);
  const activated = (parsed as ActivatedCredentialFile)?.kind === 'activated-credential'
    ? parsed as ActivatedCredentialFile
    : null;
  saveLocalCredential({
    version: activated ? 2 : 1,
    tierId: credential.tierId,
    expiry: credential.expiry,
    deploymentDomain: credential.deploymentDomain,
    payload: activated ?? (parsed as { encrypted?: unknown }).encrypted,
    savedAt: Date.now(),
  });
  return { credential, activated };
}

export function explorerTransactionUrl(transactionHash: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/tx/${transactionHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/address/${address}`;
}

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Pending';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(timestamp));
}
