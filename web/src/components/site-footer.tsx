export function SiteFooter() {
  return (
    <footer
      data-testid="site-footer"
      className="border-t border-zinc-800/80 py-8"
    >
      <div className="mx-auto max-w-6xl space-y-2 px-6 text-xs leading-relaxed text-zinc-500">
        <p>
          Stellar testnet &middot; USDC testnet &middot; OpenRouter (400+
          models) &mdash; testnet only, no real money.
        </p>
        <p>
          Honest caveats: 100-ticket specialization (Starter package);
          variable-cost refunds deferred (fixed per-call pricing);
          single-contributor dev-only trusted setup; custodial
          gateway-mediated withdrawal (gateway can block by disappearing, but
          membership-removal proof prevents unilateral redirect); async
          per-call on-chain audit; one gateway operator can observe call timing
          patterns; browser proving adds latency; your network identity / IP is
          not hidden.
        </p>
      </div>
    </footer>
  );
}
