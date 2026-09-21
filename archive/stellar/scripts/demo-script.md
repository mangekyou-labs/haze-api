# zk-api-credits Demo Script (5 minutes)

> Live demo for hackathon/judge presentation. Demonstrates the full ZK-RLN privacy gateway flow.

## Prerequisites

- Gateway running on `localhost:3001`
- Web app running on `localhost:3000`
- Stellar testnet contract deployed (see `.env` for `ZK_CONTRACT_ID`)
- OpenRouter API key configured (or mock adapter for offline demo)

## Demo Flow

### 1. Sign In (30s)

**Show:** Landing page at `http://localhost:3000`

1. Click "Sign in with GitHub"
2. Authorize the app
3. Redirect to dashboard (shows empty state)

**Say:** "This is a privacy gateway for coding agents. Developers buy anonymous API credits — the gateway can't link your calls to your payment."

### 2. Onboarding — Generate Identity Key (45s)

**Show:** `/onboarding` page

1. Click "Generate Key"
2. Show the24-word recovery phrase
3. Write down3 random words to confirm
4. Click "Confirm & Continue"

**Say:** "Your browser generates a secret key that never leaves this device. The24-word phrase is your backup — lose it and your credits are gone."

### 3. Buy Credits (30s)

**Show:** Dashboard → Buy Credits section

1. Click "Buy Now" on the $5 tier
2. Redirect to Stripe Checkout (test mode)
3. Enter test card: `4242 4242 4242 4242`, any future date, any CVC
4. Complete payment
5. Redirect back to dashboard

**Say:** "Stripe handles the payment. We never see your card details. The gateway gets a webhook and mints USDC on-chain."

### 4. Generate API Key (20s)

**Show:** Dashboard → API Key section

1. Click "Generate API Key"
2. Show the `sk-zk-...` key
3. Copy the setup snippet

**Say:** "One API key, one base URL. Works with Claude Code, Codex, OpenCode, Cline — any agent that speaks OpenAI protocol."

### 5. Call the Gateway (45s)

**Show:** Terminal

```bash
# Set env vars (from dashboard)
export OPENAI_BASE_URL=http://localhost:3001/v1
export OPENAI_API_KEY=sk-zk-...

# Call via any agent
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-ZK-Proof: <proof>" \
  -d '{"model":"anthropic/claude-opus-4","messages":[{"role":"user","content":"Write a haiku about zero knowledge proofs"}]}'
```

**Or run the E2E script:**
```bash
node scripts/e2e-test.js
```

**Say:** "The browser generates a ZK proof that says 'I have a deposit' without revealing which deposit. The gateway verifies the proof and forwards to OpenRouter. It can't link this call to your payment."

### 6. Show Dashboard (20s)

**Show:** Dashboard with updated stats

1. Refresh dashboard
2. Show calls today, remaining quota, active keys

**Say:** "The dashboard reads from the gateway. Calls are counted per-epoch — 100 per day for the demo tier."

### 7. Trigger Over-Quota Slash (45s)

**Show:** Terminal

```bash
node scripts/slash-demo.js
```

**The script:**
1. Generates two proofs with the same epoch (same nullifier)
2. First call succeeds
3. Second call is rejected (403 nullifier_spent)
4. Extracts secret_k from the two shares via slash circuit
5. Shows the extracted key matches the original

**Say:** "When you exceed your quota, the second proof reuses the same nullifier. The RLN math extracts your secret key from the two shares. Anyone can submit this proof on-chain to slash the deposit — 50% goes to the reporter, 50% to the protocol."

### 8. Show Contract on Stellar Explorer (15s)

**Show:** Browser

1. Open `https://stellar.expert/explorer/testnet/contract/CCJG427D5B2KCLQC4GNSUXLZU7T3455T763EEIX44DNLCUMLXYKGEE4R`
2. Show the deposit event, nullifier events

**Say:** "Everything is on-chain — deposits, nullifiers, slashes. The contract uses Stellar's native BLS12-381 for Groth16 verification."

## Key Talking Points

1. **Privacy:** Gateway can't link calls to deposits (ZK enforced)
2. **Slash:** Over-quota double-spend reveals secret key (RLN math)
3. **Web2 onboarding:** GitHub + Stripe, no crypto wallet needed for v1
4. **Agent compatible:** Works with any OpenAI-compatible agent via env vars
5. **API-agnostic:** Same pattern works for financial/data APIs (see roadmap)

## Honest Caveats

1. **Custodial v1:** Gateway holds USDC, user holds secret_k
2. **Testnet only:** No real money in v1
3. **Single gateway:** Cross-gateway unlinkability is v2
4. **Browser proving:** ~1.5s first call, cached after
5. **Network identity:** v1 hides payment, not IP
6. **Trusted setup:** Single-contributor dev setup for MVP

## Troubleshooting

- **Gateway not starting:** Check `GATEWAY_SECRET` in `.env`
- **Proof verification fails:** Ensure `circuits/verification_key_rln.json` exists
- **Contract calls fail:** Check `ZK_CONTRACT_ID` and Stellar testnet RPC
- **Stripe webhook not received:** Use `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
