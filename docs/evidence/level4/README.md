# Stellar Launch — Level 4 evidence index

Status: **implementation complete locally; submission gate open**  
Snapshot: 2026-09-11  
Scope: Stellar testnet + Stripe test mode only.

This index is intentionally honest about what is and is not verified. Local
tests, mocked browser flows, and an existing contract transaction are not a
substitute for ten distinct consenting humans using the live deployment.

## Submission links

- Repository baseline: [mangekyou-labs/haze-api](https://github.com/mangekyou-labs/haze-api)
- Live Vercel URL: [current READY deployment](https://feature-zk-api-credits-p9pblnpqd-gadillacers-projects.vercel.app/) — HTTP 200 verified 2026-09-11; this deployment is from GitHub `main` SHA `426871ea250aad0668af2cae5e4d49bd6e213eec`, not the uncommitted local worktree
- Render gateway URL: **add and verify health before submission**
- Render fee-sponsor URL: **add and verify health before submission**
- Unlisted YouTube demo (4–6 minutes): **add after recording**

## Stellar evidence

- Contract: `CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT`
- Existing testnet transaction evidence: [Stellar Expert transaction](https://stellar.expert/explorer/testnet/tx/d793fe16c0165845249e6d92dc3111b104f888a4cdab8757f593657c6f9d2a66)
- The existing transaction demonstrates contract activity, but it is not
  counted as a ten-person cohort record.

## Repository and CI snapshot

- Active branch at snapshot: `feature-zk-api-credits`
- Local commit count at snapshot: `8`; the worktree contains uncommitted
  implementation changes. The supplied 68-commit baseline is not claimed for
  this active branch until the intended history is reconciled and published.
- Fresh local checks are recorded in
  [`docs/ai/testing/2026-09-11-stellar-launch-level4.md`](../../ai/testing/2026-09-11-stellar-launch-level4.md).
- Synthetic workflow: [`.github/workflows/synthetic-level4.yml`](../../../.github/workflows/synthetic-level4.yml)
- CI head status and deployment URLs: **refresh immediately before submission**.

## Current screenshots

These repository-local images are development captures and must be replaced or
dated with current deployed screenshots before submission:

- [`feature-stellar-launch-dashboard.png`](../../../feature-stellar-launch-dashboard.png)
- [`stellar-launch-final-onboarding.png`](../../../stellar-launch-final-onboarding.png)
- [`playwright-server-live-zk-request.png`](../../../playwright-server-live-zk-request.png)
- [`playwright-server-recovery-flow.png`](../../../playwright-server-recovery-flow.png)

Required final set: desktop landing/dashboard, mobile dashboard, consent and
wallet states, checkout return with Explorer link, feedback confirmation, and
monitoring evidence. Crop out all secrets and personal account information.

## Redacted cohort table

The table is populated only by `cd ts && npm run evidence:export` after the
ten-participant gate succeeds. Raw signatures, full wallets, identity mapping,
prompts, proofs, commitments, and API keys must never be committed here.

| Participant | Wallet | Confirmed testnet transaction | Completed | Feedback |
|---|---|---|---|---|
| **0 / 10 records available at snapshot** | — | — | — | — |

The exporter will emit `evidence.json` and `evidence.md` under the configured
output directory only when all ten records have consent, valid signatures,
unique wallets, unique confirmed transactions, and feedback.

## Feedback and monitoring

- Aggregate feedback: **pending ten-user cohort**
- PostHog opt-in/survey event screenshot: **pending production configuration**
- Sentry scrubbed test event screenshot: **pending production configuration**
- Synthetic cold/warm three-pass screenshot: **pending Render restoration**
- No SLA is claimed for free Render cold starts; the UI documents waking/retry behavior.

## Privacy and demo checklist

The demo may show the public participant code, redacted wallet, full testnet
transaction link, aggregate feedback, and safe product analytics. It must not
show a mnemonic, secret, proof, API key, raw signature, full wallet, cookies,
authorization header, personal GitHub account, or request body.

Milestone completion requires the live links, ten completed rows, feedback
summary, monitoring captures, current screenshots, demo URL, final review, and
published branch/review request to replace the pending entries above.

## Separate Base Sepolia internal trial

The controlled x402 trial uses the `zk-credits` launcher and is separate from
this Stellar testnet evaluation. Its launcher checkpoint and internal-versus-
external evidence boundary are tracked in
[`docs/evidence/base-sepolia-internal-trial.md`](../base-sepolia-internal-trial.md).
