# Decision: name the pilot destination and validation boundary

Status: decided  
Decision date: 2026-09-20

## Decision

Optimize for a paid Base Sepolia pilot, with Base mainnet treated as a later,
evidence-gated destination. Start with multi-agent and coding-agent operators
who have a concrete need to prevent a resource server from correlating agents
that share a payer or funding source.

The product promise is payer and credential unlinkability for ordinary valid
spends. It is not prompt confidentiality, provider blindness, traffic-analysis
resistance, or general anonymity. The gateway and upstream provider can still
observe request content, timing, token counts, and network metadata.

Continue toward production only if the quantitative gate in the map's
Destination section is met with real paid workloads. Operational definitions
and the interview/concierge program live in
[Define pilot activation and continuation evidence](../tickets/04-validation-evidence.md).

## Why

The original Ethereum Research discussion identifies multi-agent funding as
the clearest case where ZK provides value over an ordinary x402 session. A
Sepolia pilot tests that value without adding mainnet custody and ceremony risk
before product demand or the protocol implementation is proven.

## Consequences

- Distribution begins with direct design partners and a sidecar/SDK, not a
  generic marketplace launch.
- Marketing must describe the privacy boundary literally.
- Mainnet readiness, public distribution, and wider Web2 positioning remain
  separate decisions after the pilot.

