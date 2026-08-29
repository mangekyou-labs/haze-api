import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ApiKeySection } from './api-key-section';
import { BuyCreditsSection } from './buy-credits-section';
import { DashboardStatus } from './dashboard-status';
import { LlmPlayground } from './llm-playground';
import { isGatewayConfigured, isStripeConfigured } from '@/lib/runtime-config';

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />

      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {session.user?.email}
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

        <div className="space-y-6">
          <DashboardStatus />
          <ApiKeySection
            userId={session.user?.id ?? ''}
            gatewayConfigured={isGatewayConfigured({
              GATEWAY_SECRET: process.env.GATEWAY_SECRET,
            })}
          />
          <LlmPlayground
            gatewayConfigured={isGatewayConfigured({
              GATEWAY_SECRET: process.env.GATEWAY_SECRET,
            })}
          />
          <BuyCreditsSection
            stripeConfigured={isStripeConfigured({
              STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
            })}
          />
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
