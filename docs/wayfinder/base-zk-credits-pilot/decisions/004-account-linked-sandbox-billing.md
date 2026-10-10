# Account-linked sandbox billing

Accepted by the owner on 2026-10-07. Public sandbox activation replaces detached
invite authorization with an authenticated simulated balance and per-account
bundle history. A signed Stripe sandbox Checkout credits $20 simulated USD;
activation reserves that amount and deducts it once after confirmed funding of
one 250-credit Base Sepolia bundle. Stripe payments do not buy onchain USDC.

This supersedes decision 003 for the public sandbox; historical detached modules
and recovery remain separate. Account and Checkout identifiers may be joined to
funded commitments in the billing plane. They must not enter spend proofs,
claims, or inference telemetry. The privacy claim is payment-proof unlinkability;
the service can link funding history to accounts and observe inference content
and traffic metadata.

A definitive failure releases the simulated reservation. An ambiguous broadcast
holds it across restarts until the same attempt is reconciled. No retry may
broadcast while an earlier attempt remains unresolved.
