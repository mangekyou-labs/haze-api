import { signOut } from '@/auth';
import { renderSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { PilotOnboardingFlow } from './pilot-onboarding-flow';
const PUBLIC_GATEWAY_URL = process.env.PUBLIC_GATEWAY_URL?.trim()
  || process.env.NEXT_PUBLIC_GATEWAY_URL?.trim()
  || 'https://zk-credits-gateway.onrender.com';

export default async function DashboardPage() {
  const session = await renderSession();
  if (!session?.user?.id) redirect('/sign-in');

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />

      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-300/80">Base Sepolia</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Set up your credits</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {session.user?.email ?? session.user?.name}
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
              className="shrink-0 whitespace-nowrap rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/60"
            >
              Sign out
            </button>
          </form>
        </div>

        <PilotOnboardingFlow
          gatewayBaseUrl={PUBLIC_GATEWAY_URL}
        />

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Already have a credential?</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-100">Restore your credential</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Open your recovery file to restore your credential on this device.
          </p>
          <a href="/recover" className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
            Restore your credential
          </a>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
