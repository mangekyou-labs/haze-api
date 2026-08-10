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

Current deployment evidence (2026-08-10): the Fly trial ended and both public Fly services are suspended/resetting. The Render Blueprint is now checked into this worktree as `render.yaml`; both Docker images build successfully locally. Render service creation still requires the branch to be pushed/connected to a Render account. The Vercel project `feature-zk-api-credits` is linked and its local `vercel build --yes` is green. Render free web services sleep after inactivity and free Postgres is suitable only for disposable testnet/demo data.

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

```bash
# Confirm the already-deployed contract VKs match the committed verification keys
stellar contract invoke \
  --id $ZK_CONTRACT_ID \
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
