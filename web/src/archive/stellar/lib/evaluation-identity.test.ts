import { describe, expect, it } from 'vitest';
import {
  deriveParticipantIdentity,
  isEvaluationCommitment,
  EVALUATION_CONSENT_VERSION,
} from './evaluation-identity';

describe('evaluation participant identity', () => {
  it('derives a stable opaque public code from the authenticated subject', () => {
    const first = deriveParticipantIdentity('github|12345', 'test-hmac-secret');
    const second = deriveParticipantIdentity('github|12345', 'test-hmac-secret');
    const otherSubject = deriveParticipantIdentity('github|54321', 'test-hmac-secret');

    expect(first).toEqual(second);
    expect(first.fullId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.publicCode).toMatch(/^L4-[a-f0-9]{12}$/);
    expect(first.publicCode).toBe(`L4-${first.fullId.slice(0, 12)}`);
    expect(otherSubject.fullId).not.toBe(first.fullId);
    expect(first.fullId).not.toContain('12345');
  });

  it('keeps the consent contract stable', () => {
    expect(EVALUATION_CONSENT_VERSION).toBe('level4-2026-09-11');
  });
});

describe('evaluation commitment validation', () => {
  it('accepts decimal field commitments and rejects malformed values', () => {
    expect(isEvaluationCommitment('0')).toBe(true);
    expect(isEvaluationCommitment('12345678901234567890')).toBe(true);
    expect(isEvaluationCommitment('')).toBe(false);
    expect(isEvaluationCommitment(' 123')).toBe(false);
    expect(isEvaluationCommitment('-1')).toBe(false);
    expect(isEvaluationCommitment('0x123')).toBe(false);
    expect(isEvaluationCommitment('1.2')).toBe(false);
    expect(isEvaluationCommitment('1'.repeat(257))).toBe(false);
    expect(isEvaluationCommitment(null)).toBe(false);
  });
});
