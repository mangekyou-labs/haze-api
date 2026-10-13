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
      <SiteHeader dashboard />

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
          accountId={session.user.id}
        />


      </div>

      <SiteFooter />
    </main>
  );
}
