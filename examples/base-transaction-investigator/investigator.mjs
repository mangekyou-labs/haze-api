import { hasNonauthorizingStatus, runStatusChecks, dispatchStatus } from "./status-check.mjs";
import { sameIdentity, validateExecutionEvidence } from "./evidence-binding.mjs";
import {
  restoreRecords,
  recoverReport,
  validatedArtifact,
} from "./recovery.mjs";
import { acquireCredentialRuntimeLease } from "./.generated/runtime-owner.mjs";
import { createToolLoop } from "./tool-loop.mjs";
import { applyPurchaseObservation, acquireTrace } from "./purchase.mjs";
import { createInferenceSession } from "./inference.mjs";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  chmod,
  readdir,
  unlink,
  open,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function createInvestigator({
  stateDir,
  rpc,
  provider,
  model,
  signer,
  prover,
  policy,
  inferenceFactory,
  inferenceStatus,
  clarification,
  clock = () => Date.now(),
}) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  stateDir = await realpath(stateDir);
  const lease = inferenceFactory?.acquireOwnership
    ? await inferenceFactory.acquireOwnership()
    : await acquireCredentialRuntimeLease({
        credential: { secret: `offline-investigator:${stateDir}` },
        stateDirectory: stateDir,
        homeDirectory: stateDir,
      });
  const journalPath = join(stateDir, "journal.json");
  let records = [];
  try {
    const text = await readFile(journalPath, "utf8");
    if (Buffer.byteLength(text) > 67108864)
      throw Error("local_journal_size_limit");
    records = JSON.parse(text);
  } catch (e) {
    if (e.code !== "ENOENT") {
      await lease.close();
      throw e;
    }
  }
  let busy = false,
    closed = false,
    activeInference;
  let inferenceRuntime;
  const openInference = async () => {
    if (records.some((r) => r.slotLedgerIncomplete))
      throw Error("slot_ledger_recovery_required");
    if (!inferenceRuntime && inferenceFactory && policy?.inference) {
      try {
        inferenceRuntime = await inferenceFactory({
          authorization: {
            beforeProof: async (request) => {
              if (!activeInference) throw Error("no_active_investigation");
              return activeInference.authorization.beforeProof(request);
            },
            observe: async (event) => {
              if (!activeInference) throw Error("no_active_investigation");
              return activeInference.authorization.observe(event);
            },
          },
          ownership: lease,
        });
      } catch (error) {
        closed = true;
        await lease.close();
        throw error;
      }
    }
    return inferenceRuntime;
  };
  try {
    if (records.length)
      records = await persistJournal(
        stateDir,
        journalPath,
        await restoreRecords(records, lease.stateDirectory),
      );
    else await openInference();
  } catch (error) {
    await lease.close();
    throw error;
  }
  const recoveredIds = new Set(records.map((r) => r.investigationId));
  return {
    async reconcile({ investigationId, attemptId }) {
      if (closed) throw Error("investigator_closed");
      if (busy) throw Error("investigation_already_active");
      const index = records.findIndex(r => r.investigationId === investigationId);
      if (index < 0) throw Error("investigation_not_found");
      const next = structuredClone(records);
      const record = next[index];
      const purchase = record.purchaseAttempts?.find(a => a.attemptId === attemptId);
      const inference = record.inferenceAttempts?.find(a => a.attemptId === attemptId);
      if (!purchase && !inference) throw Error("attempt_not_found");
      if (purchase && inference) throw Error("ambiguous_attempt_identity");
      const attempt = purchase ?? inference;
      const status = purchase ? provider : inferenceStatus;
      const session = { checks: 0, toolInvocations: 0, stoppingReason: "status_unavailable" };
      const started = clock();
      busy = true;
      try {
        if (hasNonauthorizingStatus(status)) {
          session.stoppingReason = "unknown";
          let request;
          await runStatusChecks({
            status,
            unknown: () => (purchase ? attempt.settlement : attempt.outcome) === "unknown",
            available: () => {
              if (clock() - started >= 120000) { session.stoppingReason = "deadline"; return false; }
              return session.checks < 3 && session.toolInvocations < 8;
            },
            before: async () => {
              session.checks++; session.toolInvocations++;
              record.reconciliationSession = structuredClone(session);
              records = structuredClone(await persistJournal(stateDir, journalPath, next));
              request = purchase
                ? { attemptId, request: structuredClone(attempt.request), terms: structuredClone(attempt.terms) }
                : { attemptId, requestDigest: attempt.requestDigest, terms: structuredClone(attempt.terms),
                    ...(attempt.reservationId ? { reservationId: attempt.reservationId } : {}) };
            },
            dispatch: () => dispatchStatus(status, request, 120000 - (clock() - started)),
            observe: result => {
              if (clock() - started >= 120000) { session.stoppingReason = "deadline"; return; }
              const observation = result?.settlementObservation;
              if (purchase) applyPurchaseObservation(attempt, observation, {});
              else if (typeof attempt.requestDigest === "string" && /^[0-9a-f]{64}$/.test(attempt.requestDigest) &&
                       attempt.terms && typeof attempt.terms === "object" &&
                       observation?.attemptId === attemptId &&
                       observation.requestDigest === attempt.requestDigest &&
                       JSON.stringify(observation.terms) === JSON.stringify(attempt.terms) &&
                       (!attempt.reservationId || observation.reservationId === attempt.reservationId) &&
                       ["confirmed", "failed"].includes(observation.outcome) && attempt.state === "retired") {
                attempt.outcome = observation.outcome;
                attempt.settlementObservation = { ...request, outcome: observation.outcome };
              }
            },
            after: async () => {
              if (session.stoppingReason !== "deadline") session.stoppingReason = purchase ? attempt.settlement : attempt.outcome;
              record.reconciliationSession = structuredClone(session);
              record.resolved = !(record.purchaseAttempts ?? []).some(a => a.settlement === "unknown" && a.reservedMinorUnits > 0) &&
              !(record.inferenceAttempts ?? []).some(a => a.state !== "released" && a.outcome === "unknown");
              records = structuredClone(await persistJournal(stateDir, journalPath, next));
            },
          });
        }
        const report = await recoverReport(records.find(r => r.investigationId === investigationId) ?? record, stateDir, decodeError);
        report.reconciliation = structuredClone(session);
        report.toolInvocations = session.toolInvocations;
        return { report, journal: structuredClone(records), session };
      } finally { busy = false; }
    },
    async recover(investigationId) {
      if (closed) throw Error("investigator_closed");
      if (busy) throw Error("investigation_already_active");
      const record = records.find((r) => r.investigationId === investigationId);
      if (!record) throw Error("investigation_not_found");
      busy = true;
      try {
        return await recoverReport(record, stateDir, decodeError);
      } finally {
        busy = false;
      }
    },
    journal: async () => structuredClone(records),
    async close() {
      if (busy) throw Error("investigation_already_active");
      if (!closed) {
        closed = true;
        try {
          await inferenceRuntime?.close();
        } finally {
          await lease.close();
        }
      }
    },
    async investigate(input) {
      if (busy) throw Error("investigation_already_active");
      if (closed) throw Error("investigator_closed");
      const stopped = records.findLast(
        (r) =>
          validRequest(input) &&
          recoveredIds.has(r.investigationId) &&
          r.chainId === input?.chainId &&
          r.transactionHash?.toLowerCase() ===
            input?.transactionHash?.toLowerCase(),
      );
      if (stopped) {
        busy = true;
        try {
          return await recoverReport(stopped, stateDir, decodeError);
        } finally {
          busy = false;
        }
      }
      busy = true;
      const started = clock();
      let pausedMilliseconds = 0;
      const activeClock = () => clock() - pausedMilliseconds;
      const evidenceValues = new Map();
      let inferenceSession;
      const report = {
        schemaVersion: 1,
        investigationId: randomUUID(),
        chainId: [8453, 84532].includes(input?.chainId)
          ? input.chainId
          : undefined,
        transactionHash:
          typeof input?.transactionHash === "string" &&
          /^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)
            ? input.transactionHash
            : undefined,
        coverage: "supported",
        completion: "partial",
        diagnosis: "insufficient_evidence",
        stoppingReason: "missing_revert_evidence",
        evidence: [],
        observedFacts: [],
        supportedDiagnoses: [],
        hypotheses: [],
        missingEvidence: [],
        uncertainty: [],
        validationFailures: [],
        toolInvocations: 0,
        purchase: {
          paymentMode: "simulated",
          authorizedExposureMinorUnits: 0,
          simulatedMinorUnits: 0,
          liveMinorUnits: 0,
          heldMinorUnits: 0,
        },
        inference: {
          authorizedAllocation: 0,
          locallyRetiredSlots: 0,
          confirmedCommitted: 0,
          unknownOutcomes: 0,
        },
      };
      const checkpointEvidence = async () => {
        records = await persistJournal(
          stateDir,
          journalPath,
          records
            .filter((r) => r.investigationId !== report.investigationId)
            .concat({
              schemaVersion: 1,
              policy: {
                maxTools: 8,
                activeMilliseconds: 120000,
                maxResponseBytes: 4194304,
                maxSummaryBytes: 49152,
                maxInferenceRequests: 3,
                maxSlots: 5,
                investigationChain: report.chainId,
                executionDataPaymentChain: policy?.executionDataPaymentChain,
                inferenceDeployment: policy?.inference?.deploymentDomain,
                serviceClass: policy?.inference?.serviceClass,
              },
              clarificationRounds: report.clarificationRounds ?? 0,
              investigationId: report.investigationId,
              chainId: report.chainId,
              transactionHash: report.transactionHash,
              blockHash: report.blockHash,
              blockNumber: report.blockNumber,
              evidence: structuredClone(report.evidence),
              traceEvidence: report.evidence.filter(
                (e) => e.operation === "call_trace",
              ),
              purchase: structuredClone(report.purchase),
              purchaseAttempts: structuredClone(report.purchaseAttempts ?? []),
              inference: structuredClone(report.inference),
              inferenceAttempts: structuredClone(
                inferenceSession?.attempts ?? [],
              ),
              coverage: report.coverage,
              stoppingReason: report.stoppingReason,
              resolved: false,
            }),
        );
      };
      const finish = async () => {
        report.partialReason =
          report.completion === "partial" ? report.stoppingReason : null;
        report.summary = report.evidence.map((e) => ({
          id: e.id,
          operation: e.operation,
          validation: e.validation,
          omissions: e.omissions,
        }));

        report.text = report.supportedDiagnoses.length
          ? report.supportedDiagnoses[0].text
          : report.observedFacts.length
            ? "The transaction failed. Available evidence does not establish its cause."
            : `Investigation stopped: ${report.stoppingReason}.`;
        const purchaseStatuses =
          report.purchaseAttempts ?? report.unresolvedPurchaseAttempts ?? [];
        if (purchaseStatuses.length) {
          report.text +=
            ` Purchase: ${report.purchase.heldMinorUnits} simulated USDC minor units held; ${report.purchase.simulatedMinorUnits} confirmed. ` +
            purchaseStatuses
              .map((a) => `settlement ${a.settlement}; delivery ${a.delivery}`)
              .join(". ") +
            ".";
        }
        const nextRecords = [
          ...records.filter(
            (r) => r.investigationId !== report.investigationId,
          ),
          {
            schemaVersion: 1,
            chainId: report.chainId,
            transactionHash: report.transactionHash,
            blockHash: report.blockHash,
            blockNumber: report.blockNumber,
            investigationId: report.investigationId,
            policy: {
              maxTools: 8,
              activeMilliseconds: 120000,
              maxResponseBytes: 4194304,
              maxSummaryBytes: 49152,
              investigationChain: report.chainId,
              executionDataPaymentChain: policy?.executionDataPaymentChain,
              inferenceDeployment: policy?.inference?.deploymentDomain,
              serviceClass: policy?.inference?.serviceClass,
              maxInferenceRequests: 3,
              maxSlots: 5,
            },
            coverage: report.coverage,
              stoppingReason: report.stoppingReason,
            clarificationRounds: report.clarificationRounds ?? 0,
            evidence: structuredClone(report.evidence),
            traceEvidence: report.evidence.filter(
              (e) => e.operation === "call_trace",
            ),
            purchase: report.purchase,
            inference: report.inference,
            inferenceAttempts: inferenceSession?.attempts ?? [],
            purchaseAttempts: report.purchaseAttempts ?? [],
            resolved:
              !(report.purchaseAttempts ?? []).some(
                (a) =>
                  a.authorizationExposureMinorUnits > 0 &&
                  a.settlement === "unknown",
              ) &&
              !inferenceSession?.attempts.some(
                (a) => a.state !== "released" && a.outcome === "unknown",
              ),
          },
        ];
        records = await persistJournal(stateDir, journalPath, nextRecords);
        return report;
      };
      try {
        if (!validRequest(input)) {
          report.coverage = "unsupported";
          report.stoppingReason = "invalid_request";
          return await finish();
        }
        if (input.scope && input.scope !== "transaction") {
          report.coverage = "unsupported";
          report.stoppingReason = "unsupported_scope";
          return await finish();
        }
        const unresolved = records.flatMap((r) =>
          r.chainId === input.chainId &&
          r.transactionHash?.toLowerCase() ===
            input.transactionHash.toLowerCase()
            ? (r.purchaseAttempts ?? []).filter(
                (a) =>
                  a.authorizationExposureMinorUnits > 0 &&
                  (a.settlement === "unknown" ||
                    (a.settlement === "confirmed" &&
                      a.delivery !== "validated")),
              )
            : [],
        );
        if (unresolved.length) {
          report.stoppingReason = unresolved.some(
            (a) => a.settlement === "unknown",
          )
            ? "unresolved_purchase"
            : "paid_but_unusable";
          report.unresolvedPurchaseAttempts = structuredClone(unresolved);
          report.purchase.heldMinorUnits = unresolved.reduce(
            (n, a) =>
              n + (a.settlement === "unknown" ? a.reservedMinorUnits : 0),
            0,
          );
          report.purchase.simulatedMinorUnits = unresolved.reduce(
            (n, a) =>
              n + (a.settlement === "confirmed" ? Number(a.terms.amount) : 0),
            0,
          );
          report.purchase.authorizedExposureMinorUnits = unresolved.reduce(
            (n, a) => n + a.authorizationExposureMinorUnits,
            0,
          );
          report.missingEvidence.push(
            "Existing purchase is unresolved or paid without usable delivery; replacement authorization is prohibited.",
          );
          return await finish();
        }
        await checkpointEvidence();
        const invoke = createBoundedRpc(rpc, activeClock, started, report);
        const add = async (operation, value, source = {}) => {
          const id = `e${report.evidence.length + 1}`;
          const contentDigest = digest(value);
          try {
            await mkdir(join(stateDir, "artifacts"), {
              recursive: true,
              mode: 0o700,
            });
            await writeFile(
              join(
                stateDir,
                "artifacts",
                `${report.investigationId}-${id}.json`,
              ),
              JSON.stringify(value),
              { mode: 0o600 },
            );
          } catch {
            throw Error("local_persistence_failed");
          }
          if (source.rawEvidence !== undefined) {
            try {
              await writeFile(
                join(
                  stateDir,
                  "artifacts",
                  `${report.investigationId}-${id}.raw.json`,
                ),
                JSON.stringify(source.rawEvidence),
                { mode: 0o600 },
              );
            } catch {
              throw Error("local_persistence_failed");
            }
          }
          evidenceValues.set(id, value);
          report.evidence.push({
            id,
            origin: source.origin ?? "configured_rpc",
            operation,
            ...(operation === "call_trace"
              ? { requestBinding: structuredClone(value.binding) }
              : {}),
            contentDigest,
            ...(source.rawEvidence !== undefined
              ? {
                  rawContentDigest: digest(source.rawEvidence),
                  rawArtifact: `${report.investigationId}-${id}.raw.json`,
                }
              : {}),
            transactionHash: input.transactionHash,
            chainId: input.chainId,
            blockNumber: report.blockNumber,
            blockHash: report.blockHash,
            provenance: source.provenance ?? rpc.provenance ?? "synthetic",
            validation: "valid",
            omissions:
              operation === "receipt" &&
              Buffer.byteLength(JSON.stringify(value.logs)) > 16384
                ? ["logs"]
                : [],
          });
          await checkpointEvidence();
          return id;
        };
        const tx = await invoke("transaction", input.transactionHash);
        if (!tx) {
          report.coverage = "unsupported";
          report.stoppingReason = "transaction_not_found";
          return await finish();
        }
        if (tx.blockHash == null || tx.blockNumber == null) {
          report.coverage = "unsupported";
          report.stoppingReason = "pending_transaction";
          return await finish();
        }
        try { validateExecutionEvidence("transaction", tx, input, decodeError); }
        catch { throw Error("inconsistent_transaction"); }
        const receipt = await invoke("receipt", input.transactionHash);
        if (!receipt) throw Error("missing_receipt");
        const binding = { ...input, blockHash: tx.blockHash, blockNumber: tx.blockNumber };
        try { validateExecutionEvidence("receipt", receipt, binding, decodeError, { allowSuccessful: true }); }
        catch (error) { if (error.message === "invalid_receipt") throw error; throw Error("inconsistent_receipt"); }
        if (receipt.status === "0x1") {
          report.coverage = "unsupported";
          report.stoppingReason = "successful_transaction";
          return await finish();
        }
        if (receipt.status !== "0x0" || !Array.isArray(receipt.logs))
          throw Error("invalid_receipt");
        report.blockNumber = tx.blockNumber;
        report.blockHash = tx.blockHash;
        const block = await invoke("block", tx.blockNumber);
        try { validateExecutionEvidence("block", block, binding, decodeError); }
        catch { throw Error("inconsistent_block"); }
        await add("transaction", tx);
        const receiptId = await add("receipt", receipt);
        await add("block", block);
        report.observedFacts.push({
          value: "failed",
          text: "Receipt records failed execution.",
          evidenceIds: [receiptId],
          field: "status",
        });
        report.missingEvidence.push(
          "Validated revert data or call trace explaining failure.",
        );
        if (rpc.revert) {
          try {
            const revert = await invoke("revert", {
              transactionHash: input.transactionHash,
              blockNumber: tx.blockNumber,
              blockHash: tx.blockHash,
            });
            try { validateExecutionEvidence("revert", revert, binding, decodeError); }
            catch (error) { if (error.message === "invalid_revert_decoding") throw error; throw Error("invalid_revert_binding"); }
            const decoded = decodeError(revert.data);
            const id = await add(revert.kind, revert, { origin: revert.origin, provenance: revert.provenance });
            report.observedFacts.push({
              value: decoded,
              text: `${revert.kind === "original_execution" ? "Original execution" : "Historical replay"} returned Error(${JSON.stringify(decoded)}).`,
              evidenceIds: [id],
              field: "data",
            });
            if (revert.kind === "historical_replay")
              report.uncertainty.push(
                "Replay uses end-of-block state; it does not establish the original transaction failure cause.",
              );
          } catch (e) {
            if (e.message === "local_persistence_failed") throw e;
            recordEvidenceFailure(report, e);
          }
        }
        const previous = records.findLast(
          (r) =>
            r.chainId === input.chainId &&
            r.transactionHash === input.transactionHash &&
            r.blockHash === report.blockHash &&
            (r.purchaseAttempts ?? []).some((a) => a.delivery === "validated"),
        );
        let reusable;
        const old = previous?.traceEvidence?.find(
          (e) => e.operation === "call_trace" && e.validation === "valid",
        );
        if (old) {
          try {
            const { value, rawEvidence } = await validatedArtifact(
              previous,
              old,
              stateDir,
              decodeError,
            );
            reusable = { value, source: { ...old, rawEvidence } };
          } catch {}
        }
        await acquireTrace({
          policy,
          provider,
          input,
          report,
          add,
          decodeError,
          clock,
          started,
          reusable,
          reserveTools: inferenceFactory && policy?.inference ? 2 : 1,
          invoke: createBoundedRpc(provider, clock, started, report),
          priorExposure: records
            .filter((r) => r.investigationId !== report.investigationId)
            .reduce(
              (sum, r) =>
                sum +
                (r.purchaseAttempts ?? [])
                  .filter((a) => a.settlement === "unknown")
                  .reduce(
                    (n, a) => n + (a.authorizationExposureMinorUnits ?? 0),
                    0,
                  ),
              0,
            ),
          persist: async () => {
            records = await persistJournal(
              stateDir,
              journalPath,
              records
                .filter((r) => r.investigationId !== report.investigationId)
                .concat({
                  schemaVersion: 1,
                  policy: {
                    maxTools: 8,
                    activeMilliseconds: 120000,
                    maxResponseBytes: 4194304,
                    maxSummaryBytes: 49152,
                    maxInferenceRequests: 3,
                    maxSlots: 5,
                    investigationChain: report.chainId,
                    executionDataPaymentChain:
                      policy?.executionDataPaymentChain,
                    inferenceDeployment: policy?.inference?.deploymentDomain,
                    serviceClass: policy?.inference?.serviceClass,
                  },
                  clarificationRounds: report.clarificationRounds ?? 0,
                  investigationId: report.investigationId,
                  chainId: report.chainId,
                  transactionHash: report.transactionHash,
                  blockHash: report.blockHash,
                  blockNumber: report.blockNumber,
                  purchase: structuredClone(report.purchase),
                  purchaseAttempts: structuredClone(report.purchaseAttempts),
                  evidence: structuredClone(report.evidence),
                  resolved: false,
                }),
            );
          },
        });
        if (inferenceFactory && policy?.inference) {
          await openInference();
          inferenceSession = createInferenceSession({
            policy: policy.inference,
            clock: activeClock,
            wallClock: clock,
            started,
            report,
            evidenceValues,
            toolLoop: createToolLoop({
              report,
              clock: activeClock,
              started,
              operations: {
                ...Object.fromEntries(
                  ["transaction", "receipt", "block", "revert"]
                    .filter((name) => typeof rpc[name] === "function")
                    .map((name) => [
                      name,
                      async () => {
                        const value = await invoke(
                          name,
                          name === "block"
                            ? tx.blockNumber
                            : name === "revert"
                              ? {
                                  transactionHash: input.transactionHash,
                                  blockNumber: tx.blockNumber,
                                  blockHash: tx.blockHash,
                                }
                              : input.transactionHash,
                          { counted: true },
                        );
                        try { validateExecutionEvidence(name, value, binding, decodeError); }
                        catch { throw Error("invalid_evidence"); }
                        const id = await add(
                          name === "revert" ? value.kind : name,
                          value,
                        );
                        if (name === "revert") {
                          report.observedFacts.push({
                            value: decodeError(value.data),
                            text: `${value.kind === "original_execution" ? "Original execution" : "Historical replay"} returned Error(${JSON.stringify(decodeError(value.data))}).`,
                            evidenceIds: [id],
                            field: "data",
                          });
                          if (value.kind === "historical_replay")
                            report.uncertainty.push(
                              "Replay uses end-of-block state; it does not establish the original transaction failure cause.",
                            );
                        }
                        return { evidenceId: id };
                      },
                    ]),
                ),
                ...(typeof clarification === "function"
                  ? {
                      clarify: async ({ question }) => {
                        if ((report.clarificationRounds ?? 0) >= 1)
                          throw Error("clarification_limit");
                        report.clarificationRounds = 1;
                        const pauseStarted = clock();
                        let reply;
                        try {
                          reply = await clarification({
                            question,
                            investigationId: report.investigationId,
                          });
                        } catch {
                          reply = undefined;
                        } finally {
                          pausedMilliseconds += Math.max(
                            0,
                            clock() - pauseStarted,
                          );
                        }
                        if (activeClock() - started >= 120000)
                          throw Error("deadline_exceeded");
                        let canonical;
                        try {
                          canonical = await invoke("block", tx.blockNumber);
                        } catch (error) {
                          report.evidence.forEach(
                            (e) => (e.validation = "invalid"),
                          );
                          report.observedFacts = [];
                          report.supportedDiagnoses = [];
                          report.hypotheses = [];
                          report.suggestedChecks = [];
                          delete report.failingCall;
                          report.diagnosis = "insufficient_evidence";
                          report.completion = "partial";
                          throw Error(
                            error.message === "deadline_exceeded"
                              ? "deadline_exceeded"
                              : "canonical_revalidation_unavailable",
                          );
                        }
                        if (
                          !sameIdentity(canonical?.hash, tx.blockHash) ||
                          !sameIdentity(canonical?.number, tx.blockNumber)
                        ) {
                          report.evidence.forEach(
                            (e) => (e.validation = "invalid"),
                          );
                          report.observedFacts = [];
                          report.supportedDiagnoses = [];
                          report.hypotheses = [];
                          report.suggestedChecks = [];
                          delete report.failingCall;
                          report.diagnosis = "insufficient_evidence";
                          report.completion = "partial";
                          report.validationFailures.push(
                            "block_binding_changed",
                          );
                          throw Error("reorganization");
                        }
                        if (
                          typeof reply !== "string" ||
                          Buffer.byteLength(reply) > 2048
                        )
                          throw Error("invalid_clarification");
                        return { clarification: reply };
                      },
                    }
                  : {}),
              },
            }),
            inferenceFactory: async () => inferenceRuntime,
            persist: async (inferenceAttempts) => {
              const record = {
                schemaVersion: 1,
                investigationId: report.investigationId,
                policy: {
                  investigationChain: input.chainId,
                  executionDataPaymentChain: policy.executionDataPaymentChain,
                  inferenceDeployment: policy.inference.deploymentDomain,
                  serviceClass: policy.inference.serviceClass,
                  maxInferenceRequests: 3,
                  maxSlots: 5,
                  activeMilliseconds: 120000,
                },
                clarificationRounds: report.clarificationRounds ?? 0,
                chainId: report.chainId,
                transactionHash: report.transactionHash,
                blockHash: report.blockHash,
                blockNumber: report.blockNumber,
                evidence: structuredClone(report.evidence),
                traceEvidence: report.evidence.filter(
                  (e) => e.operation === "call_trace",
                ),
                inference: structuredClone(report.inference),
                inferenceAttempts: structuredClone(inferenceAttempts),
                purchase: structuredClone(report.purchase),
                purchaseAttempts: structuredClone(
                  report.purchaseAttempts ?? [],
                ),
                resolved: false,
              };
              records = await persistJournal(
                stateDir,
                journalPath,
                records
                  .filter((r) => r.investigationId !== report.investigationId)
                  .concat(record),
              );
            },
          });
          activeInference = inferenceSession;
          try {
            await inferenceSession.interpret(input);
          } catch (error) {
            if (error.message === "local_persistence_failed") throw error;
            const reasons = [
              "deadline_exceeded",
              "tool_limit",
              "inference_reserve_unavailable",
              "inference_body_limit",
              "inference_service_class_refused",
              "inference_terms_refused",
              "inference_terms_changed",
              "inference_request_changed",
              "model_override",
              "inference_redirect_refused",
              "inference_config_refused",
              "invalid_model_report",
              "model_tool_reserve_unavailable",
              "reorganization",
              "canonical_revalidation_unavailable",
            ];
            report.stoppingReason = reasons.includes(error.message)
              ? error.message
              : "inference_unavailable";
            report.completion = "partial";
            report.validationFailures.push(report.stoppingReason);
            if (
              ["reorganization", "canonical_revalidation_unavailable"].includes(
                error.message,
              )
            )
              return await finish();
          }
        }
        let finalBlock;
        try {
          finalBlock = await invoke("block", tx.blockNumber);
        } catch (error) {
          report.evidence.forEach((e) => (e.validation = "invalid"));
          report.observedFacts = [];
          report.supportedDiagnoses = [];
          report.diagnosis = "insufficient_evidence";
          report.completion = "partial";
          report.hypotheses = [];
          report.suggestedChecks = [];
          delete report.failingCall;
          report.uncertainty.push(
            "Canonical block could not be revalidated; collected facts are unavailable.",
          );
          throw error;
        }
        if (
          !sameIdentity(finalBlock?.hash, tx.blockHash) ||
          !sameIdentity(finalBlock?.number, tx.blockNumber)
        ) {
          report.evidence.forEach((e) => (e.validation = "invalid"));
          report.observedFacts = [];
          report.supportedDiagnoses = [];
          report.diagnosis = "insufficient_evidence";
          report.completion = "partial";
          report.hypotheses = [];
          report.suggestedChecks = [];
          delete report.failingCall;
          report.stoppingReason = "reorganization";
          report.validationFailures.push("block_binding_changed");
        }
        return await finish();
      } catch (e) {
        if (closed || e.message === "local_persistence_failed") throw e;
        const allowed = [
          "deadline_exceeded",
          "tool_limit",
          "inconsistent_transaction",
          "inconsistent_receipt",
          "missing_receipt",
          "invalid_receipt",
          "inconsistent_block",
          "invalid_revert_binding",
          "invalid_revert_decoding",
          "evidence_size_limit",
          "invalid_evidence_json",
          "slot_ledger_recovery_required",
        ];
        const reason = allowed.includes(e.message)
          ? e.message
          : "rpc_unavailable";
        report.stoppingReason = reason;
        report.missingEvidence.push(
          "Public execution evidence unavailable or invalid.",
        );
        report.validationFailures.push(reason);
        return await finish();
      } finally {
        activeInference = undefined;
        busy = false;
      }
    },
  };
}
async function bounded(value, checkDeadline) {
  if (value && typeof value[Symbol.asyncIterator] === "function") {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of value) {
      checkDeadline();
      const part = Buffer.from(chunk);
      bytes += part.length;
      if (bytes > 4194304) throw Error("evidence_size_limit");
      chunks.push(part);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Error("invalid_evidence_json");
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 4194304)
    throw Error("evidence_size_limit");
  return value;
}

function decodeError(data) {
  if (
    typeof data !== "string" ||
    !/^0x08c379a0[0-9a-f]*$/i.test(data) ||
    data.length < 138 ||
    data.length % 2 !== 0
  )
    throw Error("invalid_revert_decoding");
  const bytes = Buffer.from(data.slice(10), "hex");
  if (
    bytes.length < 64 ||
    BigInt("0x" + bytes.subarray(0, 32).toString("hex")) !== 32n
  )
    throw Error("invalid_revert_decoding");
  const length = BigInt("0x" + bytes.subarray(32, 64).toString("hex"));
  if (length > 2048n || 64n + length > BigInt(bytes.length))
    throw Error("invalid_revert_decoding");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(64, 64 + Number(length)),
  );
  if (
    bytes.length !== 64 + Math.ceil(Number(length) / 32) * 32 ||
    bytes.subarray(64 + Number(length)).some((x) => x !== 0)
  )
    throw Error("invalid_revert_decoding");
  return text;
}

function recordEvidenceFailure(report, error) {
  const allowed = [
    "deadline_exceeded",
    "tool_limit",
    "invalid_revert_binding",
    "invalid_revert_decoding",
    "evidence_size_limit",
    "invalid_evidence_json",
  ];
  const reason = allowed.includes(error.message)
    ? error.message
    : "rpc_unavailable";
  report.stoppingReason = reason;
  report.validationFailures.push(reason);
  report.missingEvidence.push(
    "Public execution evidence unavailable or invalid.",
  );
}

function validRequest(input) {
  const keys = [
    "schemaVersion",
    "chainId",
    "transactionHash",
    "clarification",
    "scope",
  ];
  return (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).every((k) => keys.includes(k)) &&
    input.schemaVersion === 1 &&
    [8453, 84532].includes(input.chainId) &&
    typeof input.transactionHash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(input.transactionHash) &&
    (input.clarification === undefined ||
      (typeof input.clarification === "string" &&
        Buffer.byteLength(input.clarification) <= 2048))
  );
}
function createBoundedRpc(rpc, clock, started, report) {
  return async (operation, arg, { counted = false } = {}) => {
    if (clock() - started >= 120000) throw Error("deadline_exceeded");
    if (!counted && report.toolInvocations >= 8) throw Error("tool_limit");
    if (!counted) report.toolInvocations++;
    const remaining = 120000 - (clock() - started),
      controller = new AbortController();
    let timeout;
    try {
      const value = await Promise.race([
        Promise.resolve(
          rpc[operation](arg, { signal: controller.signal }),
        ).then((value) =>
          bounded(value, () => {
            if (clock() - started >= 120000) throw Error("deadline_exceeded");
          }),
        ),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(Error("deadline_exceeded"));
          }, remaining);
        }),
      ]);
      if (clock() - started >= 120000) throw Error("deadline_exceeded");
      return value;
    } finally {
      clearTimeout(timeout);
    }
  };
}
async function persistJournal(stateDir, journalPath, nextRecords) {
  const staged = nextRecords
    .filter((r) => !r.resolved)
    .concat(nextRecords.filter((r) => r.resolved).slice(-100));
  const temporary = join(stateDir, `${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(staged));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, journalPath);
    const directory = await open(stateDir, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    await unlink(temporary).catch(() => {});
    throw Error("local_persistence_failed");
  }
  const keep = new Set(staged.map((r) => r.investigationId));
  try {
    for (const file of await readdir(join(stateDir, "artifacts"))) {
      if (![...keep].some((id) => file.startsWith(id + "-")))
        await unlink(join(stateDir, "artifacts", file));
    }
  } catch {
    /* Cleanup cannot undo the durable replacement. */
  }
  return staged;
}
