import { describe, expect, it } from 'vitest';
import { isOwnedEvaluationReceipt } from './evaluation-receipt';

describe('evaluation receipt ownership', () => {
  it('accepts only the participant identity derived for the current session', () => {
    const participantId = 'e'.repeat(64);
    expect(isOwnedEvaluationReceipt(participantId, participantId)).toBe(true);
    expect(isOwnedEvaluationReceipt(participantId, 'f'.repeat(64))).toBe(false);
    expect(isOwnedEvaluationReceipt(undefined, participantId)).toBe(false);
  });
});
