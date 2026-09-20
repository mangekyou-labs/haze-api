# zk-credits

Private prepaid API credits for OpenAI-compatible clients. Stripe is the only
customer payment rail in v1. The platform sponsor supplies Base USDC and gas;
customers do not need a wallet, ETH, or USDC to purchase or use a bundle.

The initial network is Base Sepolia (`eip155:84532`). Each bundle has a fixed
30-day validity period and a seven-day challenge window:

| Bundle | Service fee | Refundable bond | Private requests |
| --- | ---: | ---: | ---: |
| Starter | $5 | $5 | 5,000 |
| Builder | $20 | $20 | 25,000 |
| Scale | $50 | $50 | 75,000 |

The browser creates the secret and Poseidon commitment locally. An encrypted
credential export is required before Stripe Checkout. The secret is never sent
to Stripe, GitHub, the gateway, or the spend-plane database. GitHub OAuth is
the account system; optional SIWE wallet linking proves an additional identity
but is not required for purchase or API calls.

## Run the local services

```sh
cd ts && npm ci && npm run typecheck && cd ..
cd web && npm ci && npm run typecheck && cd ..
cd packages/x402-zk-prepaid && npm ci && npm test -- --run && cd ../..
cd packages/zk-credits-sidecar && npm ci && npm test -- --run && cd ../..
```

The gateway needs `OPENROUTER_API_KEY` and a configured Base contract/verifying
key in a real environment. Its local fallback claim store is for development;
production runs use the isolated `spend_plane.claims` Postgres table.

## Local credential proxy

The sidecar reads an encrypted browser export and generates the BN254 Groth16
proof locally. It then follows x402 v2 over the gateway:

```sh
export ZK_CREDITS_CREDENTIAL_PATH=/path/to/credential.zkcred
export ZK_CREDITS_CREDENTIAL_PASSWORD='use-a-local-secret'
export ZK_CREDITS_ARTIFACT_DIR=/path/to/pinned-bundle
export ZK_CREDITS_WITNESS_PATH=/path/to/witness.json
zk-credits serve --gateway http://127.0.0.1:3001 --port 3210
```

`ZK_CREDITS_ARTIFACT_DIR` holds the frozen proving bundle whose SHA-256
digests are pinned in `packages/zk-credits-sidecar/circuits/manifest.json`.
The bytes are installed out of band; a missing, relocated, or altered
artifact fails closed before any prove.

`POST /v1/chat/completions` is protected by the experimental custom x402
scheme `zk-prepaid`. A missing or stale `PAYMENT-SIGNATURE` receives a 402
with base64 `PAYMENT-REQUIRED`; the sidecar retries with a proof-bound
signature. Settlement is a durable escrow claim, not a per-request chain
transaction, so `PAYMENT-RESPONSE.transaction` is intentionally empty.

The reusable implementation is in
`packages/x402-zk-prepaid/`. It is not automatically supported by generic x402
clients: integrations must register this custom scheme and use the published
requirements/payload format. See
`docs/ai/design/2026-09-18-feature-base-zk-credits.md` for the protocol
boundary and security model.

## Contract and circuits

The immutable `PrivateCreditBond` contract is under `contracts/src/` and the
BN254 circuit is `circuits/private_credit_spend.circom`. No deployment is
performed by tests. Use the Base Sepolia deployment script only after setting
the reviewed USDC, sponsor, refund vault, treasury, Poseidon, verifier, and
deployment-domain addresses:

```sh
cd contracts
FOUNDRY_OFFLINE=true forge test
forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url "$BASE_RPC_URL" --broadcast --verify
```

Mainnet is blocked until an external contract/circuit audit, production
Groth16 ceremony, legal and Stripe-risk review, protected keys, monitoring,
and recovery drills are complete.

## Privacy and product boundaries

- The dashboard shows bundle allowance, expiry, bond/refund state, and chain
  links; it does not show remaining-call counts or usage history.
- The gateway does not log prompts, responses, secrets, proofs, or linkable
  spend metadata. Encrypted response replays are bounded to 24 hours and 10 MiB.
- Chargebacks block future purchases but do not revoke an already-active
  private credential. A successful cryptographic slash prevents the Stripe bond
  refund.
- Stripe webhooks, sponsorship, maturity release, contract events, refunds,
  disputes, and reconciliation require durable idempotent workers in production.

The former Stellar/Soroban implementation is retained under `archive/stellar/`
and historical documentation only. It is not part of the active runtime.

## License

AGPL-3.0-or-later. See `LICENSE`.
