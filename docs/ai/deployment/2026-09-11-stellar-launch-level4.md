---
phase: deployment
title: Stellar Launch Level 4 deployment runbook
description: Testnet deployment, migration, monitoring, and cohort readiness
---

# Level 4 deployment runbook

## Required runtime configuration

Web and gateway must use the same `GATEWAY_SECRET`. The evaluation identity
secret is separate and must be high entropy:

- `EVALUATION_HMAC_SECRET`
- `DATABASE_URL` for the restricted Postgres instance
- `STRIPE_SECRET_KEY` beginning with `sk_test_`
- `STRIPE_WEBHOOK_SECRET`
- `GATEWAY_URL` and `GATEWAY_SECRET`
- `SENTRY_DSN`/release/environment values for web, gateway, and fee sponsor
- `NEXT_PUBLIC_POSTHOG_KEY` and optional host; absence is safe and remains no-op
- `FEE_SPONSOR_URL` for synthetic checks

No mnemonic, wallet private key, API key, raw signature, or proof belongs in
analytics, public evidence, CI output, or a deployment manifest.

## Sequence

```bash
cd ts
npm ci
npm run typecheck
npm test
npm run db:migrate
npm run evidence:export   # expected to refuse until ten complete records exist

cd ../web
npm ci
npm run test:unit
npm run build
```

Deploy the web app to Vercel and the gateway/fee sponsor to the selected free
Render services. Keep the Stellar contract on testnet at the existing contract
address; do not redeploy unless independent verification fails. Run the
synthetic workflow manually, then wait for two scheduled checks before inviting
participants.

## Rollback and retention

Web/gateway deployments are reversible. Do not roll back the evaluation schema
destructively: apply forward migrations, preserve restricted records until the
90-day deadline, and run the purge/anonymization operation with an audit note.
Never export the raw proof table.

## Release evidence

The release is blocked until the ten-user evidence exporter succeeds, all
transactions are verified on Stellar Explorer, monitoring screenshots are
current, and the demo shows no personal account or secret material.
