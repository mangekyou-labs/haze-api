import Link from 'next/link';
import { REPO_URL, SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const STEPS = [
  {
    title: 'Sign in & fund',
    body: 'Sign in with GitHub and buy credits via Stripe (test mode).',
  },
  {
    title: 'Generate your secret',
    body: 'Your browser generates a secret key that never leaves your device.',
  },
  {
    title: 'Prove, don’t reveal',
    body: 'Call LLMs through the gateway with ZK-RLN proofs.',
  },
  {
    title: 'Stay unlinked',
    body: 'The gateway cannot link your calls to your deposit.',
  },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(99,102,241,0.22),transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 font-mono text-xs text-zinc-300">
            ZK-RLN &middot; Stellar CAP-0059 (BLS12-381)
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-bold tracking-tight text-white sm:text-6xl">
            ZK API Credits
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
            Anonymous RLN-rate-limited API credits for coding agents on
            Stellar.
          </p>

          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/sign-in"
              className="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white shadow-lg shadow-indigo-950/50 transition-colors hover:bg-indigo-500"
            >
              Get Started
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-zinc-700 px-6 py-3 font-medium text-zinc-200 transition-colors hover:bg-zinc-800/60"
            >
              GitHub
            </a>
          </div>

          <div className="mt-20 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div
                key={step.title}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
              >
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 font-mono text-sm font-semibold text-indigo-300">
                  {i + 1}
                </div>
                <h2 className="font-semibold text-zinc-100">{step.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  {step.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 text-left lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">Privacy</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                ZK-RLN proofs verified on-chain via Stellar&apos;s native
                BLS12-381 (CAP-0059). The gateway sees your proof but cannot
                determine which deposit funded your call.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">Rate Limiting</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                100 calls/day (configurable). Over-quota double-spend triggers
                a slash: 50% to protocol treasury, 50% to the reporter.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

