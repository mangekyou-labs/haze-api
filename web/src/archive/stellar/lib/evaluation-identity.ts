import { createHmac } from 'node:crypto';

export { EVALUATION_CONSENT_VERSION } from './evaluation-contract';
export const EVALUATION_PARTICIPANT_PREFIX = 'L4-';
const MAX_COMMITMENT_LENGTH = 256;

export interface EvaluationParticipantIdentity {
  fullId: string;
  publicCode: string;
}

/**
 * Derive the restricted participant identity at the web boundary. The full
 * digest is only sent over the authenticated gateway channel; the dashboard
 * exposes the short code, never the GitHub subject or digest.
 */
export function deriveParticipantIdentity(
  subject: string,
  secret: string,
): EvaluationParticipantIdentity {
  if (!subject.trim()) throw new Error('invalid evaluation subject');
  if (!secret) throw new Error('evaluation secret not configured');

  const fullId = createHmac('sha256', secret).update(subject, 'utf8').digest('hex');
  return {
    fullId,
    publicCode: `${EVALUATION_PARTICIPANT_PREFIX}${fullId.slice(0, 12)}`,
  };
}

export function isEvaluationCommitment(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_COMMITMENT_LENGTH
    && /^\d+$/.test(value)
  );
}
