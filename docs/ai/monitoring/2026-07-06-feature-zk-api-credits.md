---
phase: monitoring
title: Monitoring & Observability — zk-api-credits
description: Monitoring strategy, metrics, alerts, and incident response for the ZK-RLN privacy gateway
---

# Monitoring & Observability

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

### MVP (Current)

- **Gateway:** Console logs (stdout)
- **Web App:** Next.js error pages
- **Contract:** Stellar Explorer (testnet)
- **Circuit proofs:** snarkjs CLI verification

### Production (Future)

- **APM:** Sentry or Datadog
- **Metrics:** Prometheus + Grafana
- **Logs:** Structured JSON → ELK or Loki
- **Uptime:** BetterUptime or Pingdom

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

- **Never log:** `secret_k`, API keys, Stripe secrets
- **OK to log:** Commitments, nullifiers, proof hashes, request metadata
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
