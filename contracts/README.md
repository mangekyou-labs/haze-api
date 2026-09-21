# Base private-credit bond

`PrivateCreditBond` is the immutable, non-upgradeable Base Sepolia escrow
registry for the invite-only, unpaid, experimental pilot. It holds only the
refundable USDC bond funded by the pilot sponsor; participants never deposit
funds. It does not know GitHub accounts, card or bank details, prompts,
responses, or secrets. The circuit that authorizes spends is experimental and
not independently audited.

The active deployment target is Base Sepolia (`eip155:84532`). The contract
uses a depth-20 Poseidon Merkle tree, an on-chain validity period, a seven-day
challenge window, and a single funded tier defined in
`src/PrivateCreditBond.sol`: tier 0 with an in-circuit allowance of 250 credits
and a sponsor-funded refundable bond. Slashed bonds are split 50/50 between the
reporter and the immutable treasury. A funded credential stays `Active` until
it is either `Released` or `Slashed`, and never both.

## Local verification

Foundry dependencies are pinned by `foundry.lock`. On this macOS workstation
use the offline flag when Foundry attempts network discovery:

```sh
FOUNDRY_OFFLINE=true forge test
FOUNDRY_OFFLINE=true forge build
```

The focused tests cover funding, root history, maturity, terminal states,
secret recovery, nullifier replay, and 50/50 slashing. The generated Groth16
verifier and Poseidon library addresses must be supplied by the release
process; unit tests use deterministic mocks.

## Base Sepolia deployment

Deploy Poseidon T2/T3/T4 and the generated spend verifier first. Then set the
following environment variables without committing them:

```sh
export BASE_RPC_URL=...
export BASE_USDC=...
export BASE_SPONSOR=...
export BASE_REFUND_VAULT=...
export BASE_TREASURY=...
export POSEIDON_T2=...
export POSEIDON_T3=...
export POSEIDON_T4=...
export SPEND_VERIFIER=...
export BASE_DEPLOYMENT_DOMAIN=0x...
forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url "$BASE_RPC_URL" --broadcast --verify
```

The script intentionally does not choose keys, tokens, verifier artifacts, or
addresses. Mainnet requires an external audit, production proving ceremony,
protected sponsor/treasury keys, and recovery drills before any broadcast.

The former Stellar contract remains under `archive/stellar/` for historical
reference and is not part of the Foundry source or test set.

## License

AGPL-3.0-or-later. See the repository `LICENSE` file.
