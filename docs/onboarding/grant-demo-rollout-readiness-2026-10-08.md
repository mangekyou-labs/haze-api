# Founder demo rollout readiness — 2026-10-08

Recording remains gated on hosted Checkout, webhook, balance and bundle-funding acceptance. Local tests do not establish these gates.

## Reviewed candidate

The isolated rollout is commit `041a1072e799f791131fb042a595f5dc435b24af`, branch `founder-sandbox-rollout-2026-10-08`, prepared locally at `/tmp/haze-founder-readiness/rollout-git`. It overlays 41 sandbox gateway/web paths onto base `36d74f45b22ad5f8d0baa3c0b8bd66ab9a6743f4`; unrelated sidecar changes and local credentials are excluded. Source hashes and the exact path list are in `/tmp/haze-founder-readiness/rollout-manifest.json`.

Review found a recovery defect: sponsor reconciliation requested 2,000-block log ranges despite the hosted RPC's ten-block limit. The fix honors `BASE_SYNC_MAX_BLOCK_RANGE`, validates positive whole numbers, and preserves inclusive contiguous ranges. A regression test reproduced the error before the fix and passed afterward. Standards/spec reviewers found no blocking defects in this patch.

Known operational limits: ambiguous sponsor attempts remain held until reconciliation succeeds; owner snapshot polling drives recovery and may block other accounts if the owner leaves. Ten-block historical scans can be slow. Sandbox credential activation currently assumes deployment domain `84532`; Render's configured domain matches.

## Validation

- Backend TypeScript and full suite: 427 passed, 43 skipped.
- Web TypeScript, production build and full suite: 53 passed.
- Local Chromium onboarding/crypto flows: 13 passed; gateway/chain responses are mocked.
- Disposable local Postgres integration: 14 passed; no hosted database was mutated.
- Graph refreshed; existing SQL-parser/source extraction warnings remain.

## Hosting evidence

The replacement Vercel credential authenticates successfully. Public `hazecredits.vercel.app` belongs to project `prj_OdIixKoziusP4cY4YqlhblKsfrTM` (`zk-credits-web`), whose root directory is unset. The root checkout's other linked project does not own that domain.

The public project has production authentication/gateway keys but lacks `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Existing values are marked sensitive and unreadable, so equality with local configuration has not been established. A sandbox preview was created from isolated `web/` source with explicit preview runtime configuration:

https://zk-credits-60t3nyy5p-gadillacers-projects.vercel.app

Deployment ID: `dpl_BnV4y51pS1ksAGSfmWruShFtM9fA`. Vercel authentication protects this preview. Vercel reported READY after a 40-second build. This establishes hosted build success; authenticated Checkout and gateway acceptance are still pending.

Render service `srv-d9sku9dbedkc73dofd7g` tracks `feature-base-zk-credits`, currently commit `2f3117db7dade105b34c0bb37540efadb2337411`; redeploying that branch would omit the candidate. Its configured log range is not `10` and must be aligned for rollout. The service is generally ready, but sandbox routes remain undeployed.

## Remaining external gates

Push only the isolated candidate branch, deploy that exact gateway revision (including migration 0020), configure the verified public web runtime and deploy it, then configure the Stripe TEST webhook at `/api/sandbox/webhook`. Complete a genuine Checkout and verify webhook delivery, account balance, bundle funding, and retry/recovery behavior. Do not substitute fabricated events.

Use the reviewed local sidecar candidate for recording; public npm 0.2.11 lacks the candidate's investigator/task evidence features. Prior successful paid investigator output remains usable when labeled as prior evidence. Current repeated invocations return partial recovered-stopped results and are not fresh paid exchanges.

No production promotion, gateway rollout, new Stripe Checkout, recording, publication or submission has occurred as of this preparation.
