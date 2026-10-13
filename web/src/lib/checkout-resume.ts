import type { RecoveryCapsuleFile } from '@zk-credits/shared/base';

const KEY = 'zk-credits:checkout-resume';
const MAX_AGE = 30 * 60 * 1000;
type Resume = { capsule: RecoveryCapsuleFile; selectedAmount: number; activationAttempted: boolean };

/** Tab-local, one-use credential handoff across Stripe; never sent to a server. */
export function saveCheckoutResume(accountId: string, resume: Resume) {
  sessionStorage.setItem(KEY, JSON.stringify({ ...resume, accountId, expiresAt: Date.now() + MAX_AGE }));
}
export function clearCheckoutResume() { sessionStorage.removeItem(KEY); }
export function takeCheckoutResume(accountId: string): Resume | null {
  const raw = sessionStorage.getItem(KEY);
  clearCheckoutResume();
  if (!raw || raw.length > 64 * 1024) return null;
  try {
    const value = JSON.parse(raw);
    if (value.accountId !== accountId || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || ![500, 2000, 10000].includes(value.selectedAmount) || typeof value.activationAttempted !== 'boolean' || value.capsule?.kind !== 'recovery-capsule') return null;
    return { capsule: value.capsule, selectedAmount: value.selectedAmount, activationAttempted: value.activationAttempted };
  } catch { return null; }
}
