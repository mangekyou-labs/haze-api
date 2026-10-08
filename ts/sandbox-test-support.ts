import type { SandboxAccount, SandboxStore, SandboxSponsor } from './sandbox-billing.js';

export class MemorySandboxStore implements SandboxStore {
  private accounts = new Map<string, SandboxAccount>();
  private tail: Promise<unknown> = Promise.resolve();
  transaction<T>(id: string, change: (account: SandboxAccount) => T): Promise<T> {
    const next = this.tail.then(() => {
      const account = structuredClone(this.accounts.get(id) ?? { balanceCents: 0, reservedCents: 0, topups: [], bundles: [] });
      const result = change(account);
      for (const bundle of account.bundles) {
        for (const [owner, other] of this.accounts) {
          if (owner !== id && other.bundles.some(b => b.commitment === bundle.commitment)) throw new Error('commitment_already_owned');
        }
      }
      this.accounts.set(id, account);
      return result;
    });
    this.tail = next.catch(() => {});
    return next;
  }
  async topupOwner(id: string) { return [...this.accounts].find(([, a]) => a.topups.some(t => t.id === id))?.[0]; }
  async bundleOwner(commitment: string) { return [...this.accounts].find(([, a]) => a.bundles.some(b => b.commitment === commitment))?.[0]; }
}
export const HASH = `0x${'ab'.repeat(32)}`;
export const CONTRACT = `0x${'11'.repeat(20)}`;
export const ready: Awaited<ReturnType<SandboxSponsor['status']>> = {
  address: CONTRACT, tokenAddress: CONTRACT, usdcBalance: '20000000', gasBalanceWei: '1000000000', allowance: '20000000', ready: true, reason: null, faucetUrl: '',
};
