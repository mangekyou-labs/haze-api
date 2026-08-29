// Gateway-mediated withdrawal (M2.5).
//
// The contract's withdraw() requires deposit.depositor auth plus a
// browser-generated membership-removal proof. The gateway is the depositor for
// all testnet deposits, so it builds + co-signs the inner tx after the caller
// supplies that proof. The user never needs XLM: the fee-sponsor relay (M2.4)
// fee-bumps the envelope. The heavy lifting (validation idempotency, fee bump)
// lives in the relay; here we only build the inner tx and submit it.

export interface WithdrawDeps {
  /** Build the inner withdraw transaction envelope as the depositor. */
  buildEnvelope: (
    depositorSecretKey: string,
    withdrawalProof: object,
    pubSignals: string[],
    commitment: string,
    recipient: string,
  ) => Promise<string>;
  /**
   * Submit an inner tx to the fee-sponsor relay for a fee bump. Returns the
   * fee-bump hash of the relayed transaction.
   */
  relayEnvelope: (innerTxXdr: string) => Promise<{ feeBumpHash: string | null; duplicate: boolean }>;
  /** Gateway (depositor) secret key. */
  gatewaySecretKey: string;
}

export class WithdrawError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'WithdrawError';
  }
}

/**
 * Execute a gateway-mediated withdrawal: build the inner tx as depositor,
 * forward to the fee relay (fee-only sponsorship), return the fee-bump hash.
 */
export async function requestWithdrawal(
  deps: WithdrawDeps,
  withdrawalProof: object | null | undefined,
  pubSignals: string[] | null | undefined,
  commitment: string,
  recipient: string,
): Promise<{ feeBumpHash: string | null; duplicate: boolean }> {
  if (!withdrawalProof || typeof withdrawalProof !== 'object' || !Array.isArray(pubSignals)) {
    throw new WithdrawError('withdrawalProof and pubSignals are required');
  }
  if (!commitment || !recipient) {
    throw new WithdrawError('commitment and recipient are required');
  }

  let innerTxXdr: string;
  try {
    innerTxXdr = await deps.buildEnvelope(
      deps.gatewaySecretKey,
      withdrawalProof,
      pubSignals,
      commitment,
      recipient,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WithdrawError(`failed to build withdraw transaction: ${message}`, 502);
  }

  try {
    const relayResult = await deps.relayEnvelope(innerTxXdr);
    if (relayResult.duplicate) {
      return { feeBumpHash: relayResult.feeBumpHash, duplicate: true };
    }
    return { feeBumpHash: relayResult.feeBumpHash, duplicate: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WithdrawError(`fee relay rejected the withdraw: ${message}`, 503);
  }
}
