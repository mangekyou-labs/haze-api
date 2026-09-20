import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import Link from 'next/link';

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl shadow-black/20">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-300/80">Invite-only · unpaid · experimental</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">Join the Base Sepolia pilot</h1>
          <p className="mt-4 text-sm leading-6 text-zinc-400">
            The pilot is limited to founder-issued invites and GitHub sign-in.
            There is no checkout, no card, and no wallet purchase: a founder
            provisions Base Sepolia test credits for your credential. The
            browser generates your secret, and the service never receives it,
            your backup password, your proofs, or your spend identifiers.
          </p>
          <ol className="mt-8 space-y-4 text-sm text-zinc-300">
            <li><span className="font-semibold text-cyan-200">01.</span> Sign in with GitHub.</li>
            <li><span className="font-semibold text-cyan-200">02.</span> Redeem your single-use pilot invite.</li>
            <li><span className="font-semibold text-cyan-200">03.</span> Generate, download, and re-import your recovery capsule.</li>
            <li><span className="font-semibold text-cyan-200">04.</span> Fund tier 0 on Base Sepolia and verify the activated credential locally.</li>
            <li><span className="font-semibold text-cyan-200">05.</span> Point the local proxy at the activated credential and make a private call.</li>
          </ol>
          <p className="mt-6 text-xs leading-5 text-zinc-500">
            Experimental software on a test network. Not audited, not
            production-ready, and only for agents that register the project
            <code className="mx-1 text-zinc-400">zk-prepaid</code> adapter.
          </p>
          <Link href="/dashboard" className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
            Open pilot onboarding
          </Link>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
