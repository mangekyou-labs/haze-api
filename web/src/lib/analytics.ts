import posthogClient from 'posthog-js';

export type EvaluationEventName =
  | 'evaluation_enrollment_started'
  | 'evaluation_enrollment_completed'
  | 'wallet_challenge_requested'
  | 'wallet_proof_started'
  | 'wallet_proof_completed'
  | 'wallet_proof_rejected'
  | 'checkout_started'
  | 'checkout_returned'
  | 'deposit_confirmed'
  | 'private_call_outcome'
  | 'survey_opened'
  | 'survey_submitted';

export interface SafeAnalyticsProperties {
  durationMs?: number;
  breakpoint?: 'mobile' | 'desktop';
  release?: string;
  errorCode?: string;
  status?: string;
  outcome?: 'success' | 'failure';
  taskCompleted?: boolean;
  wouldUseAgain?: boolean;
  easeRating?: number;
}

const ANALYTICS_CONSENT_KEY = 'stellar-launch-analytics-opt-in';
const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com';
let posthogInitialized = false;

const allowedProperties = new Set<keyof SafeAnalyticsProperties>([
  'durationMs', 'breakpoint', 'release', 'errorCode', 'status', 'outcome',
  'taskCompleted', 'wouldUseAgain', 'easeRating',
]);

function configurePosthog() {
  if (typeof window === 'undefined' || posthogInitialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  posthogClient.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || POSTHOG_DEFAULT_HOST,
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
    disable_surveys: true,
    opt_out_capturing_by_default: true,
    persistence: 'memory',
  });
  posthogInitialized = true;
}

export function initializeAnalytics(): void {
  configurePosthog();
  // A page reload starts PostHog opted out. The evaluation surface restores a
  // prior explicit opt-in once it has obtained the current user's opaque HMAC.
  // Do not clobber an already-restored consent state on later session updates.
  if (posthogInitialized && !analyticsEnabled()) posthogClient.opt_out_capturing();
}

export function analyticsEnabled(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
}

export function enableAnalytics(fullParticipantId: string): void {
  if (typeof window === 'undefined' || !/^[a-f0-9]{64}$/.test(fullParticipantId)) return;
  configurePosthog();
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, 'true');
  if (!posthogInitialized) return;
  posthogClient.opt_in_capturing();
  // The full HMAC is opaque and is never rendered or sent to any other service.
  posthogClient.identify(fullParticipantId);
}

export function resetAnalytics(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(ANALYTICS_CONSENT_KEY);
  if (posthogInitialized) {
    posthogClient.opt_out_capturing();
    posthogClient.reset();
  }
}

export function sanitizeAnalyticsProperties(
  properties: SafeAnalyticsProperties = {},
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties) as [keyof SafeAnalyticsProperties, unknown][]) {
    if (!allowedProperties.has(key)) continue;
    if (key === 'durationMs' && typeof value === 'number') {
      safe[key] = Math.max(0, Math.min(90_000, Math.round(value)));
    } else if (key === 'easeRating' && typeof value === 'number' && Number.isInteger(value)) {
      safe[key] = Math.max(1, Math.min(5, value));
    } else if (typeof value === 'string') {
      safe[key] = value.slice(0, 64);
    } else if (typeof value === 'boolean') {
      safe[key] = value;
    }
  }
  return safe;
}

export function trackEvaluationEvent(
  event: EvaluationEventName,
  properties: SafeAnalyticsProperties = {},
): void {
  if (!analyticsEnabled()) return;
  configurePosthog();
  if (!posthogInitialized) return;
  posthogClient.capture(event, {
    ...sanitizeAnalyticsProperties(properties),
    release: process.env.NEXT_PUBLIC_RELEASE_SHA?.slice(0, 40) || 'local',
  });
}

/** Emit PostHog's documented custom-survey event without sending free text. */
export function trackSurveySent(properties: Pick<SafeAnalyticsProperties, 'easeRating' | 'taskCompleted' | 'wouldUseAgain'> = {}): void {
  if (!analyticsEnabled()) return;
  configurePosthog();
  if (!posthogInitialized) return;
  posthogClient.capture('survey sent', {
    $survey_id: 'stellar-launch-level4',
    $survey_response: 'submitted',
    ...sanitizeAnalyticsProperties(properties),
    release: process.env.NEXT_PUBLIC_RELEASE_SHA?.slice(0, 40) || 'local',
  });
}
