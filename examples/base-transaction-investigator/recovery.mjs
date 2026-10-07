import { sameIdentity as same, validateExecutionEvidence } from "./evidence-binding.mjs";
import { BaseSlotLedger } from "./.generated/slot-ledger.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateTrace } from "./purchase.mjs";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function restoreRecords(records, ledgerDir) {
  if (
    !Array.isArray(records) ||
    records.some(
      (r) => r.schemaVersion !== 1 || typeof r.investigationId !== "string",
    )
  )
    throw Error("invalid_local_journal");
  const ledger = await BaseSlotLedger.open({
    path: join(ledgerDir, "base-slots.json"),
  });
  const retired = ledger.committedSlots();
  return records.map((old) => {
    const r = structuredClone(old);
    r.recovered = true;
    r.durableRetiredSlots = retired.length;
    r.slotLedgerIncomplete = (r.inferenceAttempts ?? []).some(
      (a) => a.state === "retired" && !retired.includes(a.slot),
    );
    for (const a of r.purchaseAttempts ?? []) {
      if (
        a.authorizationExposureMinorUnits > 0 &&
        a.settlement !== "confirmed" &&
        a.settlement !== "failed"
      )
        a.settlement = "unknown";
    }
    for (const a of r.inferenceAttempts ?? []) {
      if (retired.includes(a.slot) && a.state !== "released")
        a.state = "retired";
      if (
        a.state !== "released" &&
        a.outcome !== "confirmed" &&
        a.outcome !== "failed"
      )
        a.outcome = "unknown";
    }
    r.resolved =
      !(r.purchaseAttempts ?? []).some(
        (a) => a.settlement === "unknown" && (a.reservedMinorUnits ?? 0) > 0,
      ) &&
      !(r.inferenceAttempts ?? []).some(
        (a) => a.state !== "released" && a.outcome === "unknown",
      );
    return r;
  });
}
export async function validatedArtifact(record, e, stateDir, decodeError) {
  if (
    !/^[0-9a-f-]{36}$/.test(record.investigationId) ||
    !/^e[1-9][0-9]*$/.test(e.id) ||
    !same(e.transactionHash, record.transactionHash) ||
    e.chainId !== record.chainId ||
    !same(e.blockHash, record.blockHash) ||
    e.blockNumber !== record.blockNumber ||
    e.validation !== "valid"
  )
    throw Error("invalid_artifact_binding");
  const load = async (name, expected) => {
    const text = await readFile(join(stateDir, "artifacts", name), "utf8");
    if (Buffer.byteLength(text) > 4194304) throw Error("invalid_artifact");
    const value = JSON.parse(text);
    if (digest(value) !== expected) throw Error("invalid_artifact_digest");
    return value;
  };
  const value = await load(
    `${record.investigationId}-${e.id}.json`,
    e.contentDigest,
  );
  const request = {
    chainId: record.chainId,
    transactionHash: record.transactionHash,
    blockNumber: record.blockNumber,
    blockHash: record.blockHash,
  };
  if (e.operation === "call_trace") {
    if (e.rawArtifact !== `${record.investigationId}-${e.id}.raw.json`)
      throw Error("invalid_raw_artifact");
    const accepted =
      e.requestBinding ??
      (record.purchaseAttempts ?? []).find(
        (a) =>
          same(a.request?.transactionHash, request.transactionHash) &&
          same(a.request?.blockHash, request.blockHash),
      )?.request;
    if (
      !accepted ||
      Object.keys(accepted).some(
        (k) =>
          ![
            "endpoint",
            "method",
            "chainId",
            "transactionHash",
            "blockNumber",
            "blockHash",
          ].includes(k),
      ) ||
      accepted.chainId !== request.chainId ||
      !same(accepted.transactionHash, request.transactionHash) ||
      !same(accepted.blockHash, request.blockHash) ||
      accepted.blockNumber !== request.blockNumber
    )
      throw Error("missing_accepted_trace_binding");
    const rawEvidence = await load(e.rawArtifact, e.rawContentDigest);
    const validated = validateTrace(rawEvidence, accepted, decodeError);
    if (digest(validated) !== e.contentDigest)
      throw Error("invalid_normalized_trace");
    return { value: validated, rawEvidence };
  } else validateExecutionEvidence(e.operation, value, request, decodeError);
  return { value };
}
export async function recoverReport(record, stateDir, decodeError) {
  const purchases = structuredClone(record.purchaseAttempts ?? []),
    attempts = structuredClone(record.inferenceAttempts ?? []);
  const report = {
    schemaVersion: 1,
    investigationId: record.investigationId,
    chainId: record.chainId,
    transactionHash: record.transactionHash,
    blockNumber: record.blockNumber,
    blockHash: record.blockHash,
    coverage: record.coverage === "supported" ? "supported" : "unsupported",
    completion: "partial",
    diagnosis: "insufficient_evidence",
    stoppingReason: "recovered_stopped",
    partialReason: "recovered_stopped",
    previousStoppingReason: record.stoppingReason,
    evidence: [],
    observedFacts: [],
    supportedDiagnoses: [],
    hypotheses: [],
    suggestedChecks: [],
    missingEvidence: [],
    validationFailures: [],
    uncertainty: [
      "Local artifacts describe the recorded block; current canonical block status was not checked.",
      "Stopped investigation is not resumed; in-memory replay keys are unavailable.",
    ],
    toolInvocations: 0,
    purchaseAttempts: purchases,
    inferenceAttempts: attempts,
    purchase: {
      paymentMode: "simulated",
      authorizedExposureMinorUnits: purchases.reduce(
        (n, a) => n + (a.authorizationExposureMinorUnits ?? 0),
        0,
      ),
      simulatedMinorUnits: purchases
        .filter((a) => a.settlement === "confirmed")
        .reduce((n, a) => n + Number(a.terms.amount), 0),
      liveMinorUnits: record.purchase?.liveMinorUnits ?? 0,
      heldMinorUnits: purchases
        .filter((a) => a.settlement === "unknown")
        .reduce((n, a) => n + (a.reservedMinorUnits ?? 0), 0),
    },
    inference: {
      authorizedAllocation: attempts.filter((a) => a.state !== "released")
        .length,
      provisionalSlots: attempts.filter((a) =>
        ["reserved", "provisional"].includes(a.state),
      ).length,
      locallyRetiredSlots: attempts.filter((a) => a.state === "retired").length,
      confirmedCommitted: attempts.filter((a) => a.outcome === "confirmed")
        .length,
      unknownOutcomes: attempts.filter(
        (a) => a.state !== "released" && a.outcome === "unknown",
      ).length,
      durableRetiredSlots: record.durableRetiredSlots ?? 0,
    },
  };
  for (const e of record.evidence ?? []) {
    try {
      const { value } = await validatedArtifact(
        record,
        e,
        stateDir,
        decodeError,
      );
      report.evidence.push(structuredClone(e));
      if (e.operation === "receipt")
        report.observedFacts.push({
          value: "failed",
          text: "Recorded receipt records failed execution.",
          evidenceIds: [e.id],
          field: "status",
        });
      if (["historical_replay", "original_execution"].includes(e.operation))
        report.observedFacts.push({
          value: decodeError(value.data),
          text: `Recorded ${e.operation} returned Error(${JSON.stringify(decodeError(value.data))}).`,
          evidenceIds: [e.id],
          field: "data",
        });
      if (e.operation === "call_trace")
        for (const call of value.calls) {
          if (call.error)
            report.observedFacts.push({
              value: call.error,
              text: `Recorded call ${call.reference} returned ${JSON.stringify(call.error)}.`,
              evidenceIds: [e.id],
              field: `${call.reference}.error`,
            });
        }
    } catch {
      report.validationFailures.push(
        `artifact_unavailable:${e.id ?? "unknown"}`,
      );
      report.missingEvidence.push(
        `Local artifact ${e.id ?? "unknown"} is unavailable, corrupt, or lacks accepted transaction binding.`,
      );
    }
  }
  if (!report.evidence.length)
    report.missingEvidence.push(
      "No validated local execution evidence is available.",
    );
  report.missingEvidence.push(
    "Current canonical block validation and original execution cause may be unavailable.",
  );
  report.summary = report.evidence.map(
    ({ id, operation, validation, omissions }) => ({
      id,
      operation,
      validation,
      omissions,
    }),
  );
  report.text = `Investigation stopped after recovery. ${report.observedFacts.length ? "Validated local execution facts are available." : "No validated local execution facts are available."} Purchase: ${report.purchase.heldMinorUnits} simulated USDC minor units held; ${report.purchase.simulatedMinorUnits} confirmed. Inference: ${report.inference.confirmedCommitted} confirmed; ${report.inference.unknownOutcomes} unknown; ${report.inference.locallyRetiredSlots} locally retired.`;
  return report;
}
