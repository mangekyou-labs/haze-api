export function isOwnedEvaluationReceipt(
  metadataParticipantId: unknown,
  sessionParticipantId: string,
): metadataParticipantId is string {
  return typeof metadataParticipantId === 'string'
    && metadataParticipantId.length === 64
    && metadataParticipantId === sessionParticipantId;
}
