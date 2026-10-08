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

## Approved public rollout

The user approved the prepared push and public rollout. Branch `founder-sandbox-rollout-2026-10-08` was pushed to `mangekyou-labs/haze-api`. Render deployment `dep-db3k31d9fdbs73e53n2g` became live at 2026-10-08T07:10:44Z with exact candidate commit `041a1072e799f791131fb042a595f5dc435b24af`; `BASE_SYNC_MAX_BLOCK_RANGE` was explicitly set to `10`. Render automatic deploys from the older tracked branch were disabled to preserve this exact reviewed revision; re-enable only after the candidate is integrated into the intended deployment branch.

Vercel production deployment `dpl_DZjZaCNLq7nHLxcGGADXJSFY6uR7` became READY. The public sandbox GET now returns 401 (authentication required) instead of 404; gateway readiness returns 200. Production runtime was set explicitly from configured local authentication/Stripe TEST values, the verified Render billing token, and the public gateway/auth URLs.

Existing Stripe TEST endpoint `we_1U29551I3zjIgUTMzbuhAMq8` was updated to `https://hazecredits.vercel.app/api/sandbox/webhook`, enabled for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Its signing secret was preserved. Actual delivery must still prove that the configured signing secret matches.

Authenticated hosted account status succeeds, with zero balance/reservations/bundles. Sponsor readiness currently reports `insufficient_usdc`: zero canonical Base Sepolia test USDC, zero allowance, and sufficient gas. Sponsor address: `0xfB630DFFbA6E1F5d75a73519014A941B89431d28`. The real browser reached GitHub login and needs the human to complete authentication.

No genuine new Stripe Checkout, successful bundle funding, recording, npm publication or submission has occurred yet. Earlier hosting evidence above describes the pre-rollout checks.


## Continuation after human authentication

Two browser sessions remain open through `/Users/kyler/.codex/skills/playwright/scripts/playwright_cli.sh`: `haze-founder` is at real GitHub OAuth login, and `haze-faucet` is at Circle's human CAPTCHA with Base Sepolia and the sponsor address already selected. The faucet request has not transferred tokens; no CAPTCHA bypass or alternate identity was attempted.

After the human completes these steps, use `/tmp/haze-founder-readiness/public-funder-status.py` to verify the transfer. `/tmp/haze-founder-readiness/approve-sandbox.cjs` is prepared to approve exactly 20 canonical test USDC to the hosted bond, validates chain/token/sponsor, includes Builder Code attribution, and reports only public transaction metadata. It has not been executed. Do not run another faucet request or change sponsor keys to evade limits.

Continue in the authenticated dashboard with a genuine Stripe TEST Checkout, verify its actual webhook delivery and balance increment, then generate/download/re-import the browser credential and fund its bundle. Preserve the existing canonical sidecar credential accounting state. Do not install the new browser credential over an existing sidecar credential for this acceptance check.

Deployment access scripts under `/tmp/haze-founder-readiness/` read local secret configuration privately; never dump their runtime values or attach credential files. Approved public deployments are complete; further permission for the same rollout is unnecessary. Human authentication/CAPTCHA remain external prerequisites, not deployment approval requests.

## Hosted acceptance progress — 08:47 UTC

Real GitHub OAuth completed after retrying an expired/unreadable PKCE check (`InvalidCheck`). No authentication configuration change or bypass was needed. The authenticated dashboard initially showed $0.00.

A genuine hosted Stripe TEST Checkout completed for 2,000 USD cents (`livemode=false`), session `cs_test_a1no2wQNez6TYFXKFT7KAE8MpHVaqwuZbBWjZzgZvgeJTvpZQKjDufObRt`. Its completion event `evt_1UOCye1I3zjIgUTM8CPyQjtD` reports zero pending webhooks, and the dashboard now shows $20.00 available / $0.00 held. This establishes actual Checkout, webhook signature/runtime, gateway credit and account display acceptance.

The browser generated and downloaded a recovery capsule locally. Its contents remain private and are excluded from git. Bundle funding is still gated on the sponsor's 20 test USDC: the faucet CAPTCHA expired before submission, and the human was asked to solve it and immediately send the already-filled Base Sepolia request. No approval transaction or bundle funding has occurred yet.
