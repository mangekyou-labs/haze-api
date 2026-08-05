---
phase: deployment
title: Deployment Strategy
description: Define deployment process, infrastructure, and release procedures
---

# Deployment Strategy

## Infrastructure
**Where will the application run?**

- Hosting platform (AWS, GCP, Azure, etc.)
- Infrastructure components (servers, databases, etc.)
- Environment separation (dev, staging, production)

## Deployment Pipeline
**How do we deploy changes?**

### Build Process
- Build steps and commands per package (all `npm ci` + `tsc --noEmit` type gate or `cargo test`):
  - Gateway `ts/`: `npm ci && npm run typecheck && npm test`
  - Shared `packages/zk-credits-shared`: `npm ci && npm run build && npm test`
  - Fee-sponsor `services/fee-sponsor`: `npm ci && npm run typecheck`
  - Web `web/`: `npm ci && npm run typecheck && npm test` (+ `next build`, validated by the Playwright webServer)
  - Circuits `circuits/`: `npm ci && node scripts/test.js` (artifacts committed)
  - Soroban contract `zk-credits-contract`: `cargo test` (Rust ≥1.85; CI pins 1.94.0)
- Circuit release artifacts (`.wasm`/`*_final.zkey` in `circuits/` + `web/public/circuits/`) are tracked so fresh checkouts (CI, Vercel) have the browser proof path.
- Environment configuration: `.env.example` documents all vars; missing testnet config fails closed.

### CI/CD Pipeline
- **CI (`.github/workflows/ci.yml`)** — runs on `push` (feature-stellar-launch/main) + `pull_request`, 6 jobs (gateway, shared, fee-sponsor, web, circuits, contract), concurrency cancel-in-progress; uploads `gateway-coverage` + `playwright-report` (on failure) artifacts. Node 24, `npm ci` everywhere.
- **Deploy smoke (`.github/workflows/deploy-smoke.yml`)** — post-deploy health smoke (gateway `/health`, fee-relay `/health`, web landing, `/api/dashboard/status`); template until `GATEWAY_URL`/`WEB_URL`/`FEE_SPONSOR_URL` secrets exist. The full hosted E2E (`scripts/e2e-test.js`, `scripts/slash-demo.js`) is the M4.1/4.2/4.3 launch gate, run from a credentialed runner.
- Deployment automation (Fly.io/Vercel) is added in M3.2/3.3/3.4 once the target accounts/secrets exist.

## Environment Configuration
**What settings differ per environment?**

### Development
- Configuration details
- Local setup

### Staging
- Configuration details
- Testing environment

### Production
- Configuration details
- Monitoring setup

## Deployment Steps
**What's the release process?**

1. Pre-deployment checklist
2. Deployment execution steps
3. Post-deployment validation
4. Rollback procedure (if needed)

## Database Migrations
**How do we handle schema changes?**

- Migration strategy
- Backup procedures
- Rollback approach

## Secrets Management
**How do we handle sensitive data?**

- Environment variables
- Secret storage solution
- Key rotation strategy

## Rollback Plan
**What if something goes wrong?**

- Rollback triggers
- Rollback steps
- Communication plan

