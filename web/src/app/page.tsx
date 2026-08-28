import Link from 'next/link';
import { REPO_URL, SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const STEPS = [
  {
    title: '1. Sign in & generate secret',
    body: 'Sign in with GitHub. Your browser generates a private secret key backed up by a 24-word recovery phrase (never leaves your device).',
  },
  {
    title: '2. Fund Starter on testnet',
    body: 'Purchase Starter ($1.00 for 100 tickets) with testnet USDC/card to register your commitment in the on-chain Merkle tree.',
  },
  {
    title: '3. Import to local CLI',
    body: 'Import your 24-word mnemonic into zk-credits sidecar (OS keychain) to run Cline, Claude, or Codex.',
  },
  {
    title: '4. Prove, don’t reveal',
    body: 'Call LLMs through the loopback sidecar with client-side ZK-RLN proofs (100 tickets per deposit).',
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
                BLS12-381 (CAP-0059). The gateway sees your proof and binds the
                request body, but cannot determine which deposit funded your
                call.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">
                Rate Limiting &amp; Slashing
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                100 tickets per deposit (indices 0..99). Over-quota
                double-spend reveals the secret key and triggers an on-chain
                slash: 50% to protocol treasury, 50% to the reporter.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">
                Hosted Infrastructure
              </h2>
              <div className="mt-2 space-y-1 text-sm leading-relaxed text-zinc-400">
                <p>
                  <span className="font-medium text-zinc-300">Gateway:</span>{' '}
                  <a
                    href="https://zk-credits-gateway.onrender.com/health"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-indigo-400 hover:underline"
                  >
                    https://zk-credits-gateway.onrender.com
                  </a>
                </p>
                <p className="break-all font-mono text-xs text-zinc-400">
                  <span className="font-sans font-medium text-zinc-300">
                    Contract:
                  </span>{' '}
                  CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h2 className="font-semibold text-zinc-100">Honest Caveats</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Testnet only &middot; 100-ticket specialization &middot;
                Variable-cost refunds deferred &middot; Single-contributor
                setup &middot; Gateway-mediated withdrawal &middot; Async
                settlement audit &middot; Single gateway timing &middot; Browser
                proving latency &middot; IP not hidden.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

