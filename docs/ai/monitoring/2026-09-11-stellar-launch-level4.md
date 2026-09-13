---
phase: monitoring
title: Stellar Launch — Level 4 monitoring
description: Privacy-preserving telemetry and synthetic response plan
---

# Stellar Launch — Level 4 monitoring

Date: 2026-09-13
Feature slug: `stellar-launch`  
Status: local monitoring implementation complete; wallet-optional path pending local implementation; hosted restore and synthetic verification complete; telemetry evidence pending

## PostHog

Start opted out. Enable only after an explicit evaluation checkbox and send a
closed allowlist of coarse event names/properties. Disable autocapture,
pageviews, session recording, surveys, and arbitrary free text. Logout removes
consent and resets the client identity.

The primary evaluation path is walletless. It must not emit Freighter detection
failures, wallet prompts, signatures, commitments, or other wallet material as
PostHog properties or Sentry fields. Optional wallet-proof usage remains a
separate compatibility surface and does not change the primary telemetry
contract.

## Sentry

Use recursive depth-bounded scrubbing before send in web, gateway, and fee
sponsor. Remove authorization, cookies, prompts, request/body data, secrets,
mnemonics, proofs, commitments, signatures, wallet fields, API keys,
passwords, private keys, tokens, subjects, and identity fields. Disable default
PII, local variables, and breadcrumbs.

## Synthetic monitor

The scheduled/manual `.github/workflows/deploy-smoke.yml` job reads
`LEVEL4_FRONTEND_URL`, `LEVEL4_GATEWAY_URL`, and `LEVEL4_FEE_SPONSOR_URL`, then
checks frontend, gateway health/contract status, and fee-sponsor health with
bounded timeout and retries. It executes three sequential passes (cold, warm,
warm); missing variables fail closed rather than producing a false green.
Gateway retention runs through the dedicated-secret
`POST /v1/internal/evaluation/purge` operation and a daily in-process schedule
after the durable Postgres store is initialized.

Hosted restore and synthetic verification are complete on the Level 4
deployment. GitHub repository variables `LEVEL4_FRONTEND_URL`,
`LEVEL4_GATEWAY_URL`, and `LEVEL4_FEE_SPONSOR_URL` are configured, and Deploy
Smoke run [34736294570](https://github.com/mangekyou-labs/haze-api/actions/runs/34736294570)
passed its `level4-synthetic` job on the Level 4 commit. The separate legacy
hosted-smoke job still uses old unconfigured secrets/templates and is not a
Level 4 gate. Scrubbed Sentry and consented PostHog evidence remain pending;
missing variables or dashboards are never treated as green.

## Response

Treat gateway, contract, or fee-sponsor failure as a cohort blocker. The web
may describe free-host cold starts and offer retry, but no uptime SLA is
claimed. Monitoring output contains labels, statuses, durations, and safe
error classes only.
