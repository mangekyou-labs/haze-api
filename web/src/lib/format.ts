// USDC on Stellar uses 6 decimals: 1 dollar = 1_000_000 units.
const USDC_UNITS_PER_DOLLAR = 1_000_000;

/**
 * Format a 6-decimal USDC unit amount (as stored on-chain / in the gateway)
 * as a human-readable dollar string. Trailing zeros are dropped
 * (5_000_000 -> "5", 1_500_000 -> "1.5"). Malformed input falls back to "0".
 */
export function formatUsdc(units: string): string {
  const n = Number(units);
  if (!Number.isFinite(n)) return '0';
  return String(Number((n / USDC_UNITS_PER_DOLLAR).toFixed(6)));
}
