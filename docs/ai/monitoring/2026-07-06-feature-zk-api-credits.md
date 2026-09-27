---
phase: monitoring
title: Monitoring & Observability — zk-api-credits
description: Monitoring strategy, metrics, alerts, and incident response for the ZK-RLN privacy gateway
---

# Monitoring & Observability

> **M6 reconciliation (2026-09-11):** Earlier sections describe the original
> console/error-page baseline. Level 4 adds Sentry configuration with a strict
> scrubber, opt-in PostHog events, and a scheduled/manual synthetic monitor;
> live alert screenshots and a green production run remain release evidence.

## Key Metrics

### Performance Metrics

| Metric | Target | Source |
|---|---|---|
| Gateway latency (cached proof) | <500ms overhead | Gateway logs |
| Gateway latency (first proof) | <6s (incl. browser proving) | Gateway logs |
| On-chain verification | ~300k gas, ~5s ledger | Soroban RPC |
| OpenRouter response time | Model-dependent | Gateway logs |

### Business Metrics

| Metric | Description |
|---|---|
| Active users | Unique commitments with >0 calls this epoch |
| Calls per epoch | Total calls across all users |
| Credits purchased | Stripe checkout completions |
| Slash events | On-chain Slashed events |
| API keys generated | POST /v1/api-keys count |

### Error Metrics

| Metric | Threshold |
|---|---|
| Proof verification failures | >5% of requests |
| Nullifier replay rejections | Expected (over-quota) |
| OpenRouter 4xx/5xx | <1% |
| Gateway500s | <0.1% |

## Monitoring Tools

### MVP baseline (historical)

- **Gateway:** Console logs (stdout)
- **Web App:** Next.js error pages
- **Contract:** Stellar Explorer (testnet)
- **Circuit proofs:** snarkjs CLI verification

### Level 4 implementation

- **APM:** Sentry on web, gateway, and fee sponsor; `sendDefaultPii`, replay,
  local-variable capture, and sensitive request data are disabled/scrubbed.
- **Product analytics:** PostHog starts opted out; only coarse lifecycle,
  duration, breakpoint, release, status, outcome, and fixed survey fields are
  allow-listed after explicit consent.
- **Synthetic uptime:** `.github/workflows/synthetic-level4.yml` runs on a
  schedule and manually, checking frontend, gateway health, contract status,
  and the configured fee-sponsor health endpoint with a 90-second timeout and
  bounded retries.
- **Free Render behavior:** cold starts are surfaced as “waking service” UI
  states with retry controls; no uptime SLA is claimed.

## Logging Strategy

### Gateway Logs

```
[INFO] POST /v1/chat/completions — 200 — 342ms — commitment=0xabc...
[INFO] Proof verification: valid — nullifier=0xdef...
[WARN] Nullifier replay rejected — nullifier=0xdef...
[ERROR] OpenRouter error: 429 — rate limited
```

### Log Levels

- **ERROR:** OpenRouter failures, proof verification crashes, contract RPC errors
- **WARN:** Nullifier replays, quota exceeded, missing VK (should not happen)
- **INFO:** Successful requests, API key creation, deposit events
- **DEBUG:** Proof details, public signals (disable in production)

### Sensitive Data Handling

- **Never log or send to analytics:** prompts, request bodies, `secret_k`, API
  keys, Stripe secrets, mnemonics, proofs, signatures, full wallet addresses,
  GitHub identity, cookies, authorization data, or commitments.
- **OK to aggregate:** coarse status, duration, release, breakpoint, and fixed
  feedback fields after explicit opt-in.
- **Redact:** User email (first3 chars + `***`)

## Alerts & Notifications

### Critical Alerts

| Alert | Condition | Action |
|---|---|---|
| Gateway down | Health check fails3x | Restart, investigate |
| Contract unreachable | RPC simulation fails | Check Stellar network |
| Proof verification crash | Unhandled exception in verifyZkProof | Deploy fix, restart |

### Warning Alerts

| Alert | Condition | Action |
|---|---|---|
| High error rate | >5% of requests return4xx/5xx | Investigate |
| OpenRouter rate limited | 429 responses | Check API key tier |
| Low credits | Gateway USDC balance <10 | Top up |

## Dashboards

### MVP Dashboard (Web App)

The `/dashboard` route shows per-user:
- Calls today / epoch quota
- Remaining calls
- Active API keys
- Balance (on-chain, via contract read)
- Slash status

### Admin Dashboard (Future)

- Total users / active users
- Calls per minute
- Revenue (Stripe)
- Error rates
- Contract gas usage

## Incident Response

### Severity Levels

- **P0:** Gateway down, proofs not verifying, funds at risk
- **P1:** High error rate, slow responses, OpenRouter down
- **P2:** Dashboard not updating, minor UI issues
- **P3:** Cosmetic issues, documentation gaps

### Response Process

1. **Detection:** Health check alert or user report
2. **Triage:** Identify severity, impact scope
3. **Mitigation:** Restart gateway, switch to mock adapter, disable affected endpoint
4. **Root cause:** Check logs, contract state, external dependencies
5. **Fix:** Deploy fix, verify, close incident
6. **Post-mortem:** Document cause, prevention, action items

## Health Checks

### Gateway

```bash
curl http://localhost:3001/health
# Expected: {"status":"ok","version":"0.1.0","network":"stellar:testnet","proofVerification":"enabled"}
```

### Contract

```bash
curl http://localhost:3001/v1/contract-status
# Expected: {"contractId":"CBWNJ...","depositCount":N,"currentRoot":"...","network":"stellar:testnet"}
```

### Web App

```bash
curl -s http://localhost:3000 | head -5
# Expected: HTML response (landing page)
```

### Synthetic monitor

```bash
FRONTEND_URL=https://<web> \
GATEWAY_URL=https://<gateway> \
FEE_SPONSOR_URL=https://<fee-sponsor> \
REQUIRE_FEE_SPONSOR=true \
node scripts/synthetic-monitor.mjs
```

The command emits endpoint labels, status, duration, and retry outcome only;
it never prints credentials or response bodies.
