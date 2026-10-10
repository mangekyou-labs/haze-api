/** RPC fixtures only: no RPC credentials or chain writes required. */
export function indexTransfers(logs) {
  // Demo bug: repeated RPC log pages count the same transfer twice.
  return logs.map(log => ({ ...log, amount: BigInt(log.amount) }));
}
