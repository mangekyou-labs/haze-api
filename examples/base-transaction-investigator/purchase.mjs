import { runStatusChecks } from "./status-check.mjs";
import { randomUUID } from "node:crypto";

/** Configured simulated exact buyer. It never receives a signer or inference authority. */
export async function acquireTrace({
  policy,
  provider,
  input,
  report,
  invoke,
  add,
  persist,
  priorExposure = 0,
  decodeError,
  clock,
  started,
  reusable,
  reserveTools = 1,
}) {
  report.purchaseAttempts ??= [];
  if (
    !policy?.trace ||
    !provider ||
    report.purchaseAttempts.length ||
    report.evidence.some(
      (e) => e.operation === "original_execution" && e.validation === "valid",
    )
  )
    return;
  if (reusable) {
    const id = await add("call_trace", reusable.value, reusable.source);
    describeTrace(reusable.value, id, report);
    return;
  }
  const rationale = {
    question:
      "Which original execution call failed, and what error did it return?",
    reason:
      "Public receipt and replay do not establish the failing original call; the configured transaction call trace records original execution calls.",
  };
  const attempt = {
    attemptId: randomUUID(),
    rationale,
    state: "proposed",
    reservedMinorUnits: 0,
    authorizationExposureMinorUnits: 0,
    settlement: "unknown",
    delivery: "missing",
    paymentMode: "simulated",
  };
  report.purchaseAttempts.push(attempt);
  await persist(); // Rationale precedes acquisition and authorization.
  const config = policy.trace;
  const request = {
    endpoint: config.endpoint,
    method: config.method,
    chainId: input.chainId,
    transactionHash: input.transactionHash,
    blockNumber: report.blockNumber,
    blockHash: report.blockHash,
  };
  try {
    const url = new URL(config.endpoint);
    if (
      ["maxPurchaseMinorUnits", "maxExposureMinorUnits"].some(
        (k) =>
          config[k] !== undefined &&
          (!Number.isSafeInteger(config[k]) || config[k] < 0),
      )
    )
      throw Error("purchase_config_refused");
    if (
      provider.paymentMode !== "simulated" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      config.method !== "POST" ||
      ![8453, 84532].includes(policy.executionDataPaymentChain) ||
      ![config.asset, config.payee].every((v) => /^0x[0-9a-fA-F]{40}$/.test(v))
    )
      throw Error("purchase_config_refused");
    if (report.toolInvocations + 2 > 8 - reserveTools) throw Error("tool_limit");
    const quoted = await invoke("quote", request);
    const terms = structuredClone(quoted);
    const keys = [
      "endpoint",
      "method",
      "request",
      "scheme",
      "network",
      "asset",
      "payTo",
      "amount",
      "assetTransferMethod",
      "expiresAt",
    ];
    if (
      !terms ||
      Object.keys(terms).some((k) => !keys.includes(k)) ||
      terms.endpoint !== config.endpoint ||
      terms.method !== config.method ||
      JSON.stringify(terms.request) !== JSON.stringify(request) ||
      terms.scheme !== "exact" ||
      terms.network !== `eip155:${policy.executionDataPaymentChain}` ||
      terms.asset !== config.asset ||
      terms.payTo !== config.payee ||
      terms.assetTransferMethod !== "eip3009" ||
      !Number.isSafeInteger(terms.expiresAt) ||
      terms.expiresAt <= Math.floor(clock() / 1000) ||
      terms.expiresAt > Math.floor(clock() / 1000) + 300 ||
      !/^\d{1,10}$/.test(terms.amount)
    )
      throw Error("purchase_terms_refused");
    const amount = Number(terms.amount);
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > Math.min(5000, config.maxPurchaseMinorUnits ?? 5000) ||
      amount + priorExposure >
        Math.min(10000, config.maxExposureMinorUnits ?? 10000)
    )
      throw Error("purchase_budget_refused");
    attempt.terms = terms;
    attempt.request = request;
    attempt.state = "reserved";
    attempt.reservedMinorUnits = amount;
    await persist();
    // Recheck immutable quote and deadline before authorizing; reserve before exposure.
    if (JSON.stringify(quoted) !== JSON.stringify(terms))
      throw Error("purchase_terms_changed");
    if (clock() >= terms.expiresAt * 1000 || clock() - started >= 120000)
      throw Error("deadline_exceeded");
    if (report.toolInvocations >= 8 - reserveTools) throw Error("tool_limit");
    attempt.state = "exposed";
    attempt.authorizationExposureMinorUnits = amount;
    report.purchase.authorizedExposureMinorUnits = amount;
    await persist();
    const result = await invoke("acquire", {
      request: structuredClone(request),
      terms: structuredClone(terms),
      attemptId: attempt.attemptId,
      authorizationMode: "simulated",
    });
    applyPurchaseObservation(attempt, result?.settlementObservation, report.purchase);
    if (result?.trace !== undefined) attempt.delivery = "invalid";
    await persist();
    if (result?.terms && JSON.stringify(result.terms) !== JSON.stringify(terms))
      throw Error("purchase_terms_changed");
    if (
      result?.redirected ||
      (result?.endpoint && result.endpoint !== config.endpoint)
    )
      throw Error("purchase_redirect_refused");
    if (result?.trace === undefined) {
      await reconcilePurchase({ attempt, provider, invoke, report, persist, clock, started, reserveTools });
      if (attempt.settlement === "confirmed") report.stoppingReason = "paid_but_unusable";
      else if (attempt.settlement === "unknown") report.stoppingReason = "purchase_outcome_unknown";
      report.missingEvidence.push("Purchased trace was not delivered.");
      return;
    }
    attempt.delivery = "invalid";
    const validated = validateTrace(result.trace, request, decodeError);
    const id = await add("call_trace", validated, {
      origin: "configured_trace_provider",
      provenance: provider.provenance ?? "synthetic",
      rawEvidence: result.trace,
    });
    attempt.evidenceId = id;
    attempt.delivery = "validated";
    describeTrace(validated, id, report);
    if (attempt.settlement === "unknown") {
      report.completion = "partial";
      report.stoppingReason = "purchase_outcome_unknown";
      await reconcilePurchase({ attempt, provider, invoke, report, persist, clock, started, reserveTools });
    }
    await persist();
  } catch (error) {
    if (error.message === "local_persistence_failed") throw error;
    const reason = [
      "purchase_config_refused",
      "purchase_terms_refused",
      "purchase_budget_refused",
      "purchase_terms_changed",
      "purchase_redirect_refused",
      "invalid_trace",
      "invalid_trace_binding",
      "invalid_trace_decoding",
      "invalid_revert_decoding",
      "trace_resource_limit",
      "evidence_size_limit",
      "invalid_evidence_json",
      "deadline_exceeded",
      "tool_limit",
    ].includes(error.message)
      ? error.message
      : "trace_unavailable";
    if (!attempt.authorizationExposureMinorUnits) {
      attempt.reservedMinorUnits = 0;
      attempt.state = "rejected";
    } else if (attempt.settlement === "unknown") {
      report.purchase.heldMinorUnits = attempt.reservedMinorUnits;
    }
    attempt.refusal = reason;
    report.validationFailures.push(reason);
    report.missingEvidence.push("Configured trace unavailable or invalid.");
    report.stoppingReason = reason;
    await persist();
    if (attempt.authorizationExposureMinorUnits && attempt.settlement === "unknown")
      await reconcilePurchase({ attempt, provider, invoke, report, persist, clock, started, reserveTools });
    if (attempt.settlement === "confirmed" && attempt.delivery !== "validated")
      report.stoppingReason = "paid_but_unusable";
  }
}

/** Only an observation bound to accepted terms and this attempt can change spend. */
export function applyPurchaseObservation(attempt, observation, purchase) {
  if (!observation || observation.attemptId !== attempt.attemptId ||
      JSON.stringify(observation.terms) !== JSON.stringify(attempt.terms) ||
      !["confirmed", "failed"].includes(observation.outcome)) return false;
  // Definitive settlement is monotone: a later response cannot imply a refund.
  if (attempt.settlement !== "unknown" && attempt.settlement !== observation.outcome) return false;
  attempt.settlement = observation.outcome;
  attempt.settlementObservation = {
    attemptId: attempt.attemptId, terms: structuredClone(attempt.terms), outcome: observation.outcome,
  };
  purchase.heldMinorUnits = 0;
  if (observation.outcome === "confirmed") purchase.simulatedMinorUnits = Number(attempt.terms.amount);
  if (observation.outcome === "failed") {
    attempt.reservedMinorUnits = 0;
    purchase.authorizedExposureMinorUnits = 0;
  }
  return true;
}

/** Status only; deliberately neither acquires delivery nor creates authorization. */
export async function reconcilePurchase({ attempt, provider, invoke, report, persist, clock, started, reserveTools = 1 }) {
  attempt.reconciliationChecks ??= 0;
  await runStatusChecks({
    status: provider,
    unknown: () => attempt.settlement === "unknown",
    available: () => attempt.reconciliationChecks < 3 && clock() - started < 120000 && report.toolInvocations < 8 - reserveTools,
    before: async () => { attempt.reconciliationChecks++; await persist(); },
    dispatch: () => invoke("reconcile", {
      attemptId: attempt.attemptId, request: structuredClone(attempt.request), terms: structuredClone(attempt.terms),
    }),
    observe: result => applyPurchaseObservation(attempt, result?.settlementObservation, report.purchase),
    after: persist,
  });
}

export function validateTrace(value, request, decodeError) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("invalid_trace");
  for (const key of ["transactionHash", "chainId", "blockNumber", "blockHash"])
    if (
      value[key] !== undefined &&
      String(value[key]).toLowerCase() !== String(request[key]).toLowerCase()
    )
      throw Error("invalid_trace_binding");
  const root = value.trace ?? value;
  const calls = [];
  const stack = [{ node: root, depth: 1, reference: "root" }];
  while (stack.length) {
    const { node, depth, reference } = stack.pop();
    if (depth > 128 || calls.length >= 10000)
      throw Error("trace_resource_limit");
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      ![
        "CALL",
        "STATICCALL",
        "DELEGATECALL",
        "CALLCODE",
        "CREATE",
        "CREATE2",
        "SELFDESTRUCT",
      ].includes(node.type) ||
      !/^0x[0-9a-fA-F]{40}$/.test(node.from) ||
      (node.to !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(node.to)) ||
      !["input", "output"].every(
        (k) => node[k] === undefined || /^0x(?:[0-9a-fA-F]{2})*$/.test(node[k]),
      ) ||
      (node.error !== undefined &&
        (typeof node.error !== "string" || node.error.length > 2048)) ||
      (node.calls !== undefined && !Array.isArray(node.calls))
    )
      throw Error("invalid_trace");
    const call = {
      reference,
      type: node.type,
      from: node.from,
      to: node.to,
      input: node.input,
      output: node.output,
      error: node.error,
    };
    if (
      node.decodedError !== undefined ||
      node.output?.toLowerCase().startsWith("0x08c379a0")
    ) {
      call.decodedError = decodeError(node.output);
      if (
        node.decodedError !== undefined &&
        node.decodedError !== call.decodedError
      )
        throw Error("invalid_trace_decoding");
    }
    calls.push(call);
    for (let i = (node.calls?.length ?? 0) - 1; i >= 0; i--)
      stack.push({
        node: node.calls[i],
        depth: depth + 1,
        reference:
          reference === "root" ? `calls.${i}` : `${reference}.calls.${i}`,
      });
  }
  return {
    binding: request,
    calls,
    providerIdentity: Object.fromEntries(
      ["transactionHash", "chainId", "blockNumber", "blockHash"]
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, value[k]]),
    ),
  };
}

function describeTrace(validated, id, report) {
  const failures = validated.calls.filter((c) => c.error);
  if (failures.length) {
    const failing = failures.at(-1);
    report.failingCall = { evidenceId: id, reference: failing.reference };
    report.observedFacts.push({
      text: `Original execution call ${failing.reference} failed with ${JSON.stringify(failing.error)}.`,
      value: failing.error,
      evidenceIds: [id],
      field: `${failing.reference}.error`,
    });
    report.supportedDiagnoses.push({
      text: `Original execution call ${failing.reference} failed with ${JSON.stringify(failing.decodedError ?? failing.error)}. This establishes the returned error, not its underlying cause.`,
      value: failing.error,
      evidenceIds: [id],
      field: `${failing.reference}.error`,
    });
    report.diagnosis = "supported";
    report.completion = "complete";
    report.stoppingReason = "trace_evidence_validated";
    report.missingEvidence = report.missingEvidence.filter(
      (x) => !x.startsWith("Validated revert"),
    );
  }
}
