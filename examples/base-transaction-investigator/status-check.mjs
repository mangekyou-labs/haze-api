/** Status interfaces carry no purchase, proof, or replacement authority. */
export function hasNonauthorizingStatus(status) {
  return status?.reconciliation?.nonauthorizing === true &&
    typeof status.reconciliation.documentation === "string" &&
    status.reconciliation.documentation.startsWith("https://") &&
    typeof status.reconcile === "function";
}
// Callers retain their distinct counters, clocks, and reserved task allowances.
export async function runStatusChecks({ status, unknown, available, before, dispatch, observe, after }) {
  if (!hasNonauthorizingStatus(status)) return;
  while (unknown() && available()) {
    await before(); // Durable check intent always precedes external dispatch.
    try { await observe(await dispatch()); }
    catch (error) {
      if (error.message === "local_persistence_failed") throw error;
      // Unavailability cannot establish termination or release exposure.
    }
    await after();
  }
}
export async function dispatchStatus(status, request, remaining) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => status.reconcile({ ...request, signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(Error("status_timeout"));
      }, remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}
