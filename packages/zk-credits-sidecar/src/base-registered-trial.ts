/**
 * One-shot local transport for the founder's task-running x402 demo agent.
 *
 * @x402/core creates scheme payloads from PaymentRequired and does not pass
 * HTTP method/body context to a scheme client. This harness captures that
 * request context locally, then binds it into the same Base proof factory
 * before invoking the registered `zk-prepaid` scheme. It is intended only for
 * the internal Base Sepolia founder demo, not as a general HTTP client.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { x402Client } from '@x402/core/client';
import type { PaymentRequired as CorePaymentRequired } from '@x402/core/types';
import {
  BASE_SEPOLIA_NETWORK,
  decodeHeader,
  encodeHeader,
  lifecycleFailure,
  lifecycleStage,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  registerZkPrepaidClient,
  ZK_PREPAID_SCHEME,
} from '@zk-credits/x402-zk-prepaid';
import { createBasePaymentFactory, type BasePrepaidClientOptions } from './base-sidecar.js';

export type BaseRegisteredTrialFailurePhase =
  | 'challenge_transport'
  | 'challenge_status'
  | 'challenge_header'
  | 'challenge_invalid'
  | 'challenge_unsupported'
  | 'challenge_request_mismatch'
  | 'proof_generation'
  | 'payment_transport'
  | 'payment_rejected'
  | 'payment_response_missing'
  | 'payment_response_invalid'
  | 'response_not_ok';

export interface BaseRegisteredTrialResult {
  challengeStatus: number | null;
  challengeReceived: boolean;
  proofPrepared: boolean;
  paymentSignatureSent: boolean;
  paymentStatus: number | null;
  paymentResponseConfirmed: boolean;
  responseStatus: number | null;
  responseSucceeded: boolean;
  committedSlotDelta: number;
  failurePhase?: BaseRegisteredTrialFailurePhase;
}

export interface BaseRegisteredTrialOptions extends BasePrepaidClientOptions {
  url: string;
  body: string;
  headers?: HeadersInit;
  fetch?: typeof fetch;
  /** The response can be shown locally to the operator; it is never retained by metrics. */
  onResponse?: (response: Response) => void | Promise<void>;
}

/** A bounded, single-task request for the founder's internal x402 demo. */
export function buildBaseRegisteredTrialRequestBody(task = 'Reply with exactly: internal trial complete.'): string {
  if (typeof task !== 'string' || task.trim().length === 0 || task.length > 4_000) {
    throw new Error('Task must contain between 1 and 4000 characters');
  }
  return JSON.stringify({
    model: 'deepseek/deepseek-v4-flash',
    messages: [{ role: 'user', content: task }],
  });
}

function observe(options: BaseRegisteredTrialOptions, event: ReturnType<typeof lifecycleStage> | ReturnType<typeof lifecycleFailure>): void {
  try {
    options.lifecycle?.(event);
  } catch {
    // An observer must never change an exchange.
  }
}

function withFailure(
  options: BaseRegisteredTrialOptions,
  result: BaseRegisteredTrialResult,
  startingCommittedSlots: number,
  failurePhase: BaseRegisteredTrialFailurePhase,
  failure?: Parameters<typeof lifecycleFailure>[0],
): BaseRegisteredTrialResult {
  result.failurePhase = failurePhase;
  if (failure) observe(options, lifecycleFailure(failure));
  result.committedSlotDelta = (options.slotLedger?.snapshot().committed ?? startingCommittedSlots) - startingCommittedSlots;
  return result;
}

function requestHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers);
}

/** Runs one POST to the pilot chat route through a directly registered adapter. */
export async function runBaseRegisteredTrialExchange(options: BaseRegisteredTrialOptions): Promise<BaseRegisteredTrialResult> {
  const ledger = options.slotLedger;
  if (!ledger) throw new Error('A durable slot ledger is required for the Base pilot');
  const startingCommittedSlots = ledger.snapshot().committed;
  const result: BaseRegisteredTrialResult = {
    challengeStatus: null,
    challengeReceived: false,
    proofPrepared: false,
    paymentSignatureSent: false,
    paymentStatus: null,
    paymentResponseConfirmed: false,
    responseStatus: null,
    responseSucceeded: false,
    committedSlotDelta: 0,
  };
  let target: URL;
  try {
    target = new URL(options.url);
  } catch {
    return withFailure(options, result, startingCommittedSlots, 'challenge_request_mismatch');
  }
  if (
    target.protocol !== 'https:'
    || target.username !== ''
    || target.password !== ''
    || target.search !== ''
    || target.hash !== ''
    || target.pathname !== '/v1/chat/completions'
  ) {
    return withFailure(options, result, startingCommittedSlots, 'challenge_request_mismatch');
  }

  const fetcher = options.fetch ?? fetch;
  const requestInit: RequestInit = {
    method: 'POST',
    body: options.body,
    headers: requestHeaders(options.headers),
    redirect: 'error',
  };
  let challengeResponse: Response;
  try {
    challengeResponse = await fetcher(target, requestInit);
  } catch {
    return withFailure(options, result, startingCommittedSlots, 'challenge_transport', 'transport_failed');
  }
  result.challengeStatus = challengeResponse.status;
  if (challengeResponse.status !== 402) {
    return withFailure(options, result, startingCommittedSlots, 'challenge_status', 'payment_rejected');
  }

  const encodedRequired = challengeResponse.headers.get(PAYMENT_REQUIRED_HEADER);
  if (!encodedRequired) {
    return withFailure(options, result, startingCommittedSlots, 'challenge_header', 'challenge_unsupported');
  }
  let required: CorePaymentRequired;
  try {
    required = decodeHeader<CorePaymentRequired>(encodedRequired);
  } catch {
    return withFailure(options, result, startingCommittedSlots, 'challenge_invalid', 'challenge_unreadable');
  }
  if (
    required.x402Version !== 2
    || !Array.isArray(required.accepts)
    || !required.accepts.some((accepted) => accepted.scheme === ZK_PREPAID_SCHEME && accepted.network === BASE_SEPOLIA_NETWORK)
  ) {
    return withFailure(options, result, startingCommittedSlots, 'challenge_unsupported', 'challenge_unsupported');
  }
  const challengeUrl = required.resource?.url;
  if (challengeUrl && challengeUrl !== target.toString()) {
    return withFailure(options, result, startingCommittedSlots, 'challenge_request_mismatch', 'challenge_unsupported');
  }
  result.challengeReceived = true;
  observe(options, lifecycleStage('challenge_received'));

  const createPayment = createBasePaymentFactory(options);
  const directAdapter = registerZkPrepaidClient(
    new x402Client((_version, accepts) => {
      const selected = accepts.find((accepted) => accepted.scheme === ZK_PREPAID_SCHEME && accepted.network === BASE_SEPOLIA_NETWORK);
      if (!selected) throw new Error('zk_prepaid_challenge_missing');
      return selected;
    }).setSpendControls(false),
    async ({ requirements }) => {
      const prepared = await createPayment({
        url: target.toString(),
        method: 'POST',
        body: options.body,
        requirements,
      });
      return prepared.payment;
    },
  );

  let payment: Awaited<ReturnType<typeof directAdapter.createPaymentPayload>>;
  try {
    payment = await directAdapter.createPaymentPayload(required);
    result.proofPrepared = true;
    observe(options, lifecycleStage('payment_prepared'));
  } catch {
    return withFailure(options, result, startingCommittedSlots, 'proof_generation', 'payment_preparation_failed');
  }

  const headers = requestHeaders(options.headers);
  headers.set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment));
  result.paymentSignatureSent = true;
  let paidResponse: Response;
  try {
    paidResponse = await fetcher(target, { ...requestInit, headers });
  } catch {
    return withFailure(options, result, startingCommittedSlots, 'payment_transport', 'transport_failed');
  }
  result.paymentStatus = paidResponse.status;
  result.responseStatus = paidResponse.status;
  if (paidResponse.status === 402) {
    return withFailure(options, result, startingCommittedSlots, 'payment_rejected', 'payment_rejected');
  }

  const encodedPaymentResponse = paidResponse.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!encodedPaymentResponse) {
    return withFailure(options, result, startingCommittedSlots, 'payment_response_missing', 'settlement_failed');
  }
  try {
    const settlement = decodeHeader<{ success?: unknown; network?: unknown; transaction?: unknown }>(encodedPaymentResponse);
    if (
      settlement.success !== true
      || settlement.network !== BASE_SEPOLIA_NETWORK
      || settlement.transaction !== ''
    ) {
      return withFailure(options, result, startingCommittedSlots, 'payment_response_invalid', 'settlement_failed');
    }
  } catch {
    return withFailure(options, result, startingCommittedSlots, 'payment_response_invalid', 'settlement_failed');
  }
  result.paymentResponseConfirmed = true;
  observe(options, lifecycleStage('settlement_confirmed'));
  if (!paidResponse.ok) {
    return withFailure(options, result, startingCommittedSlots, 'response_not_ok', 'payment_rejected');
  }
  result.responseSucceeded = true;
  observe(options, lifecycleStage('exchange_succeeded'));
  try {
    await options.onResponse?.(paidResponse.clone());
  } catch {
    // Displaying a completed response is local convenience, not settlement.
  }
  result.committedSlotDelta = ledger.snapshot().committed - startingCommittedSlots;
  return result;
}
