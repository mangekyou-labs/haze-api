#!/bin/bash
set -euo pipefail

# Deploy ZkCreditsContract with real VK to Stellar testnet.
# Prerequisites:
#   - stellar CLI installed and configured
#   - Deployer key funded with testnet XLM (via Friendbot)
#   - Contract WASM built: cargo build --release
#   - VK JSON generated: node scripts/vk-convert.js

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CONTRACT_DIR="$ROOT_DIR/zk-credits-contract"
CIRCUITS_DIR="$ROOT_DIR/circuits"

echo "=== Deploy ZkCreditsContract with Real VK ==="

# Check prerequisites
if ! command -v stellar &> /dev/null; then
    echo "ERROR: stellar CLI not found. Install from https://developers.stellar.org/docs/tools/cli"
    exit 1
fi

DEPLOYER_KEY="${DEPLOYER_KEY:-payroll-admin}"
TREASURY_KEY="${TREASURY_KEY:-payroll-admin}"
NETWORK="${NETWORK:-testnet}"

echo "Deployer key: $DEPLOYER_KEY"
echo "Treasury key: $TREASURY_KEY"
echo "Network: $NETWORK"

# 1. Build contract WASM
echo ""
echo "1. Building contract WASM..."
cd "$CONTRACT_DIR"
RUSTUP_TOOLCHAIN=1.94 stellar contract build 2>&1 | tail -3
WASM_PATH="$CONTRACT_DIR/target/wasm32-unknown-unknown/release/zk_credits_contract.wasm"
if [ ! -f "$WASM_PATH" ]; then
    echo "ERROR: WASM not found at $WASM_PATH"
    exit 1
fi
echo "   WASM: $WASM_PATH ($(wc -c < "$WASM_PATH") bytes)"

# 2. Get deployer address
echo ""
echo "2. Getting deployer address..."
DEPLOYER_ADDR=$(stellar keys address "$DEPLOYER_KEY" 2>&1)
echo "   Deployer: $DEPLOYER_ADDR"

# 3. Get USDC contract ID
echo ""
echo "3. Getting USDC contract ID..."
USDC_ISSUER=$(stellar keys address usdc-issuer 2>&1)
USDC_CONTRACT=$(stellar contract id asset --asset "USDC:${USDC_ISSUER}" --network "$NETWORK" 2>&1)
echo "   USDC: $USDC_CONTRACT"

# 4. Get treasury address
TREASURY_ADDR=$(stellar keys address "$TREASURY_KEY" 2>&1)
echo "   Treasury: $TREASURY_ADDR"

# 5. Convert VK to Soroban hex format
echo ""
echo "4. Converting VK to Soroban hex format..."
cd "$ROOT_DIR"
node scripts/vk-convert.js 2>&1

# 6. Read all statement VK hex values for constructor args + admin setup
echo ""
echo "5. Reading statement verification keys..."
for VK_FILE in \
    "$CIRCUITS_DIR/verification_key_rln_soroban.json" \
    "$CIRCUITS_DIR/verification_key_slash_soroban.json" \
    "$CIRCUITS_DIR/verification_key_membership_removal_soroban.json"; do
    if [ ! -f "$VK_FILE" ]; then
        echo "ERROR: VK file not found at $VK_FILE"
        exit 1
    fi
    echo "   VK file: $VK_FILE"
done

# The constructor args are: (admin, treasury, vk, usdc_contract)
# VK is a VerificationKey struct with alpha, beta, gamma, delta, ic
# These need to be passed as Soroban CLI args — complex struct serialization.
# For now, deploy with a script that constructs the args programmatically.
echo ""
echo "NOTE: Deploying with a VerificationKey struct requires Soroban CLI struct args."
echo "      The contract constructor expects:"
echo "        --admin <ADDRESS>"
echo "        --treasury <ADDRESS>"
echo "        --vk <VerificationKey as Soroban struct>"
echo "        --usdc_contract <ADDRESS>"
echo ""
echo "      For automated deployment, use the TypeScript deploy script:"
echo "        node scripts/deploy-contract.js"
echo ""
echo "=== Pre-deployment Checklist ==="
echo "  [ ] Contract WASM built: $WASM_PATH"
echo "  [ ] Spend/slash/membership VKs converted"
echo "  [ ] Deployer funded: $DEPLOYER_ADDR"
echo "  [ ] USDC contract: $USDC_CONTRACT"
echo "  [ ] Treasury: $TREASURY_ADDR"
echo ""
echo "To deploy manually:"
echo "  stellar contract deploy \\"
echo "    --wasm $WASM_PATH \\"
echo "    --source $DEPLOYER_KEY \\"
echo "    --network $NETWORK \\"
echo "    -- \\"
echo "    --admin $DEPLOYER_ADDR \\"
echo "    --treasury $TREASURY_ADDR \\"
echo "    --usdc_contract $USDC_CONTRACT \\"
echo "    --vk <VK_STRUCT>"
