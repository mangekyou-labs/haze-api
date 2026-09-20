import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { PilotOnboardingFlow } from './pilot-onboarding-flow';
import { callGateway } from '@/lib/gateway';
import { BASE_SEPOLIA_EXPLORER, PILOT_CHAIN_ID, PILOT_NETWORK } from '@/lib/credits';

interface NetworkStatus {
  network: string;
  chainId: number;
  contractAddress: string | null;
  healthy: boolean;
  generatedAt: string;
  explorer: { address: string } | null;
}

const CONTRACT_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

async function networkStatus(): Promise<NetworkStatus> {
  try {
    const { status, data } = await callGateway({ method: 'GET', path: '/v1/contract-status' });
    const contractAddress = typeof data.contract === 'string' && CONTRACT_PATTERN.test(data.contract) ? data.contract : null;
    return {
      network: typeof data.network === 'string' ? data.network : PILOT_NETWORK,
      chainId: PILOT_CHAIN_ID,
      contractAddress,
      healthy: status === 200 && contractAddress !== null,
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString(),
      explorer: contractAddress ? { address: `${BASE_SEPOLIA_EXPLORER}/address/${contractAddress}` } : null,
    };
  } catch {
    return { network: PILOT_NETWORK, chainId: PILOT_CHAIN_ID, contractAddress: null, healthy: false, generatedAt: new Date().toISOString(), explorer: null };
  }
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const network = await networkStatus();

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />

      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-300/80">Invite-only unpaid pilot</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Pilot onboarding</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {session.user?.email ?? session.user?.name} · experimental Base Sepolia, no payment
            </p>
          </div>
          <form
            action={async () => {
              'use server';
              await signOut();
            }}
          >
            <button
              type="submit"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/60"
            >
              Sign out
            </button>
          </form>
        </div>

        <p className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm leading-6 text-zinc-400">
          This pilot is invite-only, unpaid, and experimental. Founder-issued
          invites provision Base Sepolia test credits; there is no checkout, no
          card, and no wallet purchase. The service never receives your
          credential secret, backup password, proofs, or spend identifiers.
        </p>

        <PilotOnboardingFlow network={network} gatewayBaseUrl={process.env.PUBLIC_GATEWAY_URL ?? 'https://your-gateway.example'} />

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Already have a credential?</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-100">Restore an encrypted credential locally</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Version-2 activated credentials and legacy version-1 exports are both
            accepted. Decryption happens in your browser.
          </p>
          <a href="/recover" className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
            Restore an encrypted credential
          </a>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
