// Gateway-mediated withdrawal tests (M2.5). The envelope builder + fee relay
// are injected so the orchestration is fully offline-tested.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestWithdrawal, WithdrawError, type WithdrawDeps } from './withdraw.js';

const withdrawalProof = { pi_a: ['1', '2', '1'] };
const pubSignals = ['123', '456', '789'];

describe('requestWithdrawal (gateway co-signer + fee-relay handoff)', () => {
  let buildEnvelope: ReturnType<typeof vi.fn>;
  let relayEnvelope: ReturnType<typeof vi.fn>;
  let deps: WithdrawDeps;

  beforeEach(() => {
    buildEnvelope = vi.fn().mockResolvedValue('inner-envelope-xdr');
    relayEnvelope = vi.fn().mockResolvedValue({ feeBumpHash: 'fee-bump-hash-1', duplicate: false });
    deps = { buildEnvelope, relayEnvelope, gatewaySecretKey: 'GATEWAY-SECRET' };
  });

  it('builds the depositor-signed envelope and relays it (fee-bumps hash returned)', async () => {
    const result = await requestWithdrawal(deps, withdrawalProof, pubSignals, '123', 'G-RECIPIENT');

    expect(buildEnvelope).toHaveBeenCalledWith(
      'GATEWAY-SECRET',
      withdrawalProof,
      pubSignals,
      '123',
      'G-RECIPIENT',
    );
    expect(relayEnvelope).toHaveBeenCalledWith('inner-envelope-xdr');
    expect(result).toEqual({ feeBumpHash: 'fee-bump-hash-1', duplicate: false });
  });

  it('adds a fee bump only once (relay reports duplicate on retry)', async () => {
    relayEnvelope.mockResolvedValueOnce({ feeBumpHash: 'fee-bump-hash-1', duplicate: false });
    relayEnvelope.mockResolvedValueOnce({ feeBumpHash: 'fee-bump-hash-1', duplicate: true });

    const first = await requestWithdrawal(deps, withdrawalProof, pubSignals, '123', 'G-RECIPIENT');
    const second = await requestWithdrawal(deps, withdrawalProof, pubSignals, '123', 'G-RECIPIENT');
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(relayEnvelope).toHaveBeenCalledTimes(2);
  });

  it('rejects missing commitment or recipient', async () => {
    await expect(requestWithdrawal(deps, withdrawalProof, pubSignals, '', 'G-R')).rejects.toMatchObject({ status: 400 });
    await expect(requestWithdrawal(deps, withdrawalProof, pubSignals, '123', '')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an unproven withdrawal before it reaches the gateway signer', async () => {
    await expect(requestWithdrawal(deps, undefined, pubSignals, '123', 'G-R')).rejects.toMatchObject({ status: 400 });
    await expect(requestWithdrawal(deps, withdrawalProof, undefined, '123', 'G-R')).rejects.toMatchObject({ status: 400 });
    expect(buildEnvelope).not.toHaveBeenCalled();
  });

  it('surfaces 502 when the inner tx cannot be built', async () => {
    buildEnvelope.mockRejectedValueOnce(new Error('account not found'));
    await expect(requestWithdrawal(deps, withdrawalProof, pubSignals, '123', 'G-R')).rejects.toMatchObject({ status: 502 });
  });

  it('surfaces 503 when the fee relay rejects', async () => {
    relayEnvelope.mockRejectedValueOnce(new Error('method not sponsored'));
    await expect(requestWithdrawal(deps, withdrawalProof, pubSignals, '123', 'G-R')).rejects.toMatchObject({ status: 503 });
  });
});
