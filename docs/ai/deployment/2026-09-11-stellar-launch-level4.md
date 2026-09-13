---
phase: deployment
title: Stellar Launch — Level 4 deployment runbook
description: Testnet-only deployment order and external acceptance gates
---

# Stellar Launch — Level 4 deployment runbook

Date: 2026-09-13
Feature slug: `stellar-launch`  
Status: hosted restore and synthetic verification complete; cohort/evidence gates remain

## Configuration boundary

The web service owns `EVALUATION_HMAC_SECRET`, NextAuth/GitHub credentials,
Stripe test credentials (`sk_test_`), and the PostHog browser key. Gateway and
fee sponsor receive only their existing secrets/configuration plus
`EVALUATION_PURGE_SECRET` / `EVALUATION_PURGE_INTERVAL_MS` on the gateway and
the derived participant ID on authenticated internal requests. The gateway
never receives `EVALUATION_HMAC_SECRET`. A new restricted Singapore Postgres
instance, `zk-credits-db-level4-20260913`, is the current evaluation store;
the expired free database was not recovered. Secret values remain hosted and
are not committed to this worktree.

The current hosted URLs are:

- Web: <https://feature-zk-api-credits.vercel.app>
- Gateway: <https://zk-credits-gateway.onrender.com>
- Fee sponsor: <https://zk-credits-fee-sponsor.onrender.com>

The Vercel production deployment `dpl_BQLepbjZd7Nt1aJioeuqXoVKepgc` is Ready
from Level 4 commit `3c81f9907d60f455a10e5564a72f8570cf262c29`. The web-only
evaluation HMAC is configured in Vercel production and the
`feature-stellar-launch-level4` preview target. It is not configured on the
gateway or fee sponsor.

No mnemonic, private wallet key, raw signature, proof, prompt, API key, or
GitHub subject belongs in environment output, Stripe metadata, telemetry,
evidence, or CI logs.

## Release sequence

1. ~~Back up/inspect the target database and apply migrations `0001`–`0009` with
   the existing idempotent runner; run it twice and verify the isolated schema.~~
   Done on the new restricted store. Gateway logs recorded durable PostgreSQL
   initialization at 2026-09-13T02:15:02Z and 2026-09-13T02:18:29Z.
2. ~~Deploy gateway and fee sponsor; verify durable startup, health, and
   contract status.~~ Gateway `/health` and
   `/v1/contract-status`, and fee-sponsor `/health`, returned 200 after the
   Level 4 deploy.
3. Deploy web; verify consent enrollment, browser-held identity, checkout
   return, webhook retry, gateway-funded explorer link, feedback, and logout
   analytics reset. Freighter is not required for this primary path. The web
   deployment is live; consent, checkout, telemetry, explorer, and cohort
   evidence remain separate gates.
4. Configure the non-secret repository variables
   `LEVEL4_FRONTEND_URL`, `LEVEL4_GATEWAY_URL`, and
   `LEVEL4_FEE_SPONSOR_URL`, then run three cold/warm synthetic passes. The
   monitor fails closed when any variable is missing and never prints URLs or
   response bodies. The local three-pass run is green, and Deploy Smoke run
   [34736294570](https://github.com/mangekyou-labs/haze-api/actions/runs/34736294570)
   passed its `level4-synthetic` job on the Level 4 commit. The separate
   legacy hosted-smoke job still expects old `GATEWAY_URL`/`WEB_URL`/
   `FEE_SPONSOR_URL` secrets and is not a Level 4 result.
5. Complete the distinct authenticated-participant cohort and generate the
   redacted export. Unique personal wallets are not required; each complete
   record still needs a unique confirmed evaluation transaction.
6. Replace pending evidence, reconcile lifecycle docs, perform final review,
   repair GitHub authentication, and publish only after direct evidence exists.

## Retention operation

The gateway starts a non-overlapping daily purge after Postgres initialization.
For an operator-triggered run, send `POST /v1/internal/evaluation/purge` with
`Authorization: Bearer $EVALUATION_PURGE_SECRET`; this is a separate secret
from `GATEWAY_SECRET` and the response contains only `{ "purged": number }`.
Keep the secret in the gateway runtime configuration and do not place it in
web, Stripe metadata, telemetry, or evidence.

## Rollback

Web/gateway/fee-sponsor deployments can roll back independently. Do not drop
the evaluation schema to roll back. Preserve an audit record of the purge
count; never publish restricted rows.
