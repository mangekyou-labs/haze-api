# Base private-credit bond

`PrivateCreditBond` is the immutable, non-upgradeable Base Sepolia escrow
registry for the invite-only experimental pilot, whose product calls use
founder-provisioned test credits. It holds only the
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

The checkpointed launcher owns the Base Sepolia deployment boundary. The
wizard collects these values in a gitignored mode-0600 file; it does not ask
for a bond address or deployment block because those are outputs:

```sh
# Run from the repository root. The wizard prompts for the values below.
scripts/launch-wizard.sh
scripts/launch-pilot.sh --check
```

The development v2 launcher is available through:

```sh
scripts/launch-pilot.sh --deploy-v2
```

It requires `BASE_RPC_URL`, decimal
`BASE_DEPLOYMENT_DOMAIN=84532`, Circle's Base Sepolia USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`,
`BASE_DEPLOYER_KEYSTORE_ACCOUNT`, an absolute regular non-symlinked
`BASE_DEPLOYER_PASSWORD_FILE` with mode `0600`,
`BASE_SPONSOR_PRIVATE_KEY`, `BASE_TREASURY_ADDRESS`, `BASE_REFUND_VAULT`, and
optionally `BASESCAN_API_KEY`. The launcher derives `BASE_SPONSOR_ADDRESS`,
checks the existing v1 verifier and adapter remain available, and deploys a
new v2 verifier and adapter for the replacement bond. The original v1
contracts and bond remain intact.

After a no-broadcast simulation, it predicts and displays all six v2 CREATE
addresses and asks for fresh authorization before showing the operator a
dotenv-wrapped, keystore-backed `forge script ... --broadcast` command. The
launcher never handles or prints the password and never executes that command.
Resume only after the operator runs it; `run-latest.json` is reconciled against
signer, nonce, order, predicted address, receipts, and bytecode before the
bond's nine immutables, v2 adapter-to-verifier link, and initial root are
checked. Deployment outputs are written atomically only after that succeeds;
explorer verification is a separate retryable step. The older
`DeployBaseSepolia.s.sol` script documents the original v1 four-CREATE
sequence and is not used by `--deploy-v2`.

Mainnet requires an external audit, production proving ceremony, protected
sponsor/treasury keys, and recovery drills before any broadcast.

The former Stellar contract remains under `archive/stellar/` for historical
reference and is not part of the Foundry source or test set.

## License

AGPL-3.0-or-later. See the repository `LICENSE` file.
