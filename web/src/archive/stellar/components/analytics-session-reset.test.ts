import { describe, expect, it } from 'vitest';
import { shouldResetAnalytics } from './analytics-session-reset';

describe('analytics session reset', () => {
  it('resets only after the auth session becomes unauthenticated', () => {
    expect(shouldResetAnalytics('unauthenticated')).toBe(true);
    expect(shouldResetAnalytics('authenticated')).toBe(false);
    expect(shouldResetAnalytics('loading')).toBe(false);
  });
});
