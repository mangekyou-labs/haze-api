---
phase: deployment
title: Deployment Strategy — zk-api-credits
description: Deployment process, infrastructure, and release procedures for the ZK-RLN privacy gateway
---

# Deployment Strategy

> **M6 reconciliation (2026-09-11):** This is the historical M1–M5
> deployment record. Level 4 remains Stellar testnet + Stripe test mode and
> adds an isolated evaluation database, monitoring configuration, and a
> synthetic workflow. See [`docs/ai/deployment/2026-09-11-stellar-launch-level4.md`](../../ai/deployment/2026-09-11-stellar-launch-level4.md)
> for the current runbook; stale package/test counts below are not release evidence.

## Infrastructure

### Components

| Component | Technology | Hosting |
|---|---|---|
| Gateway | Node.js + Express | Local / Fly.io / Railway |
| Web App | Next.js 16 | Vercel / Local |
| Contract | Soroban (Stellar testnet) | Decentralized |
| Circuits | Circom WASM + zkey | Static files (CDN / public/) |
| Evaluation records | PostgreSQL `evaluation` schema | Restricted application database |
| Error monitoring | Sentry (PII/replay disabled and scrubbed) | Vercel, gateway, fee sponsor |

### Environment Separation

- **Development:** localhost (gateway:3001, web:3000)
- **Staging:** Fly.io/Railway (gateway), Vercel (web) — testnet
- **Production:** Same infra, mainnet contract (future)

## Deployment Pipeline

### Build Process

**Gateway:**
```bash
cd ts
npm install
npm run typecheck
npm test
```

**Web App:**
```bash
cd web
npm install
npm run build    # Next.js production build
npm run lint     # ESLint
```

Deploy and inspect the web app with the Vercel CLI:
```bash
cd web
vercel deploy
vercel ls
vercel inspect <deployment-url-or-id>
vercel logs <deployment-url-or-id>
```

**Contract:**
```bash
cd zk-credits-contract
RUSTUP_TOOLCHAIN=1.94 stellar contract build
cargo test       # Current contract test suite; record fresh output
```

**Circuits:**
```bash
cd circuits
circom deposit_membership.circom --r1cs --wasm -p bls12381
circom rln_nullifier.circom --r1cs --wasm -p bls12381
circom slash.circom --r1cs --wasm -p bls12381
node scripts/test.js  # Off-chain prove/verify
```

### CI/CD Pipeline

For MVP (solo dev), manual deployment. Future:

1. Push to `main` → GitHub Actions
2. Run tests (gateway, contract, circuits)
3. Build web app + gateway
4. Deploy gateway to Fly.io/Railway
5. Deploy web app to Vercel
6. Run E2E smoke test

## Environment Configuration

### Development

```env
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
GATEWAY_SECRET=dev-secret
PORT=3001
```

### Testnet deployment

```env
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
GATEWAY_SECRET=<strong-random-secret>
EVALUATION_HMAC_SECRET=<separate-strong-random-secret>
DATABASE_URL=<restricted-postgres-url>
PORT=3001
```

## Secrets Management

| Secret | Where | Rotation |
|---|---|---|
| `GATEWAY_SECRET` | `.env` (both gateway + web) | On compromise |
| `STRIPE_SECRET_KEY` | `.env` (web) | Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | `.env` (web) | Stripe CLI |
| `GITHUB_CLIENT_SECRET` | `.env` (web) | GitHub settings |
| `OPENROUTER_API_KEY` | `.env` (gateway) | OpenRouter dashboard |
| `NEXTAUTH_SECRET` | `.env` (web) | On compromise |
| `EVALUATION_HMAC_SECRET` | Gateway/web runtime secrets | On compromise, with identity migration plan |
| `DATABASE_URL` | Gateway migration/runtime secret | Provider rotation |
| `SENTRY_DSN` | Web/gateway/fee-sponsor runtime | Provider rotation |
| `NEXT_PUBLIC_POSTHOG_KEY` | Web public runtime config | PostHog project rotation |
| Stellar secret keys | `stellar keys` | Hardware wallet for mainnet |

## Deployment Steps

### Pre-deployment Checklist

- [ ] Fresh gateway typecheck/tests and contract tests pass
- [ ] Web app builds clean (`npm run build`)
- [ ] Contract compiled and tested
- [ ] Environment variables configured
- [ ] Circuit files (WASM, zkey) in `web/public/circuits/`
- [ ] Verification key JSON available for gateway
- [ ] Evaluation migration applied and `EVALUATION_HMAC_SECRET` configured
- [ ] PostHog remains opted out until a participant explicitly enables it
- [ ] Sentry test event and synthetic cold/warm checks are green

### Deployment Execution

1. Build gateway: `cd ts && npm run build`
2. Build web: `cd web && npm run build`
3. Deploy contract (if changed): `stellar contract deploy ...`
4. Start gateway: `node dist/server.js`
5. Start web: `npm start`
6. Verify: `curl http://localhost:3001/health`

### Post-deployment Validation

- [ ] Health endpoint returns200
- [ ] Contract status returns deposit count
- [ ] API key generation works
- [ ] Stripe checkout creates session
- [ ] E2E test passes: `node scripts/e2e-test.js`
- [ ] Ten distinct consented participants have valid proofs, unique confirmed deposits, and feedback

### Rollback Procedure

1. Gateway: restart previous version (no state, in-memory cache)
2. Web app: redeploy previous build
3. Contract: immutable on-chain (deploy new version, update env)

## Database Migrations

M6 adds a narrow Postgres persistence boundary. State lives in:
- **On-chain:** Deposits, nullifiers, root history (Soroban contract)
- **In-memory:** API keys, nullifier cache, call counts (gateway restart clears)
- **Browser:** secret_k, commitment (IndexedDB, per-user)
- **Restricted evaluation schema:** consent, raw wallet proof, checkout/deposit
  receipt, feedback, and retention metadata only; no private API/ZK joins.

Apply migrations with `cd ts && npm run db:migrate`. The migration runner is
idempotent and records filenames in `public.schema_migrations`.

## Cost Estimates (Testnet)

| Operation | Gas | USD Equivalent |
|---|---|---|
| Deploy contract | ~200k | ~$0.0001 |
| Deposit | ~150k | ~$0.0003 |
| Spend (proof verify) | ~300k | ~$0.00009 |
| Slash | ~300k | ~$0.00009 |
| Withdraw | ~150k | ~$0.0003 |

For1000 calls/day: ~$0.09/day gas on testnet.
