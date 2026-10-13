import { beforeEach, expect, test, vi } from 'vitest';
import { clearCheckoutResume, saveCheckoutResume, takeCheckoutResume } from './checkout-resume';
import type { RecoveryCapsuleFile } from '@zk-credits/shared/base';
const resume = { capsule: { kind: 'recovery-capsule' } as RecoveryCapsuleFile, selectedAmount: 2000, activationAttempted: true };
beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
});
test('returns checkout state once for its signed-in account', () => {
  saveCheckoutResume('alice', resume);
  expect(takeCheckoutResume('alice')).toEqual(resume);
  expect(takeCheckoutResume('alice')).toBeNull();
});
test('clears another account’s temporary credential without restoring it', () => {
  saveCheckoutResume('alice', resume);
  expect(takeCheckoutResume('bob')).toBeNull();
  expect(takeCheckoutResume('alice')).toBeNull();
});
test('expires stale credentials and discards malformed stored state', () => {
  saveCheckoutResume('alice', resume);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
  expect(takeCheckoutResume('alice')).toBeNull();
  vi.restoreAllMocks();
  sessionStorage.setItem('zk-credits:checkout-resume', '{bad');
  expect(takeCheckoutResume('alice')).toBeNull();
});
test('allows clearing an interrupted checkout handoff', () => {
  saveCheckoutResume('alice', resume); clearCheckoutResume();
  expect(takeCheckoutResume('alice')).toBeNull();
});
