// One binding policy for live collection, model tools, and durable recovery.
export const sameIdentity = (a, b) => typeof a === "string" &&
  typeof b === "string" && a.toLowerCase() === b.toLowerCase();
export function validateExecutionEvidence(operation, value, request, decodeError, { allowSuccessful = false } = {}) {
  const same = sameIdentity;
  let valid = false;
  if (operation === "transaction") valid = value &&
    same(value.hash, request.transactionHash) && Number(value.chainId) === request.chainId &&
    /^0x[0-9a-f]{64}$/i.test(value.blockHash) && /^0x[0-9a-f]+$/i.test(value.blockNumber) &&
    (request.blockHash === undefined || same(value.blockHash, request.blockHash)) &&
    (request.blockNumber === undefined || same(value.blockNumber, request.blockNumber));
  else if (operation === "receipt") valid = value &&
    same(value.transactionHash, request.transactionHash) && same(value.blockHash, request.blockHash) &&
    same(value.blockNumber, request.blockNumber) &&
    (value.chainId === undefined || Number(value.chainId) === request.chainId);
  else if (operation === "block") valid = value && same(value.hash, request.blockHash) && same(value.number, request.blockNumber);
  else if (["historical_replay", "original_execution", "revert"].includes(operation)) {
    valid = value && ["historical_replay", "original_execution"].includes(value.kind) &&
      (operation === "revert" || value.kind === operation) && same(value.atBlock, request.blockNumber) &&
      (value.transactionHash === undefined || same(value.transactionHash, request.transactionHash)) &&
      (value.blockHash === undefined || same(value.blockHash, request.blockHash)) &&
      (value.chainId === undefined || Number(value.chainId) === request.chainId) &&
      (value.kind !== "original_execution" || (same(value.transactionHash, request.transactionHash) &&
        same(value.blockHash, request.blockHash) && Number(value.chainId) === request.chainId));
  }
  if (!valid) throw Error("invalid_evidence_binding");
  if (operation === "receipt" && !((allowSuccessful && value.status === "0x1") ||
      (value.status === "0x0" && Array.isArray(value.logs)))) throw Error("invalid_receipt");
  if (["historical_replay", "original_execution", "revert"].includes(operation)) decodeError(value.data);
  return value;
}
