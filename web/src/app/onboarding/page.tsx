import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import Link from 'next/link';

const CODEX_FIRST_USE_GUIDE =
  'https://github.com/mangekyou-labs/haze-api/blob/main/docs/onboarding/base-zk-credits-codex-first-use.md';

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl shadow-black/20">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-300/80">Get started</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">Set up your API credits</h1>
          <ol className="mt-8 space-y-4 text-sm text-zinc-300">
            <li><span className="font-semibold text-cyan-200">01.</span> Sign in with GitHub and enter your invite code.</li>
            <li><span className="font-semibold text-cyan-200">02.</span> Create your credential and save your recovery file.</li>
            <li><span className="font-semibold text-cyan-200">03.</span> Activate your credits on Base Sepolia.</li>
            <li><span className="font-semibold text-cyan-200">04.</span> Connect your client with the <a className="text-cyan-200 underline underline-offset-4" href={CODEX_FIRST_USE_GUIDE} target="_blank" rel="noreferrer">setup guide</a>.</li>
          </ol>
          <Link href="/dashboard" className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
            Set up credits
          </Link>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
