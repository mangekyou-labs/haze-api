export const EVALUATION_CHECKOUT_AMOUNT_CENTS = 100;
export const EVALUATION_CHECKOUT_USDC_AMOUNT = '10000000';

export interface EvaluationCheckoutMetadataInput {
  participantId: string;
  participantCode: string;
  commitment: string;
}

export function buildEvaluationCheckoutMetadata(
  input: EvaluationCheckoutMetadataInput,
): Record<string, string> {
  return {
    tier: 'evaluation',
    participantId: input.participantId,
    participantCode: input.participantCode,
    commitment: input.commitment,
    usdcAmount: EVALUATION_CHECKOUT_USDC_AMOUNT,
    amountCents: String(EVALUATION_CHECKOUT_AMOUNT_CENTS),
  };
}
