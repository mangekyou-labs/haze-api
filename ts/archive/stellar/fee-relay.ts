// Public fee-relay core (M2.4).
//
// Fee-only authority: the sponsor fee-bumps an inner transaction but never
// alters its contents — the contract's auth gates all state. The relay
// accepts only transactions that call slash() or withdraw() on the configured
// ZkCreditsContract (method-validation gate), so a fee relay can never be
// used to sponsor an arbitrary transfer. Idempotent on the inner tx hash:
// a retried inner tx is sponsored exactly once.

import { TransactionBuilder, hash, Keypair, Networks, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { FeeSponsorStore } from './db/index.js';

/** Methods the fee relay is allowed to sponsor. */
export const ALLOWED_METHODS = ['slash', 'withdraw'] as const;
export type AllowedMethod = (typeof ALLOWED_METHODS)[number];

export class InvalidRelayRequestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'InvalidRelayRequestError';
  }
}

export interface FeeRelayConfig {
  networkPassphrase: string;
  contractId: string;
  /** Sponsor (fee-payer) XLM secret key — env-separated, never shared. */
  sponsorSecretKey: string;
}

export interface FeeRelayDeps extends FeeRelayConfig {
  store: FeeSponsorStore;
  /** Submit a fee-bumped transaction envelope; returns its hash. */
  submitEnvelope: (envelopeXdr: string) => Promise<string>;
}

function isAllowedMethod(method: string): method is AllowedMethod {
  return (ALLOWED_METHODS as readonly string[]).includes(method);
}

/**
 * Validate an inner transaction XDR: exactly one invokeHostFunction op calling
 * an allowed method on the configured contract. Returns the extracted method
 * + inner tx hash (the idempotency key). Rejects arbitrary transfers.
 */
export function validateRelayRequest(
  innerTxXdr: string,
  contractId: string,
): { method: AllowedMethod; innerTxHash: string } {
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(innerTxXdr, Networks.TESTNET);
  } catch (err: unknown) {
    throw new InvalidRelayRequestError(
      `malformed inner transaction: ${err instanceof Error ? err.message : 'unparseable XDR'}`,
    );
  }

  const ops = tx.operations;
  if (ops.length !== 1) {
    throw new InvalidRelayRequestError(`expected exactly 1 operation, got ${ops.length}`);
  }
  if (ops[0].type !== 'invokeHostFunction') {
    throw new InvalidRelayRequestError(
      `non-contract operation not allowed (got ${ops[0].type ?? 'unknown'})`,
      403,
    );
  }

  const invoke = ops[0] as unknown as {
    func?: {
      switch: () => number;
      value: () => unknown;
      invokeContract?: () => {
        contractAddress: () => xdr.ScAddress;
        functionName: () => { toString: () => string };
      };
    };
  };
  const func = invoke.func;
  const inner = func?.invokeContract?.();
  if (!func || !inner) {
    throw new InvalidRelayRequestError('operation is not a plain contract invocation', 403);
  }

  const address = inner.contractAddress();
  // Contract addresses are encoded as contract hashes; account addresses are
  // not valid relay targets (only the configured Soroban contract is).
  let contractAddr: string;
  try {
    contractAddr = StrKey.encodeContract(Buffer.from(address.contractId() as unknown as number[]));
  } catch {
    throw new InvalidRelayRequestError('relay target must be a contract address (not an account)', 403);
  }
  if (contractAddr !== contractId) {
    throw new InvalidRelayRequestError(`contract mismatch: expected ${contractId}`, 403);
  }

  const method = inner.functionName().toString();
  if (!isAllowedMethod(method)) {
    throw new InvalidRelayRequestError(`method not sponsored by fee relay: ${method}`, 403);
  }

  const innerTxHash = hash(Buffer.from(innerTxXdr, 'base64')).toString('hex');
  return { method, innerTxHash };
}

/**
 * Reads the root-removal values from the same signed inner transaction that
 * the fee sponsor validates. The gateway uses this only to mirror a
 * contract-accepted slash into its public membership snapshot.
 */
export function extractSlashTransition(
  innerTxXdr: string,
  contractId: string,
): { commitment: string; currentRoot: string; nextRoot: string } {
  const { method } = validateRelayRequest(innerTxXdr, contractId);
  if (method !== 'slash') throw new InvalidRelayRequestError('expected a slash transaction');

  const tx = TransactionBuilder.fromXDR(innerTxXdr, Networks.TESTNET);
  const invoke = tx.operations[0] as unknown as {
    func?: {
      invokeContract?: () => { args?: () => xdr.ScVal[] };
    };
  };
  const args = invoke.func?.invokeContract?.().args?.();
  if (!args || args.length !== 4) {
    throw new InvalidRelayRequestError('slash transaction must contain four contract arguments');
  }

  let pubSignals: unknown;
  let commitment: unknown;
  try {
    pubSignals = scValToNative(args[1]!);
    commitment = scValToNative(args[2]!);
  } catch {
    throw new InvalidRelayRequestError('slash transaction has malformed public signals');
  }
  if (!Array.isArray(pubSignals) || pubSignals.length !== 9) {
    throw new InvalidRelayRequestError('slash transaction must contain nine public signals');
  }
  const normalizedSignals = pubSignals.map((signal) => String(signal));
  const normalizedCommitment = String(commitment);
  if (normalizedSignals[1] !== normalizedCommitment) {
    throw new InvalidRelayRequestError('slash commitment does not match its public signals');
  }
  return {
    commitment: normalizedCommitment,
    currentRoot: normalizedSignals[3]!,
    nextRoot: normalizedSignals[4]!,
  };
}

/**
 * Fee-bump an inner transaction with the sponsor key. The inner tx keeps its
 * own signatures; the fee bump only adds the fee payer (fee-only authority).
 * Returns the fee-bumped transaction envelope as base64 XDR.
 */
export function buildFeeBumpEnvelope(
  innerTxXdr: string,
  config: FeeRelayConfig,
): string {
  const innerTx = TransactionBuilder.fromXDR(innerTxXdr, config.networkPassphrase);
  const sponsor = Keypair.fromSecret(config.sponsorSecretKey);

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor.publicKey(),
    '5000000',
    innerTx as never,
    config.networkPassphrase,
  );
  feeBump.sign(sponsor);
  return feeBump.toEnvelope().toXDR('base64');
}

/**
 * Process one fee-relay request: validate → record idempotently → fee-bump →
 * submit → mark submitted. Duplicates return the prior result (no re-sponsor).
 */
export async function relayOne(
  deps: FeeRelayDeps,
  innerTxXdr: string,
): Promise<{
  duplicate: boolean;
  innerTxHash: string;
  method: AllowedMethod;
  feeBumpHash: string | null;
}> {
  const { method, innerTxHash } = validateRelayRequest(innerTxXdr, deps.contractId);

  const { inserted, request } = await deps.store.recordRelayRequestOnce({
    innerTxHash,
    method,
    contractId: deps.contractId,
    innerTxXdr,
  });

  if (!inserted) {
    return {
      duplicate: true,
      innerTxHash,
      method,
      feeBumpHash: request.feeBumpHash,
    };
  }

  let envelopeXdr: string;
  try {
    envelopeXdr = buildFeeBumpEnvelope(innerTxXdr, deps);
  } catch (err: unknown) {
    await deps.store.markFailed(innerTxHash);
    const message = err instanceof Error ? err.message : 'fee_bump_failed';
    throw new InvalidRelayRequestError(`fee bump failed: ${message}`, 500);
  }

  let feeBumpHash: string;
  try {
    feeBumpHash = await deps.submitEnvelope(envelopeXdr);
  } catch (err: unknown) {
    await deps.store.markFailed(innerTxHash);
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidRelayRequestError(`submission failed: ${message}`, 503);
  }

  await deps.store.markSubmitted(innerTxHash, feeBumpHash);
  return { duplicate: false, innerTxHash, method, feeBumpHash };
}
