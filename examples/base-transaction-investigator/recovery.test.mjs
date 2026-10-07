import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInvestigator } from "./investigator.mjs";
test("live owner cannot be displaced even by an offline recovery runtime", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-owner-"));
  const owner = await createInvestigator({ stateDir });
  try {
    await assert.rejects(createInvestigator({ stateDir }), /owned/);
  } finally {
    await owner.close();
  }
  const recovered = await createInvestigator({ stateDir });
  await recovered.close();
});
const hash = "0x" + "11".repeat(32),
  blockHash = "0x" + "22".repeat(32);
const input = { schemaVersion: 1, chainId: 8453, transactionHash: hash };
const rpc = {
  transaction: async () => ({
    hash,
    chainId: "0x2105",
    blockNumber: "0x1",
    blockHash,
  }),
  receipt: async () => ({
    transactionHash: hash,
    status: "0x0",
    blockNumber: "0x1",
    blockHash,
    logs: [],
  }),
  block: async () => ({ number: "0x1", hash: blockHash }),
};
test("restart returns bound factual local report without opening authorizing runtime or invoking external operations", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-recover-"));
  const first = await createInvestigator({ stateDir, rpc });
  const original = await first.investigate(input);
  await first.close();
  let opened = 0,
    invocations = 0;
  const restarted = await createInvestigator({
    stateDir,
    policy: { inference: {} },
    inferenceFactory: async () => {
      opened++;
      throw Error("forbidden");
    },
    rpc: new Proxy(
      {},
      {
        get() {
          return () => {
            invocations++;
            throw Error("forbidden");
          };
        },
      },
    ),
  });
  try {
    const report = await restarted.recover(original.investigationId);
    assert.equal(report.transactionHash, hash);
    assert.equal(report.blockHash, blockHash);
    assert.equal(report.completion, "partial");
    assert.equal(report.stoppingReason, "recovered_stopped");
    assert.equal(report.observedFacts[0].value, "failed");
    assert.equal(opened, 0);
    assert.equal(invocations, 0);
    assert.match(report.uncertainty.join(" "), /canonical/i);
  } finally {
    await restarted.close();
  }
});
test("missing local receipt creates an explicit gap and cannot reproduce a failed-execution fact", async () => {
  const { unlink } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-corrupt-"));
  const first = await createInvestigator({ stateDir, rpc });
  const original = await first.investigate(input);
  await first.close();
  await unlink(
    join(stateDir, "artifacts", `${original.investigationId}-e2.json`),
  );
  const runtime = await createInvestigator({ stateDir });
  try {
    const r = await runtime.recover(original.investigationId);
    assert.equal(r.observedFacts.length, 0);
    assert.ok(r.missingEvidence.some((g) => g.includes("e2")));
    assert.equal(r.evidence.length, 2);
  } finally {
    await runtime.close();
  }
});
test("interruption before authorization still leaves transaction-bound local evidence recoverable", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-checkpoint-"));
  let release;
  const runtime = await createInvestigator({
    stateDir,
    rpc: {
      ...rpc,
      transaction: async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const pending = runtime.investigate(input);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  try {
    const journal = await runtime.journal();
    assert.equal(journal.length, 1);
    assert.equal(journal[0].transactionHash, hash);
  } finally {
    release(await rpc.transaction());
    await pending;
    await runtime.close();
  }
});
for (const [stage, expected] of [
  [
    "before_reservation",
    { allocated: 0, retired: 0, confirmed: 0, unknown: 0 },
  ],
  ["after_reservation", { allocated: 1, retired: 0, confirmed: 0, unknown: 1 }],
  ["after_proof", { allocated: 1, retired: 0, confirmed: 0, unknown: 1 }],
  ["after_retirement", { allocated: 1, retired: 1, confirmed: 0, unknown: 1 }],
  [
    "after_authorization",
    { allocated: 1, retired: 1, confirmed: 0, unknown: 1 },
  ],
  ["after_outcome", { allocated: 1, retired: 1, confirmed: 1, unknown: 0 }],
]) {
  test(
    `cross-process ${stage} crash preserves allocation and factual report without restart authorization`,
    { timeout: 10000 },
    async () => {
      const { fork } = await import("node:child_process");
      const { once } = await import("node:events");
      const stateDir = await mkdtemp(join(tmpdir(), "investigator-crash-"));
      const child = fork(
        new URL("./test-support/crash-worker.mjs", import.meta.url),
        [stateDir, stage],
        { stdio: ["ignore", "ignore", "pipe", "ipc"] },
      );
      let stderr = "";
      child.stderr.on("data", (data) => (stderr += data));
      try {
        await new Promise((resolve, reject) => {
          child.on("message", (m) => {
            if (m.stage === stage) resolve();
          });
          child.on("exit", (code) =>
            reject(Error(`worker exited ${code}: ${stderr}`)),
          );
        });
        await assert.rejects(createInvestigator({ stateDir }), /owned/);
        const exit = once(child, "exit");
        child.kill("SIGKILL");
        await exit;
        let opened = 0,
          external = 0;
        const forbidden = () => {
          external++;
          throw Error("forbidden");
        };
        const runtime = await createInvestigator({
          stateDir,
          rpc: new Proxy({}, { get: () => forbidden }),
          provider: { quote: forbidden, acquire: forbidden },
          prover: forbidden,
          signer: forbidden,
          policy: { inference: {} },
          inferenceFactory: async () => {
            opened++;
            throw Error("forbidden");
          },
        });
        try {
          const journal = await runtime.journal();
          assert.equal(journal.length, 1);
          const report = await runtime.recover(journal[0].investigationId);
          assert.equal(report.chainId, 8453);
          assert.equal(report.blockHash, blockHash);
          assert.equal(report.observedFacts[0].value, "failed");
          assert.equal(
            report.inference.authorizedAllocation,
            expected.allocated,
          );
          assert.equal(report.inference.locallyRetiredSlots, expected.retired);
          assert.equal(report.inference.confirmedCommitted, expected.confirmed);
          assert.equal(report.inference.unknownOutcomes, expected.unknown);
          assert.equal(report.toolInvocations, 0);
          assert.equal(opened, 0);
          assert.equal(external, 0);
          const again = await runtime.investigate(input);
          assert.equal(again.investigationId, report.investigationId);
          assert.equal(opened, 0);
        } finally {
          await runtime.close();
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }
    },
  );
}
test("journal is private and bounded while unresolved purchase reservations survive retention", async () => {
  const { stat } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-retention-"));
  const asset = "0x" + "66".repeat(20),
    payee = "0x" + "77".repeat(20),
    endpoint = "https://fixture.invalid/trace";
  const runtime = await createInvestigator({
    stateDir,
    rpc,
    policy: {
      executionDataPaymentChain: 84532,
      trace: { endpoint, method: "POST", asset, payee },
    },
    provider: {
      paymentMode: "simulated",
      quote: async (request) => ({
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
      }),
      acquire: async () => {
        throw Error("lost response");
      },
    },
  });
  const unknown = await runtime.investigate(input);
  for (let i = 0; i < 103; i++) await runtime.investigate({ schemaVersion: 1 });
  const journal = await runtime.journal();
  assert.equal(journal.length, 101);
  assert.ok(journal.some((r) => r.investigationId === unknown.investigationId));
  assert.equal((await stat(stateDir)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(join(stateDir, "journal.json"))).mode & 0o777,
    0o600,
  );
  await runtime.close();
  const recovered = await createInvestigator({ stateDir });
  try {
    const report = await recovered.recover(unknown.investigationId);
    assert.equal(report.purchase.heldMinorUnits, 1000);
    assert.equal(report.purchase.simulatedMinorUnits, 0);
    assert.equal(report.purchaseAttempts[0].settlement, "unknown");
  } finally {
    await recovered.close();
  }
});
test("trace recovery revalidates actual raw tree against full accepted request and detects corruption", async () => {
  const { writeFile } = await import("node:fs/promises");
  const stateDir = await mkdtemp(
    join(tmpdir(), "investigator-trace-recovery-"),
  );
  const endpoint = "https://fixture.invalid/trace",
    asset = "0x" + "66".repeat(20),
    payee = "0x" + "77".repeat(20);
  const runtime = await createInvestigator({
    stateDir,
    rpc,
    policy: {
      executionDataPaymentChain: 84532,
      trace: { endpoint, method: "POST", asset, payee },
    },
    provider: {
      paymentMode: "simulated",
      quote: async (request) => ({
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
      }),
      acquire: async ({ attemptId, terms }) => ({
        settlementObservation: { attemptId, terms, outcome: "confirmed" },
        trace: {
          type: "CALL",
          from: "0x" + "33".repeat(20),
          to: "0x" + "44".repeat(20),
          error: "execution reverted",
        },
      }),
    },
  });
  const original = await runtime.investigate(input);
  await runtime.close();
  const restored = await createInvestigator({ stateDir });
  try {
    const report = await restored.recover(original.investigationId);
    assert.ok(report.evidence.some((e) => e.operation === "call_trace"));
    assert.ok(
      report.observedFacts.some((f) => f.value === "execution reverted"),
    );
    const trace = report.evidence.find((e) => e.operation === "call_trace");
    await writeFile(join(stateDir, "artifacts", trace.rawArtifact), "{}");
    const corrupt = await restored.recover(original.investigationId);
    assert.ok(corrupt.missingEvidence.some((g) => g.includes(trace.id)));
    assert.ok(
      !corrupt.observedFacts.some((f) => f.value === "execution reverted"),
    );
    assert.equal(corrupt.purchase.simulatedMinorUnits, 1000);
  } finally {
    await restored.close();
  }
});
test(
  "cross-process exposed purchase crash retains held amount and stops replacement acquisition",
  { timeout: 10000 },
  async () => {
    const { fork } = await import("node:child_process");
    const { once } = await import("node:events");
    const stateDir = await mkdtemp(
      join(tmpdir(), "investigator-purchase-crash-"),
    );
    const child = fork(
      new URL("./test-support/crash-worker.mjs", import.meta.url),
      [stateDir, "purchase_exposure"],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    try {
      await new Promise((resolve, reject) => {
        child.on("message", (m) => {
          if (m.stage === "purchase_exposure") resolve();
        });
        child.on("exit", () => reject(Error("worker exited early")));
      });
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
      let calls = 0;
      const forbidden = () => {
        calls++;
        throw Error("forbidden");
      };
      const runtime = await createInvestigator({
        stateDir,
        provider: { quote: forbidden, acquire: forbidden },
        signer: forbidden,
        prover: forbidden,
      });
      try {
        const report = await runtime.investigate(input);
        assert.equal(report.stoppingReason, "recovered_stopped");
        assert.equal(report.purchase.heldMinorUnits, 1000);
        assert.equal(report.purchase.authorizedExposureMinorUnits, 1000);
        assert.equal(report.purchase.simulatedMinorUnits, 0);
        assert.equal(report.purchaseAttempts[0].settlement, "unknown");
        assert.equal(report.purchaseAttempts[0].delivery, "missing");
        assert.equal(calls, 0);
        assert.equal((await runtime.journal())[0].resolved, false);
      } finally {
        await runtime.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
);
test("a definitively released slot reused by a later retired attempt is counted once after recovery", async () => {
  const { writeFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const { BaseSlotLedger } = await import("./.generated/slot-ledger.mjs");
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-slot-reuse-"));
  const ledger = await BaseSlotLedger.open({
    path: join(stateDir, "base-slots.json"),
  });
  await ledger.commit(ledger.allocateProvisional());
  const investigationId = randomUUID();
  await writeFile(
    join(stateDir, "journal.json"),
    JSON.stringify([
      {
        schemaVersion: 1,
        investigationId,
        chainId: 8453,
        transactionHash: hash,
        blockHash,
        blockNumber: "0x1",
        evidence: [],
        purchaseAttempts: [],
        inferenceAttempts: [
          {
            attemptId: "released-proof",
            state: "released",
            outcome: "failed",
            slot: 0,
          },
          {
            attemptId: "retired-proof",
            state: "retired",
            outcome: "confirmed",
            slot: 0,
          },
        ],
      },
    ]),
  );
  const runtime = await createInvestigator({ stateDir });
  try {
    const report = await runtime.recover(investigationId);
    assert.equal(report.inference.authorizedAllocation, 1);
    assert.equal(report.inference.locallyRetiredSlots, 1);
    assert.equal(report.inferenceAttempts[0].state, "released");
  } finally {
    await runtime.close();
  }
});

test("pending coverage remains unsupported after restart without external authorization", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-unsupported-"));
  const first = await createInvestigator({ stateDir, rpc: { transaction: async () => ({ hash, blockHash: null, blockNumber: null }) } });
  const original = await first.investigate(input);
  await first.close();
  const restarted = await createInvestigator({ stateDir });
  try {
    const recovered = await restarted.investigate(input);
    assert.equal(original.coverage, "unsupported");
    assert.equal(recovered.coverage, "unsupported");
    assert.equal(recovered.previousStoppingReason, "pending_transaction");
    assert.equal(recovered.inference.authorizedAllocation, 0);
    assert.equal(recovered.purchase.authorizedExposureMinorUnits, 0);
  } finally { await restarted.close(); }
});

for (const [name, request, source] of [
  ["successful", input, { ...rpc, receipt: async () => ({ ...(await rpc.receipt()), status: "0x1" }) }],
  ["invalid", { schemaVersion: 1, chainId: 999, transactionHash: hash }, rpc],
]) test(`${name} request coverage stays unsupported after restart`, async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-unsupported-"));
  const first = await createInvestigator({ stateDir, rpc: source });
  const original = await first.investigate(request);
  await first.close();
  const restarted = await createInvestigator({ stateDir });
  try {
    const report = await restarted.recover(original.investigationId);
    assert.equal(report.coverage, "unsupported");
    assert.equal(report.inference.authorizedAllocation, 0);
    assert.equal(report.purchase.authorizedExposureMinorUnits, 0);
  } finally { await restarted.close(); }
});
test("legacy journal without coverage conservatively reports unsupported", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-legacy-"));
  const first = await createInvestigator({ stateDir, rpc });
  const original = await first.investigate(input);
  await first.close();
  const path = join(stateDir, "journal.json");
  const records = JSON.parse(await readFile(path, "utf8"));
  for (const record of records) delete record.coverage;
  await writeFile(path, JSON.stringify(records));
  const restarted = await createInvestigator({ stateDir });
  try { assert.equal((await restarted.recover(original.investigationId)).coverage, "unsupported"); }
  finally { await restarted.close(); }
});

test("equivalent hash casing binds live evidence and recovered execution facts", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-casing-"));
  const transactionHash = "0x" + "ab".repeat(32), block = "0x" + "cd".repeat(32);
  const upper = value => "0x" + value.slice(2).toUpperCase();
  const first = await createInvestigator({ stateDir, rpc: {
    transaction: async () => ({ hash: upper(transactionHash), chainId: 8453, blockHash: block, blockNumber: "0xa" }),
    receipt: async () => ({ transactionHash, blockHash: upper(block), blockNumber: "0xA", status: "0x0", logs: [] }),
    block: async () => ({ hash: upper(block), number: "0xA" }),
  } });
  const original = await first.investigate({ ...input, transactionHash });
  assert.equal(original.observedFacts[0].value, "failed");
  await first.close();
  const restarted = await createInvestigator({ stateDir });
  try {
    const report = await restarted.recover(original.investigationId);
    assert.equal(report.validationFailures.length, 0);
    assert.equal(report.observedFacts[0].value, "failed");
  } finally { await restarted.close(); }
});
