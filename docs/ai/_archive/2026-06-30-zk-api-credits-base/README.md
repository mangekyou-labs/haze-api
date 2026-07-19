# Archive: zk-api-credits (Base + EVM design)

**Status:** Superseded on 2026-07-06 by the Stellar pivot.
**Reason:** Canton had no native ZK verification; Stellar offers BLS12-381 Groth16
verification live today (CAP-0059, Protocol 22+). The original Base + Solidity +
Circom/RLN design was archived and a new design was written targeting Stellar
testnet with on-chain ZK-RLN verification, OpenRouter as the upstream LLM
provider, and a web2-friendly custodial gateway for developer onboarding.

## Contents

These files were the original ai-devkit feature docs scoped to Base + EVM.
They are preserved here for history. Filenames are prefixed with the phase
to avoid collision (all originals shared the same basename).

- `requirements-2026-06-30-feature-zk-api-credits.md` — original problem statement, goals, user stories (Base, ERC-8004, Risc0)
- `design-2026-06-30-feature-zk-api-credits.md` — original architecture (Solidity DepositContract, EIP-191 sessions, Circom/Risc0 STARKs)
- `planning-2026-06-30-feature-zk-api-credits.md` — blank template
- `implementation-2026-06-30-feature-zk-api-credits.md` — blank template
- `testing-2026-06-30-feature-zk-api-credits.md` — blank template
- `deployment-2026-06-30-feature-zk-api-credits.md` — blank template
- `monitoring-2026-06-30-feature-zk-api-credits.md` — blank template

## What changed in the pivot

| Dimension | Original (Base) | New (Stellar) |
|---|---|---|
| Chain | Base (Ethereum L2) | Stellar testnet |
| Contract language | Solidity 0.8.x + OpenZeppelin v5 | Rust + soroban-sdk |
| ZK verification | Risc0 STARK (offchain) or Circom BN254 (not native) | Circom Groth16 over BLS12-381, on-chain via CAP-0059 |
| Buyer | Institution running agent swarms | Individual developer using coding agents |
| Upstream | Mock AI API provider | OpenRouter (400+ models, 70+ providers) |
| Onboarding | Wallet-based (MetaMask/Safe) | Web2 (GitHub OAuth + Stripe), custodial |
| Rate limit scope | Multi-agent unlinkability | Per-epoch RLN, individual developer quota |
| Slashing | First submitter takes deposit | 50% treasury + 50% reporter |

The new design lives at `docs/ai/{requirements,design}/2026-07-06-feature-zk-api-credits.md`.
