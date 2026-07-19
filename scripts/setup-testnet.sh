#!/bin/bash
set -euo pipefail

echo "=== M1: Testnet Setup ==="

GATEWAY=$(stellar keys address payroll-admin)
DEMO_USER=$(stellar keys address demo-user)
USDC_ISSUER=$(stellar keys address usdc-issuer)
USDC_CONTRACT=$(stellar contract id asset --asset "USDC:${USDC_ISSUER}" --network testnet)

echo "Gateway:       $GATEWAY"
echo "Demo User:     $DEMO_USER"
echo "USDC Issuer:   $USDC_ISSUER"
echo "USDC Contract: $USDC_CONTRACT"

# Add USDC trustline to gateway
echo "→ Adding USDC trustline to gateway..."
stellar tx new --source payroll-admin --network testnet \
  | stellar tx op add change-trust --asset "USDC:${USDC_ISSUER}" --limit 1000000 \
  | stellar tx sign --source payroll-admin --network testnet \
  | stellar tx send --network testnet 2>&1 || echo "(trustline may already exist)"

# Add USDC trustline to demo user
echo "→ Adding USDC trustline to demo user..."
stellar tx new --source demo-user --network testnet \
  | stellar tx op add change-trust --asset "USDC:${USDC_ISSUER}" --limit 1000000 \
  | stellar tx sign --source demo-user --network testnet \
  | stellar tx send --network testnet 2>&1 || echo "(trustline may already exist)"

# Fund gateway with USDC from issuer
echo "→ Funding gateway with 10000 USDC..."
stellar tx new --source usdc-issuer --network testnet \
  | stellar tx op add payment --destination "$GATEWAY" --asset "USDC:${USDC_ISSUER}" --amount 10000 \
  | stellar tx sign --source usdc-issuer --network testnet \
  | stellar tx send --network testnet 2>&1 || echo "(payment may have already been made)"

# Fund demo user with USDC from issuer
echo "→ Funding demo user with 500 USDC..."
stellar tx new --source usdc-issuer --network testnet \
  | stellar tx op add payment --destination "$DEMO_USER" --asset "USDC:${USDC_ISSUER}" --amount 500 \
  | stellar tx sign --source usdc-issuer --network testnet \
  | stellar tx send --network testnet 2>&1 || echo "(payment may have already been made)"

echo ""
echo "=== Verification ==="
echo "Gateway USDC balance:"
stellar contract invoke --id "$USDC_CONTRACT" --source payroll-admin --network testnet -- balance --id "$GATEWAY" 2>&1 || echo "(check manually)"
echo "Demo user USDC balance:"
stellar contract invoke --id "$USDC_CONTRACT" --source demo-user --network testnet -- balance --id "$DEMO_USER" 2>&1 || echo "(check manually)"

echo ""
echo "=== M1 Complete ==="
echo "USDC_CONTRACT_ID=$USDC_CONTRACT"
echo "GATEWAY=$GATEWAY"
echo "DEMO_USER=$DEMO_USER"
