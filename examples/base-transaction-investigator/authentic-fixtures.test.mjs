import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInvestigator } from "./investigator.mjs";

const readFixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const manifest = await readFixture("execution-manifest.json");

async function investigate(t, fixture, { trace = true } = {}) {
  const counts = {
    rpc: 0,
    quotes: 0,
    acquisitions: 0,
    signatures: 0,
    inference: 0,
  };
  const endpoint = "https://fixture.invalid/authentic-trace";
  const asset = "0x" + "66".repeat(20),
    payee = "0x" + "77".repeat(20);
  const runtime = await createInvestigator({
    stateDir: await mkdtemp(join(tmpdir(), "authentic-investigation-")),
    rpc: {
      provenance: "recorded_authentic",
      transaction: async () => {
        counts.rpc++;
        return fixture.transaction;
      },
      receipt: async () => {
        counts.rpc++;
        return fixture.receipt;
      },
      block: async () => {
        counts.rpc++;
        return fixture.block;
      },
    },
    ...(trace
      ? {
          policy: {
            executionDataPaymentChain: 84532,
            trace: { endpoint, method: "POST", asset, payee },
          },
          provider: {
            paymentMode: "simulated",
            provenance: "recorded_authentic",
            quote: async (request) => {
              counts.quotes++;
              return {
                endpoint,
                method: "POST",
                request,
                scheme: "exact",
                network: "eip155:84532",
                asset,
                payTo: payee,
                amount: "1000",
                assetTransferMethod: "eip3009",
                expiresAt: Math.floor(Date.now() / 1000) + 60,
              };
            },
            acquire: async ({ attemptId, terms }) => {
              counts.acquisitions++;
              return {
                trace: fixture.trace,
                settlementObservation: {
                  attemptId,
                  terms,
                  outcome: "confirmed",
                },
              };
            },
          },
        }
      : {}),
    signer: () => {
      counts.signatures++;
      throw Error("signing forbidden");
    },
    inferenceFactory: async () => {
      counts.inference++;
      throw Error("inference forbidden");
    },
  });
  t.after(() => runtime.close());
  const input = {
    schemaVersion: 1,
    chainId: 8453,
    transactionHash: fixture.transaction.hash,
  };
  const report = await runtime.investigate(input);
  assert.deepEqual(report.inference, {
    authorizedAllocation: 0,
    locallyRetiredSlots: 0,
    confirmedCommitted: 0,
    unknownOutcomes: 0,
  });
  return { runtime, input, counts, report };
}

test("authentic execution recordings retain exact bytes and chain/transaction/block bindings", async () => {
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(
      new URL(`./fixtures/${artifact.artifact}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      artifact.sha256,
    );
  }
  for (const entry of manifest.cases.filter((c) => c.rawArtifact)) {
    const fixture = await readFixture(entry.fixture),
      raw = await readFixture(entry.rawArtifact);
    assert.equal(Number(raw.network_id), entry.chainId);
    assert.equal(raw.hash, entry.transactionHash);
    assert.equal(raw.block_hash, entry.blockHash);
    assert.equal(raw.block_number, Number(entry.blockNumber));
    assert.equal(raw.status, false);
    assert.equal(fixture.transaction.hash, entry.transactionHash);
    assert.equal(Number(fixture.transaction.chainId), entry.chainId);
    assert.equal(fixture.transaction.blockHash, entry.blockHash);
    assert.equal(fixture.transaction.blockNumber, entry.blockNumber);
    assert.equal(fixture.receipt.transactionHash, entry.transactionHash);
    assert.equal(fixture.receipt.status, "0x0");
    assert.equal(fixture.receipt.blockHash, entry.blockHash);
    assert.equal(fixture.receipt.blockNumber, entry.blockNumber);
    assert.equal(fixture.block.hash, entry.blockHash);
    assert.equal(fixture.block.number, entry.blockNumber);
    assert.equal(fixture.trace.transactionHash, entry.transactionHash);
    assert.equal(fixture.trace.chainId, entry.chainId);
    assert.equal(fixture.trace.blockHash, entry.blockHash);
    assert.equal(fixture.trace.blockNumber, entry.blockNumber);
    // Every normalized call must be the recorded call at that exact trace path.
    let nodes = 0;
    const visit = (node, path) => {
      nodes++;
      const recorded = raw.call_trace.find(
        (call) =>
          JSON.stringify(call.trace_address ?? []) === JSON.stringify(path),
      );
      assert.ok(recorded);
      assert.equal(node.type, recorded.call_type);
      for (const field of ["from", "to", "input", "output", "error"])
        assert.equal(node[field], recorded[field]);
      (node.calls ?? []).forEach((child, index) =>
        visit(child, [...path, index]),
      );
    };
    visit(fixture.trace.trace, []);
    assert.equal(nodes, raw.call_trace.length);
  }
});

test("authentic nested failure produces a cited diagnosis with simulated accounting and durable reuse", async (t) => {
  const fixture = await readFixture("authentic-nested-failure.json");
  const { runtime, input, counts, report } = await investigate(t, fixture);
  assert.equal(report.coverage, "supported");
  assert.equal(report.diagnosis, "supported");
  assert.equal(report.stoppingReason, "trace_evidence_validated");
  assert.equal(report.failingCall.reference, "calls.0.calls.0.calls.0");
  assert.match(report.supportedDiagnoses[0].text, /p address!/);
  assert.match(report.supportedDiagnoses[0].text, /not its underlying cause/);
  const evidence = report.evidence.find(
    (e) => e.id === report.failingCall.evidenceId,
  );
  assert.equal(evidence.provenance, "recorded_authentic");
  assert.equal(evidence.validation, "valid");
  assert.equal(evidence.blockHash, fixture.block.hash);
  assert.equal(report.purchaseAttempts[0].paymentMode, "simulated");
  assert.equal(report.purchaseAttempts[0].delivery, "validated");
  assert.equal(report.purchaseAttempts[0].settlement, "confirmed");
  assert.equal(report.purchase.simulatedMinorUnits, 1000);
  assert.equal(report.purchase.liveMinorUnits, 0);
  assert.equal(
    (await runtime.journal())[0].purchaseAttempts[0].delivery,
    "validated",
  );
  const reused = await runtime.investigate(input);
  assert.equal(reused.failingCall.reference, report.failingCall.reference);
  assert.deepEqual(counts, {
    rpc: 8,
    quotes: 1,
    acquisitions: 1,
    signatures: 0,
    inference: 0,
  });
});

test("authentic execution error supports out-of-gas from original trace rather than gas consumption", async (t) => {
  const fixture = await readFixture("authentic-execution-error.json");
  const { runtime, counts, report } = await investigate(t, fixture);
  assert.equal(report.diagnosis, "supported");
  assert.equal(report.failingCall.reference, "root");
  assert.equal(
    report.observedFacts.find((f) => f.field === "root.error").value,
    "out of gas",
  );
  assert.match(report.supportedDiagnoses[0].text, /out of gas/);
  assert.equal(report.purchaseAttempts[0].delivery, "validated");
  assert.equal(report.purchase.simulatedMinorUnits, 1000);
  assert.equal(report.purchase.liveMinorUnits, 0);
  assert.equal(
    (await runtime.journal())[0].purchaseAttempts[0].settlement,
    "confirmed",
  );
  assert.deepEqual(counts, {
    rpc: 4,
    quotes: 1,
    acquisitions: 1,
    signatures: 0,
    inference: 0,
  });
});

test("authentic unverified contract still yields standard revert bytes without source-level causal claims", async (t) => {
  const metadata = await readFixture("tenderly-unverified-contract.raw.json");
  assert.equal(metadata.type, "unverified_contract");
  assert.equal(metadata.network_id, "8453");
  assert.equal(metadata.address, "0x06596d58d6641fe51ed768f67f919e896838fe87");
  assert.equal(metadata.verification_date, null);
  assert.equal(metadata.data, null);
  const fixture = await readFixture("authentic-nested-failure.json");
  assert.equal(
    fixture.trace.trace.calls[0].calls[0].calls[0].to,
    metadata.address,
  );
  assert.equal(
    fixture.trace.trace.calls[0].calls[0].input.slice(0, 10),
    "0x23b872dd",
  );
  const { report, counts, runtime } = await investigate(t, fixture);
  assert.match(report.supportedDiagnoses[0].text, /p address!/);
  assert.doesNotMatch(
    JSON.stringify(report.supportedDiagnoses),
    /insufficient balance|allowance|blacklist/i,
  );
  assert.equal(report.purchaseAttempts[0].delivery, "validated");
  assert.equal(
    (await runtime.journal())[0].purchaseAttempts[0].delivery,
    "validated",
  );
  assert.deepEqual(counts, {
    rpc: 4,
    quotes: 1,
    acquisitions: 1,
    signatures: 0,
    inference: 0,
  });
});

test("authentic failed receipt with unavailable original trace stays partial without authorization", async (t) => {
  const fixture = await readFixture("recorded-revert.json");
  assert.equal(fixture.traceUnavailable.code, -32601);
  const { report, runtime, counts } = await investigate(t, fixture, {
    trace: false,
  });
  assert.equal(report.diagnosis, "insufficient_evidence");
  assert.equal(report.completion, "partial");
  assert.equal(report.supportedDiagnoses.length, 0);
  assert.equal(report.purchaseAttempts.length, 0);
  assert.equal((await runtime.journal())[0].purchaseAttempts.length, 0);
  assert.deepEqual(counts, {
    rpc: 4,
    quotes: 0,
    acquisitions: 0,
    signatures: 0,
    inference: 0,
  });
});
