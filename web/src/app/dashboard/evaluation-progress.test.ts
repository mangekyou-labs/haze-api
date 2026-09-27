import { describe, expect, it } from 'vitest';
import {
  EVALUATION_PROGRESS_STEPS,
  canStartEvaluationCheckout,
  canSubmitEvaluationFeedback,
  evaluationStep,
} from './evaluation-progress';

const status = (depositConfirmed: boolean, feedbackSubmitted = false) => ({
  deposit: { confirmed: depositConfirmed },
  feedbackSubmitted,
});

describe('wallet-optional evaluation progress', () => {
  it('uses consent, checkout/deposit, and feedback stages', () => {
    expect(EVALUATION_PROGRESS_STEPS.map(([label]) => label)).toEqual([
      'Consent',
      '$1 checkout + deposit',
      'Feedback',
    ]);
    expect(evaluationStep(null)).toBe(0);
    expect(evaluationStep(status(false))).toBe(2);
    expect(evaluationStep(status(true))).toBe(3);
    expect(evaluationStep(status(true, true))).toBe(4);
  });

  it('gates checkout on enrollment plus browser commitment, and feedback on confirmed deposit', () => {
    expect(canStartEvaluationCheckout(null, '0x' + '1'.repeat(64))).toBe(false);
    expect(canStartEvaluationCheckout(status(false), null)).toBe(false);
    expect(canStartEvaluationCheckout(status(false), '0x' + '1'.repeat(64))).toBe(true);
    expect(canSubmitEvaluationFeedback(status(false))).toBe(false);
    expect(canSubmitEvaluationFeedback({
      deposit: { confirmed: true },
      feedbackSubmitted: false,
    })).toBe(true);
  });
});
