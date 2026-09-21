---
phase: requirements
title: Base private API credits requirements
description: Paid Base Sepolia private-credit pilot with sidecar zk-prepaid spend and Stripe-funded escrow
---

# Base private API credits

Date: 2026-09-20  
Feature slug: `base-zk-credits`  
Branch: `feature-base-zk-credits`  
Baseline: `feature-stellar-launch-level4`  
Status: approved 2026-09-20 on [Review the reconciled pilot design and implementation plan](../../wayfinder/base-zk-credits-pilot/tickets/05-reconcile-pilot-docs.md); current circuits and contract still implement the rejected share equation and must not carry paid traffic

Normative decisions live in the
[paid private-credit pilot map](../../wayfinder/base-zk-credits-pilot/map.md)
and its closed tickets. Domain terms are in the
[pilot glossary](../../wayfinder/base-zk-credits-pilot/CONTEXT.md).

## Problem and objective

Give a principal who already isolates agents a private credential for a
bounded coding service class. The resource server must authorize a call
without learning the principal's account, order, wallet, commitment, or
remaining balance. Ordinary spends must not link credentials. Reusing one
slot on two different request signals must be slashable.

The pilot tests whether those operators will pay for payer unlinkability and
credential unlinkability. It does not promise request privacy, provider
blindness, or network anonymity.

## Scope

In scope:

- One live SKU and one versioned service class on Base Sepolia.
- GitHub accounts, optional SIWE wallet linking, Stripe Checkout, and a
  browser-generated encrypted credential that the partner sidecar holds.
- Sponsor-funded Base Sepolia USDC bonds in an immutable `PrivateCreditBond`.
- Circom 2 plus BN254 Groth16 spend proofs generated only in the sidecar.
- Custom x402 v2 `zk-prepaid` through the project adapter, resource server,
  and self-hosted facilitator.
- OpenRouter Chat Completions for `deepseek/deepseek-v4-flash`.
- Buffered encrypted replay, durable sponsorship/maturity/refund/dispute
  jobs, and a Base-aware dashboard without remaining-credit or usage history.
- Twelve past-behavior interviews, then at most three activated design
  partners, with sidecar-local continuation evidence.

Out of scope:

- Base mainnet, a production proving ceremony, and generic public-facilitator
  or Bazaar distribution.
- Generic x402 wallets, a standard `exact` rail, MCP transport,
  `/v1/responses`, and Anthropic translation as acceptance requirements.
- Streaming, images, files, audio, web plugins, model fallback, and
  client-selected routing.
- Remaining-call counters, per-credential history, prompt fields, and joining
  Stripe identity to nullifiers or request signals.
- Replacing conventional API keys for users without an unlinkability need.

## Product invariants

One SKU:

| Item | Value |
| --- | --- |
| Service class | `coding-deepseek-v4-flash-v1` |
| Credit | one successfully committed Chat Completions response |
| Allowance | 250 credits; in-circuit slot range `[0, 250)` |
| Price | $20 non-refundable service fee + $20 refundable bond |
| Validity | 30 days after activation, then a 7-day slash-challenge window |
| Bond | liability, not revenue |

The browser generates the secret and commitment. Stripe metadata contains
only an opaque order ID. The control plane may know that a principal paid
and activated. It must not store the secret or join that identity to
nullifiers or request signals. The credential export is password-encrypted
and must be downloaded or acknowledged before Checkout.

Spend proofs are generated only in the partner sidecar. A proof failure is
not a claim, not a cancellation, and not slash evidence.

## User stories

1. As a multi-agent or split-key coding-agent operator, I can pay the live
   SKU, install the sidecar on my machine, and make real calls whose payment
   proofs do not identify me or my other credentials.
2. As that operator, I can retry an exact committed request and receive the
   stored replay without spending a second credit.
3. As a reporter, I can submit two valid conflicting transcripts and slash
   the bond 50/50 without a live 402.
4. As the map owner, I can stop continuation toward production if any
   destination line is missed, without qualitative override.

## Acceptance criteria

1. A valid funded bundle can produce a spend proof for any unused slot in
   `[0, 250)` under the restored share equation and the six-signal ABI
   `[root, timestamp, domain, requestSignal, nullifier, share]`. Altered
   roots, paths, tier, expiry, timestamp, domain, signal, nullifier, share,
   slot, zero secret, zero slot blinding, or zero request signal are
   rejected.
2. Spend authorization requires gateway-issued `extra.issuedAt` in
   `[now - 300s, now + 5s]`; public `timestamp` equals that value; the
   request signal matches this HTTP request. Cached 402s die when `issuedAt`
   leaves the window. Slash evidence does not use that window.
3. A settled exact retry reuses its reservation and encrypted replay without
   a second slot or provider dispatch. Two different signals with one
   nullifier recover slot blinding, then secret, and slash exactly once.
4. `/v1/chat/completions` returns a Base64 custom x402 v2 challenge when
   authorization is absent or stale, with `amount: "1"`,
   `asset: "coding-deepseek-v4-flash-v1"`, and `extra.issuedAt`. It accepts a
   valid `PAYMENT-SIGNATURE` from the project adapter after local
   self-verify and returns `PAYMENT-RESPONSE` with `transaction: ""`.
5. The gateway reserves before dispatch and commits only after a buffered,
   structurally valid provider 2xx within the 1 MiB replay cap. Streaming is
   not accepted. Local validation failures, non-2xx, timeouts, oversized
   bodies, and proof failures consume no credit.
6. Stripe webhooks are signed, idempotent, and opaque. Sponsorship, release,
   refunds, disputes, and reconciliation are retryable durable jobs.
7. No production log, spend-plane row, response replay, dashboard view, or
   weekly sidecar export contains plaintext prompts, responses, secrets,
   proofs, wallet/account identifiers, remaining-credit data, nullifiers, or
   request signals.
8. Paid partners and unlinkability claims wait on the paid-traffic gate:
   independent cryptographic review, R1CS of 6 public / 48 private, the
   negative-test set, a real Solidity verifier on Base Sepolia, and
   two-transcript recovery.
9. Continuation toward production requires three activated design partners;
   two with at least 1,000 real calls; two with a two-agent deployment; two
   with dated written renewal intent at the live SKU; soak p95 hot prove
   time within each partner's accepted proving latency and no looser than
   p95 ≤ 3.0s; and zero manual recoveries.

## External gates

The Base Sepolia contract address, sponsor/refund/treasury addresses, Stripe
credentials, OpenRouter credentials, independent reviewer, and live
end-to-end checkout are deployment inputs, not local defaults. A production
ceremony and Base mainnet belong to a later go/no-go map.

## Named assumptions

- Circom 2 plus BN254 Groth16 remains the proving direction.
- Development proving keys are allowed on Sepolia until the paid-traffic
  gate; they are not production keys.
- x402 maintainer confirmation of the custom-asset reading is a later
  conformance gate, not a pilot blocker.
- The linkable session exists only as paper comparison during interviews.
