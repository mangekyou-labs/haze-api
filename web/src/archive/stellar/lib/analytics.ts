'use client';

import posthog from 'posthog-js';

const STORAGE_KEY = 'zk-credits:evaluation-analytics-opt-in';
const MAX_DURATION_MS = 120_000;
const SAFE_ERROR_CODE = /^[a-z0-9_:-]{1,64}$/;
const EVENT_NAMES = new Set([
  'evaluation_enrollment_started',
  'evaluation_enrollment_completed',
  'wallet_challenge_requested',
  'wallet_proof_started',
  'wallet_proof_completed',
  'wallet_proof_rejected',
  'checkout_started',
  'checkout_returned',
  'deposit_confirmed',
  'survey_opened',
  'survey_submitted',
]);
const PROPERTY_NAMES = new Set([
  'status',
  'outcome',
  'errorCode',
  'durationMs',
  'easeRating',
  'taskCompleted',
  'wouldUseAgain',
]);
const SAFE_STATUS = new Set(['started', 'received', 'opened', 'confirmed', 'completed']);
const SAFE_OUTCOME = new Set(['success', 'failure']);

let initialized = false;

function storage(): Storage | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

function isSafeValue(key: string, value: unknown): value is string | number | boolean {
  if (key === 'status') return typeof value === 'string' && SAFE_STATUS.has(value);
  if (key === 'outcome') return typeof value === 'string' && SAFE_OUTCOME.has(value);
  if (key === 'errorCode') return typeof value === 'string' && SAFE_ERROR_CODE.test(value);
  if (key === 'durationMs') return typeof value === 'number' && Number.isFinite(value);
  if (key === 'easeRating') return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
  if (key === 'taskCompleted' || key === 'wouldUseAgain') return typeof value === 'boolean';
  return false;
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown> = {},
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!PROPERTY_NAMES.has(key) || !isSafeValue(key, value)) continue;
    if (key === 'durationMs') {
      safe[key] = Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value as number)));
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

export function analyticsEnabled(): boolean {
  return storage()?.getItem(STORAGE_KEY) === '1';
}

export function enableAnalytics(participantCode: string): void {
  if (!/^L4-[a-f0-9]{12}$/.test(participantCode)) return;
  storage()?.setItem(STORAGE_KEY, '1');

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  if (!initialized) {
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      disable_surveys: true,
      opt_out_capturing_by_default: true,
      persistence: 'memory',
      person_profiles: 'never',
    });
    initialized = true;
  }
  posthog.identify(participantCode);
  posthog.opt_in_capturing();
}

export function resetAnalytics(): void {
  storage()?.removeItem(STORAGE_KEY);
  if (initialized) {
    posthog.reset();
    posthog.opt_out_capturing();
  }
  initialized = false;
}

export function trackEvaluationEvent(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (!analyticsEnabled() || !initialized || !EVENT_NAMES.has(event)) return;
  posthog.capture(event, sanitizeAnalyticsProperties(properties));
}

export function trackSurveySent(properties: {
  easeRating: number;
  taskCompleted: boolean;
  wouldUseAgain: boolean;
}): void {
  trackEvaluationEvent('survey_submitted', properties);
}
