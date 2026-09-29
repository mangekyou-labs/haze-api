export function SiteFooter() {
  return (
    <footer
      data-testid="site-footer"
      className="border-t border-zinc-800/80 py-8"
    >
      <div className="mx-auto max-w-6xl space-y-2 px-6 text-xs leading-relaxed text-zinc-500">
        <p>
          Base Sepolia &middot; invite-only research pilot &middot; OpenRouter inference
          &mdash; experimental, testnet only, and not independently audited.
        </p>
        <p>
          External slots A and C receive a fixed $25 honorarium for a 30-minute
          session, regardless of setup success. It is research compensation,
          not product revenue or evidence of willingness to pay. Product calls
          use founder-provisioned test credits and have no product payment step.
        </p>
        <p>
          Supported clients: the project sidecar for{' '}
          <code className="text-zinc-400">POST /v1/chat/completions</code>, or an
          x402-native agent that explicitly registers the custom{' '}
          <code className="text-zinc-400">zk-prepaid</code> adapter. Generic x402
          clients, unmodified agents, public facilitators, Bazaar, MCP, and the
          standard exact rail are unsupported.
        </p>
        <p>
          For valid spends, the payment proof is designed for payer and
          credential unlinkability. Pilot telemetry does not collect prompts,
          responses, secrets, proofs, nullifiers, request signals, or
          payer/spend-plane joins. The gateway and the upstream provider can
          still observe request content and traffic metadata.
        </p>
        <p>
          Honest caveats: development proving material is for Sepolia; one
          active local proxy per credential is supported; browser proving adds
          latency; your network identity / IP is not hidden.
        </p>
      </div>
    </footer>
  );
}
