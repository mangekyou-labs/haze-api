export interface EvaluationProgressStatus {
  deposit: { confirmed: boolean };
  feedbackSubmitted: boolean;
}

export const EVALUATION_PROGRESS_STEPS = [
  ['Consent', 'Join voluntarily'],
  ['$1 checkout + deposit', 'Gateway-funded Stellar testnet deposit'],
  ['Feedback', 'Six fixed fields'],
] as const;

export function evaluationStep(status: EvaluationProgressStatus | null): number {
  if (!status) return 0;
  if (!status.deposit.confirmed) return 2;
  if (!status.feedbackSubmitted) return 3;
  return EVALUATION_PROGRESS_STEPS.length + 1;
}

export function canStartEvaluationCheckout(
  status: EvaluationProgressStatus | null,
  commitment: string | null,
): boolean {
  return Boolean(status && commitment);
}

export function canSubmitEvaluationFeedback(status: EvaluationProgressStatus | null): boolean {
  return Boolean(status?.deposit.confirmed);
}
