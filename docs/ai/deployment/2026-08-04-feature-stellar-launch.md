---
phase: deployment
feature: stellar-launch
title: "stellar-launch: Deployment Strategy"
description: Hosted testnet deployment — Render (gateway + fee-sponsor), Vercel (web), Soroban testnet (contract confirm).
---

# Deployment Strategy

## Infrastructure

| Component | Platform | URL | Status |
|---|---|---|---|
| Gateway (Node.js + Express) | Render | https://zk-credits-gateway.onrender.com | Blueprint prepared; deployment pending |
| Fee-sponsor service | Render | https://zk-credits-fee-sponsor.onrender.com | Blueprint prepared; deployment pending |
| Web (Next.js) | Vercel | https://feature-zk-api-credits-gadillacer-gadillacers-projects.vercel.app | Latest preview deployed; hosted checkout UX verified |
| PostgreSQL | Render Postgres | — | Blueprint prepared; free database is demo-only and expires/has limited retention |
| ZkCreditsContract | Stellar Soroban testnet | TBD | M3.1 verified; public `/v1/contract-status` 200 |
| CI | GitHub Actions | — | M3.5 DONE |

Environment separation: **testnet only** for this launch. No staging/production split — all deployments are testnet (USDC is testnet faucet, Stellar is testnet, Stripe is test mode).

Current deployment evidence (2026-08-11): the Fly trial ended and both public Fly services are suspended/resetting. The Render Blueprint is now checked into this worktree as `render.yaml`; both Docker images build successfully locally. Render service creation still requires the branch to be pushed/connected to a Render account. The linked Vercel project is ready for preview deployments; Render free web services sleep after inactivity and free Postgres is suitable only for disposable testnet/demo data.

### Preview deployment verification (2026-08-11)

- The first isolated Vercel preview failed because the materialized shared
  package imported `circomlibjs` without a direct `web/` dependency.
- `circomlibjs` is now declared directly in `web/package.json`, guarded by a
  build regression test. The corrected preview reached `Ready`:
  https://feature-zk-api-credits-o84arsd1w-gadillacers-projects.vercel.app
- This was a preview deployment only; no production promotion or repository
  push was performed. Local production build and Playwright both pass.

### Fresh ZK artifact release gate (complete locally)

The current indexed-ticket, slash/root-removal, and membership-removal source
statements now have a new BLS12-381 power-15 artifact set. The exact R1CS was
used for each setup; every zkey received a separate random contribution and
public beacon, then passed `snarkjs zkey verify`. Matching browser RLN and
withdrawal artifacts were copied to `web/public/circuits/`, and
`node scripts/vk-convert.js` exported the Soroban encodings.

Local release evidence: circuit prove/verify passes, shared proof tests pass
`19/19`, contract tests pass `24/24` with generated fixtures, gateway tests
pass `141` with `11` opt-in skips, and web unit/build/Playwright gates pass.

The remaining deployment actions require external testnet credentials and
service configuration:

1. build and deploy a **new** Soroban contract. `scripts/deploy-contract.js`
   installs the spend, slash, and membership keys in its one allowed
   post-constructor call;
2. update Render gateway/fee-sponsor configuration with the new contract ID
   and artifact bundle; and
3. create or update a Vercel **preview** for browser validation. Production
   promotion remains an explicit release decision.

### Live operational check (2026-08-11)

- `zk-credits-fee-sponsor.onrender.com/health` returned HTTP 200 in 0.18s.
- `zk-credits-gateway.onrender.com/health` timed out without headers after
  three bounded probes (20s, 50s wake attempt, 20s). Treat the gateway as
  unavailable for current M4 validation until the Render service is recovered;
  older hosted acceptance evidence cannot substitute for a current health check.

## Prerequisites: Credentials & Accounts

Before any deployment step, create/collect the following. See `.env.example` (root) and `web/.env.example` for the full variable list.

### Accounts to create

#### 1. Render (current gateway + fee-sponsor host)

Render hosts both services separately, plus one managed Postgres database. The complete service definition is in [`render.yaml`](../../render.yaml).

**1a. Connect the repository**
```bash
# Push the feature branch and its uncommitted implementation changes first.
# In Render: New → Blueprint → connect mangekyou-labs/haze →
# select feature-stellar-launch → apply render.yaml.
```

**1b. Fill secret prompts**
```bash
# Render prompts for every `sync: false` variable in render.yaml.
# Gateway: GATEWAY_SECRET_KEY, GATEWAY_ADDRESS, GATEWAY_SECRET,
#          ZK_CONTRACT_ID, USDC_CONTRACT_ID, USDC_ISSUER,
#          OPENROUTER_API_KEY
# Fee-sponsor: ZK_CONTRACT_ID, FEE_SPONSOR_SECRET_KEY
# Do not add Stripe credentials to Render; Stripe terminates at Vercel.
```

**1c. Verify and wire Vercel**
```bash
# Render waits for the database migration and both /health checks.
curl https://zk-credits-gateway.onrender.com/health
curl https://zk-credits-fee-sponsor.onrender.com/health
# Update Vercel GATEWAY_URL and NEXT_PUBLIC_GATEWAY_URL to the gateway URL.
```

**Cost/caveat:** Render free web services sleep after inactivity and free Postgres is not a production durability tier. Use a paid Render Postgres/web plan before handling real value.

#### Historical Fly.io setup (retired)

The following Fly commands and recovery notes are retained below as historical evidence only. The trial ended on 2026-08-10; do not use them for the active deployment.

---

#### 2. Stripe (test-mode payments)

**2a. Create Stripe account**
1. Go to [dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. Sign up with email — no business verification needed for test mode
3. Toggle **"Test mode"** (top-right toggle in dashboard) — should already be on

**2b. Get API keys**
1. Dashboard → **Developers** → **API keys**
2. Copy `sk_test_...` → this is `STRIPE_SECRET_KEY`
3. Keep the tab open — you'll need the webhook secret shortly

**2c. Create products & prices** (3 tiers: $5, $20, $50)
1. Dashboard → **Product catalog** → **Add product**
2. For each tier:

| Name | Price | Type | ID (after creation) → env var |
|---|---|---|---|
| ZK Credits $5 | $5.00 USD | One-time | `STRIPE_PRICE_5` |
| ZK Credits $20 | $20.00 USD | One-time | `STRIPE_PRICE_20` |
| ZK Credits $50 | $50.00 USD | One-time | `STRIPE_PRICE_50` |

3. Click into each created price → the ID is in the URL or under "Pricing" → copy the `price_xxxx` value.

**2d. Create webhook endpoint**
1. Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. **Endpoint URL:** `<web-url>/api/webhooks/stripe`
   - Local dev: `http://localhost:3000/api/webhooks/stripe`
   - Production: `https://<vercel-deployment>/api/webhooks/stripe`
   - Do **not** point Stripe directly at the gateway: the Vercel route verifies Stripe's signature, strips payment details, and relays only the event id/type/hash plus commitment and amount to the gateway.
3. **Events to send:** Select `checkout.session.completed`
4. Click **Add endpoint** → reveal the **Signing secret** (`whsec_...`) → this is `STRIPE_WEBHOOK_SECRET`

**2e. Collect the variables**
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_5=price_...
STRIPE_PRICE_20=price_...
STRIPE_PRICE_50=price_...
```

**Cost:** Free in test mode. No real charges.

---

#### 3. Vercel (web app host)

1. Go to [vercel.com/signup](https://vercel.com/signup) → sign in with GitHub
2. Install CLI: `npm i -g vercel`
3. Link the repo:
   ```bash
   cd web
   vercel link              # creates .vercel/ dir; follow prompts
   ```
4. Vercel auto-detects Next.js from `web/vercel.json`. The `prebuild` script in `web/package.json` handles the shared package build.

**Cost:** Vercel Hobby tier is free (100 GB bandwidth, 6000 build minutes/month).

---

#### 4. GitHub OAuth app

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
2. Fill in:
   - **Application name:** `ZK API Credits (testnet)`
   - **Homepage URL:** `<vercel-url>` (your Vercel deployment URL)
   - **Callback URL:** `<vercel-url>/api/auth/callback/github`
3. Click **Register application**
4. **Generate a client secret** → copy both:
   - `GITHUB_CLIENT_ID` (shown at top)
   - `GITHUB_CLIENT_SECRET` (click "Generate a new client secret")

---

#### 5. OpenRouter API key

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) → **Create Key**
2. Copy `sk-or-...` → this is `OPENROUTER_API_KEY`
3. Note your tier/limit for the M4.6 pre-launch check

### Stellar testnet keys (generate + fund via Friendbot)
```bash
stellar keys generate --global gateway        # GATEWAY_SECRET_KEY / GATEWAY_ADDRESS
stellar keys generate --global fee-sponsor    # FEE_SPONSOR_SECRET_KEY
stellar keys generate --global demo-user      # DEMO_USER_SECRET_KEY / DEMO_USER_ADDRESS
# Fund each via https://laboratory.stellar.org/#account-creator (Friendbot)
```

### Contract IDs
- `ZK_CONTRACT_ID` — the already-deployed ZkCreditsContract (confirm in M3.1)
- `USDC_CONTRACT_ID` — testnet USDC SAC (Circle-issued on testnet)

### Generated secrets
```bash
openssl rand -base64 33   # AUTH_SECRET / NEXTAUTH_SECRET
```
## Deployment Pipeline

### Build Process

All six packages are built and tested in CI (`.github/workflows/ci.yml`, M3.5 DONE). The Dockerfiles handle production builds:

- **Gateway:** `ts/Dockerfile` — Node 24 Alpine, builds `@zk-credits/shared` then copies `ts/`
- **Fee-sponsor:** `services/fee-sponsor/Dockerfile` — also copies `ts/` sources (imports via `@gateway/*`)
- **Web:** Vercel auto-detects Next.js; `web/vercel.json` lists env vars; `prebuild` script builds the shared package

### CI/CD Pipeline

- **CI** (`.github/workflows/ci.yml`) — 6 jobs on push/PR, all green (run 31026106925)
- **Deploy smoke** (`.github/workflows/deploy-smoke.yml`) — post-deploy health checks; activates once secrets exist

## Deployment Steps (M3)

### 3.1 — Confirm ZkCreditsContract on Soroban testnet

Live testnet deployment (verified 2026-08-11):

- `ZK_CONTRACT_ID=CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT`
- deployment transaction: `36c9afaa74652afc75f3480f9765af685c6bd528853718363a74bdfc5e5de18b`
- dedicated statement-key transaction: `8827579d85248854281ec9ffc769a4c0170a438351981281f269bd7934c7ed92` (ledger `4081560`)
- post-deploy reads: `get_deposit_count = 0`, `get_current_root = 0`; a second key-installation simulation returns `AlreadyInitialized`, preserving the installed statement keys.

Configure this exact `ZK_CONTRACT_ID` in both Render services before pointing hosted traffic at the contract.

Render API deployment verification (2026-08-11): the gateway and fee-sponsor
were updated with this ID and redeployed as `dep-d9tcin2d0e5s738rki1g` and
`dep-d9tcitbncjis738va740`, respectively. Both deployments reached `live`;
the public gateway status endpoint then returned this contract ID with
`depositCount: 0` and `currentRoot: 0`, and both `/health` endpoints returned
HTTP 200.

```bash
# Confirm the deployed contract is reachable
stellar contract invoke \
  --id CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT \
  --source gateway \
  --network testnet \
  -- get_deposit_count
```

Historical verification on 2026-08-09 through the Fly gateway: `GET https://zk-credits-gateway.fly.dev/v1/contract-status` returned HTTP 200 with `depositCount: 3`, a current root, the deployed contract ID, and `network: stellar:testnet`. Re-run this check against Render after deployment.

### 3.2 — Deploy gateway to Render

```bash
# Render Dashboard: New → Blueprint → select feature-stellar-launch → Apply.
# render.yaml creates the gateway, fee-sponsor, and shared Postgres database.
# Fill the sync:false prompts, then verify:
curl https://zk-credits-gateway.onrender.com/health
curl https://zk-credits-gateway.onrender.com/v1/contract-status
```

### 3.3 — Deploy web to Vercel

```bash
cd web
vercel link    # link to Vercel project
vercel env add AUTH_SECRET
vercel env add GITHUB_CLIENT_ID
vercel env add GITHUB_CLIENT_SECRET
vercel env add STRIPE_SECRET_KEY
vercel env add STRIPE_WEBHOOK_SECRET
vercel env add GATEWAY_URL     # https://zk-credits-gateway.onrender.com
vercel env add GATEWAY_SECRET
vercel env add NEXT_PUBLIC_GATEWAY_URL  # https://zk-credits-gateway.onrender.com

vercel --prod
```

### 3.4 — Deploy fee-sponsor to Render

```bash
# Created by the Render Blueprint alongside the gateway.
curl https://zk-credits-fee-sponsor.onrender.com/health
```

### Post-deploy validation (M4)

1. **4.1 Hosted E2E demo** — sign in → buy $5 credits → Claude call via ZK proof
2. **4.2 Hosted slash demo** — rate-limit violation → reporter submits slash proof (fee-sponsored)
3. **4.3 Hosted withdraw demo** — user withdraws via gateway co-sign + fee-sponsor bump
4. **4.4 Restart durability** — restart the Render gateway mid-session; accepted calls survive
5. **4.5 README honest caveats** — custodial model, testnet-only, single-contributor setup
6. **4.6 OpenRouter tier check** — confirm per-key limits sufficient for public load

## Database Migrations

Migrations run automatically on gateway startup (`ts/db/migrations/`). No manual migration steps needed. Schemas created: `billing`, `gateway`, `fee-sponsor`.

For local dev: `docker compose up -d postgres` then run the gateway (it auto-migrates).

## Secrets Management

| Platform | How secrets are set | Rotation |
|---|---|---|
| Render | Dashboard → Environment → add/update secret | Update the secret in the service environment |
| Vercel | Dashboard → Settings → Environment Variables | Overwrite in dashboard |
| GitHub Actions | Repository Settings → Secrets | Overwrite in settings |

**Separation:** gateway and fee-sponsor run as separate Render services with separate secret sets. The fee-sponsor's XLM key is never exposed to the gateway.

## Rollback Plan

- **Render:** deploy a previous Git commit from the service's deploy history
- **Vercel:** Dashboard → Deployments → select previous deployment → "Promote to Production"
- **Contract:** immutable (Soroban); a redeploy requires a new contract ID

Rollback triggers: health check failure ≥3 consecutive intervals, E2E smoke failure, or manual decision.

## Render source-revision reconciliation (2026-08-11)

- The Render gateway service tracks the `feature-stellar-launch` branch and its latest live deployment is `dep-d9tcin2d0e5s738rki1g` at committed revision `42ef3d1`.
- That revision still expects the legacy five-signal epoch proof, whereas the configured live contract and current source use the four-signal indexed-ticket statement. A locally self-verified current proof reached the gateway and was correctly diagnosed as rejected by the legacy parser (`Expected 5 public signals, got 4`).
- The source and current artifacts must be committed and pushed to that branch, then the Render API can create a new deployment. Do not treat a configuration-only redeploy of `42ef3d1` as an indexed-ticket launch deployment.

## Indexed-ticket production rollout (2026-08-11)

- `dd38685` (`feat(stellar): launch indexed-ticket credit flow`) was pushed to the Render-tracked branch. Auto-deployments `dep-d9td31uq1p3s73ang7q0` (gateway) and `dep-d9td31uq1p3s73ang7kg` (fee sponsor) reached `live`.
- Live fee-relay validation discovered inner slash/withdraw transactions need Soroban preparation before signing. `90caf21` (`fix(stellar): prepare fee-relayed transactions`) was pushed and deployments `dep-d9td9dc9v7es73bruc8g` (gateway) and `dep-d9td9dc9v7es73brucj0` (fee sponsor) reached `live`.
- The gateway was intentionally restarted through the Render API as `dep-d9tdhsjncjis7391ec80` for durable-state validation; it reached `live` and persisted replay/settlement state.
- Vercel production deployment `dpl_C95vNQJhKWoEoYwGsrcdvLBKFuk3` is Ready at `https://feature-zk-api-credits-qilcxlv6s-gadillacers-projects.vercel.app` (canonical alias: `https://feature-zk-api-credits-gadillacers-projects.vercel.app`). Its encrypted production environment includes gateway, Stripe, and auth values. Preview deployments deliberately do not have those values and visibly disable payment/gateway actions.

## M5.4 Render bootstrap preflight (2026-08-11)

- Replayed the live contract history to recover the exact seven-leaf snapshot
  for the on-chain root
  `34251567430187239947604452370786103718161372975737694109261755611773824646686`.
- Configured the snapshot in the Render gateway's one-time
  `MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT` environment variable.
- The source revision, PostgreSQL migration, hosted health/root checks, and
  funded sidecar request remain pending until the redeploy completes.
