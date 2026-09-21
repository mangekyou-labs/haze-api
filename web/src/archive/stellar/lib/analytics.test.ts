import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  init: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: {
    capture: mocks.capture,
    identify: mocks.identify,
    init: mocks.init,
    opt_in_capturing: mocks.optIn,
    opt_out_capturing: mocks.optOut,
    reset: mocks.reset,
  },
}));

import {
  analyticsEnabled,
  enableAnalytics,
  resetAnalytics,
  sanitizeAnalyticsProperties,
  trackEvaluationEvent,
  trackSurveySent,
} from './analytics';

describe('evaluation analytics privacy boundary', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.posthog.test');
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts opted out and captures nothing before explicit opt-in', () => {
    trackEvaluationEvent('checkout_started', {
      status: 'started',
      prompt: 'must never be captured',
    });

    expect(analyticsEnabled()).toBe(false);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('does not capture from a stale opt-in until PostHog is initialized', () => {
    storage.set('zk-credits:evaluation-analytics-opt-in', '1');

    trackEvaluationEvent('checkout_started', { status: 'started' });

    expect(analyticsEnabled()).toBe(true);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('initializes only with privacy-safe settings and an allowlisted event shape', () => {
    enableAnalytics('L4-aaaaaaaaaaaa');
    trackEvaluationEvent('wallet_proof_rejected', {
      errorCode: 'challenge_expired',
      outcome: 'failure',
      walletAddress: 'GSHOULD_NOT_CAPTURE',
      nested: { signature: 'secret' },
    });

    expect(analyticsEnabled()).toBe(true);
    expect(mocks.init).toHaveBeenCalledWith('phc_test', expect.objectContaining({
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      disable_surveys: true,
      persistence: 'memory',
    }));
    expect(mocks.identify).toHaveBeenCalledWith('L4-aaaaaaaaaaaa');
    expect(mocks.capture).toHaveBeenCalledWith('wallet_proof_rejected', {
      errorCode: 'challenge_expired',
      outcome: 'failure',
    });
  });

  it('recursively removes sensitive fields and clamps coarse values', () => {
    expect(sanitizeAnalyticsProperties({
      status: 'confirmed',
      durationMs: 999_999,
      nested: { signature: 'secret', outcome: 'success' },
      list: [{ wallet: 'GSECRET' }, { status: 'received' }],
      rawText: 'feedback text',
    })).toEqual({
      status: 'confirmed',
      durationMs: 120_000,
    });
  });

  it('resets PostHog and local opt-in state on logout', () => {
    enableAnalytics('L4-bbbbbbbbbbbb');
    expect(analyticsEnabled()).toBe(true);
    resetAnalytics();

    expect(analyticsEnabled()).toBe(false);
    expect(mocks.reset).toHaveBeenCalled();
    expect(mocks.optOut).toHaveBeenCalled();
  });

  it('emits one allowlisted survey event for a submitted survey', () => {
    enableAnalytics('L4-cccccccccccc');
    trackSurveySent({ easeRating: 4, taskCompleted: true, wouldUseAgain: false });

    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith('survey_submitted', {
      easeRating: 4,
      taskCompleted: true,
      wouldUseAgain: false,
    });
  });
});
