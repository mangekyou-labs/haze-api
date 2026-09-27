import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import { ApiKeySection } from './api-key-section';
import { BuyCreditsSection } from './buy-credits-section';
import { DashboardStatus } from './dashboard-status';
import { EvaluationSection } from './evaluation-section';

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  return (
    <main className="min-h-screen p-4 sm:p-8 max-w-3xl mx-auto overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{session.user?.email}</span>
          <form
            action={async () => {
              'use server';
              await signOut();
            }}
          >
            <button type="submit" className="text-sm text-gray-500 hover:text-gray-900">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="space-y-8">
        <DashboardStatus />
        <EvaluationSection />
        <ApiKeySection />
        <BuyCreditsSection />
      </div>
    </main>
  );
}
