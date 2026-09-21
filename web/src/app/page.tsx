import Link from 'next/link';
import { REPO_URL, SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const STEPS = [
  {
    title: '1. Get invited',
    body: 'Access is invite-only. A founder issues a single-use invite bound to your GitHub account; there is no open registration and no payment step.',
  },
  {
    title: '2. Sign in and create your credential',
    body: 'GitHub is the account system. Your browser generates the private secret and a password-encrypted recovery capsule that you download and re-import.',
  },
  {
    title: '3. Founder provisions test credits',
    body: 'A founder funds tier 0 on Base Sepolia for your commitment. You verify the activated credential locally before using it.',
  },
  {
    title: '4. Install a supported client',
    body: 'Run the project sidecar for /v1/chat/completions, or register the custom zk-prepaid adapter in an x402-native agent, then make a call.',
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
            Base Sepolia &middot; invite-only unpaid pilot &middot; experimental x402 v2 zk-prepaid
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-bold tracking-tight text-white sm:text-6xl">
            ZK API Credits
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
            Invite-only, unpaid, experimental pilot for private prepaid API
            credits on Base Sepolia. Founder-provisioned test credits, no card
            or wallet flow, and no recurring charge.
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
              <h2 className="font-semibold text-zinc-100">Supported clients</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                One spend path:{' '}
                <code className="font-mono text-xs text-cyan-300">
                  POST /v1/chat/completions
                </code>{' '}
                through the project sidecar, or an x402-native agent that
                explicitly registers the custom{' '}
                <code className="font-mono text-xs text-cyan-300">
                  zk-prepaid
                </code>{' '}
                adapter. <span className="font-medium text-zinc-300">/supported</span>{' '}
                advertises x402 v2, zk-prepaid, eip155:84532, prepaid-claim, and
                escrow.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">Privacy boundary</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Pilot telemetry does not collect prompts, responses, secrets,
                proofs, nullifiers, request signals, or payer/spend-plane joins.
                The gateway and the upstream provider can still observe request
                content and traffic metadata.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">Experimental circuit</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                The circuit is experimental and has not been independently
                audited. Base Sepolia test credits only: not production-ready,
                and no audited-privacy or generic x402 compatibility claim.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">Honest caveats</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Sepolia-only test credits &middot; requires the project sidecar
                or a registered adapter &middot; one active local proxy per
                credential &middot; proving adds latency &middot; your network
                identity / IP is not hidden.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
