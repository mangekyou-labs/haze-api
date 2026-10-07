import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInvestigator } from "./investigator.mjs";
const hash = "0x" + "11".repeat(32),
  blockHash = "0x" + "22".repeat(32);
const request = { schemaVersion: 1, chainId: 8453, transactionHash: hash };
async function setup(overrides = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), "investigator-"));
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
    ...overrides,
  };
  const forbidden = () => {
    throw Error("authorization forbidden");
  };
  return createInvestigator({
    stateDir,
    rpc,
    provider: forbidden,
    model: forbidden,
    signer: forbidden,
    prover: forbidden,
  });
}
test("failed transaction yields cited factual partial report without authorization", async () => {
  const runtime = await setup();
  const report = await runtime.investigate(request);
  assert.equal(report.coverage, "supported");
  assert.equal(report.diagnosis, "insufficient_evidence");
  assert.equal(report.toolInvocations, 4);
  assert.equal(report.observedFacts[0].value, "failed");
  assert.equal(report.purchase.liveMinorUnits, 0);
  assert.equal(report.inference.confirmedCommitted, 0);
  assert.equal(
    (await runtime.journal()).at(-1).stoppingReason,
    "missing_revert_evidence",
  );
});
test("historical replay revert is decoded but does not assert original causal diagnosis", async () => {
  const fixture = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(new URL("./fixtures/recorded-revert.json", import.meta.url)),
  );
  const runtime = await setup({
    transaction: async () => fixture.transaction,
    receipt: async () => fixture.receipt,
    block: async () => fixture.block,
    revert: async () => fixture.replay,
  });
  const report = await runtime.investigate({
    ...request,
    transactionHash: fixture.transaction.hash,
  });
  assert.equal(report.observedFacts.at(-1).value, "p address!");
  assert.equal(report.supportedDiagnoses.length, 0);
  assert.equal(report.toolInvocations, 5);
});
for (const [name, input, reason] of [
  [
    "malformed hash",
    { ...request, transactionHash: "0xabc" },
    "invalid_request",
  ],
  [
    "model destination override",
    { ...request, destination: "https://evil.invalid" },
    "invalid_request",
  ],
  [
    "cross-chain question",
    { ...request, scope: "cross_chain" },
    "unsupported_scope",
  ],
  ["missing network", { ...request, chainId: undefined }, "invalid_request"],
  [
    "oversized clarification",
    { ...request, clarification: "x".repeat(2049) },
    "invalid_request",
  ],
])
  test(name + " never accesses RPC or authorization", async () => {
    const runtime = await setup();
    const r = await runtime.investigate(input);
    assert.equal(r.coverage, "unsupported");
    assert.equal(r.stoppingReason, reason);
    assert.equal(r.toolInvocations, 0);
    assert.equal(
      (await runtime.journal()).at(-1).purchase.authorizedExposureMinorUnits,
      0,
    );
  });
for (const [name, overrides, reason, count, coverage] of [
  [
    "dropped",
    { transaction: async () => null },
    "transaction_not_found",
    1,
    "unsupported",
  ],
  [
    "pending",
    { transaction: async () => ({ hash, blockHash: null }) },
    "pending_transaction",
    1,
    "unsupported",
  ],
  [
    "successful",
    {
      receipt: async () => ({
        transactionHash: hash,
        status: "0x1",
        blockNumber: "0x1",
        blockHash,
      }),
    },
    "successful_transaction",
    2,
    "unsupported",
  ],
  [
    "RPC unavailable",
    {
      transaction: async () => {
        throw Error("rpc_unavailable");
      },
    },
    "rpc_unavailable",
    1,
    "supported",
  ],
  [
    "wrong transaction",
    {
      transaction: async () => ({
        hash: "0x" + "33".repeat(32),
        chainId: 8453,
        blockNumber: "0x1",
        blockHash,
      }),
    },
    "inconsistent_transaction",
    1,
    "supported",
  ],
  [
    "wrong receipt block",
    {
      receipt: async () => ({
        transactionHash: hash,
        status: "0x0",
        blockNumber: "0x2",
        blockHash,
        logs: [],
      }),
    },
    "inconsistent_receipt",
    2,
    "supported",
  ],
  [
    "oversized streamed response",
    {
      transaction: async function* () {
        yield Buffer.alloc(4194305);
      },
    },
    "evidence_size_limit",
    1,
    "supported",
  ],
])
  test(name + " produces explicit bounded report", async () => {
    const runtime = await setup(overrides);
    const r = await runtime.investigate(request);
    assert.equal(r.stoppingReason, reason);
    assert.equal(r.coverage, coverage);
    assert.equal(r.toolInvocations, count);
    assert.equal(r.supportedDiagnoses.length, 0);
    assert.equal(r.purchase.liveMinorUnits, 0);
    assert.equal(r.inference.locallyRetiredSlots, 0);
  });
test("reorganization invalidates old facts before finalization", async () => {
  let calls = 0;
  const runtime = await setup({
    block: async () => ({
      number: "0x1",
      hash: ++calls === 1 ? blockHash : "0x" + "ff".repeat(32),
    }),
  });
  const r = await runtime.investigate(request);
  assert.equal(r.stoppingReason, "reorganization");
  assert.equal(r.observedFacts.length, 0);
  assert.ok(r.evidence.every((e) => e.validation === "invalid"));
});
test("journal excludes clarification and retains safe bound evidence metadata", async () => {
  const runtime = await setup();
  const r = await runtime.investigate({
    ...request,
    clarification: "secret raw prompt",
  });
  const journal = await runtime.journal();
  assert.equal(JSON.stringify(journal).includes("secret raw prompt"), false);
  assert.equal(journal[0].evidence[0].transactionHash, request.transactionHash);
  assert.equal(journal[0].evidence[0].blockHash, blockHash);
  assert.equal(journal[0].evidence[0].operation, "transaction");
  assert.equal("value" in journal[0].evidence[0], false);
  assert.equal(r.evidence[0].contentDigest.length, 64);
});
test("report exposes bounded summary and partial reason", async () => {
  const runtime = await setup({
    receipt: async () => ({
      transactionHash: hash,
      status: "0x0",
      blockNumber: "0x1",
      blockHash,
      logs: [{ data: "x".repeat(60000) }],
    }),
  });
  const r = await runtime.investigate(request);
  assert.equal(r.partialReason, "missing_revert_evidence");
  assert.ok(Buffer.byteLength(JSON.stringify(r.summary)) <= 49152);
  assert.ok(
    r.evidence
      .find((e) => e.operation === "receipt")
      .omissions.includes("logs"),
  );
});
test("active deadline includes delayed evidence acquisition", async () => {
  let now = 0;
  const runtime = await createInvestigator({
    stateDir: await mkdtemp(join(tmpdir(), "deadline-")),
    clock: () => now,
    rpc: {
      transaction: async () => {
        now = 120001;
        return {};
      },
    },
  });
  const r = await runtime.investigate(request);
  assert.equal(r.stoppingReason, "deadline_exceeded");
  assert.equal(r.toolInvocations, 1);
  assert.equal(r.inference.confirmedCommitted, 0);
});
test("invalid revert bytes do not become an observed decoded fact", async () => {
  const runtime = await setup({
    revert: async () => ({
      kind: "historical_replay",
      atBlock: "0x1",
      data: "0x08c379a0",
    }),
  });
  const r = await runtime.investigate(request);
  assert.equal(r.stoppingReason, "invalid_revert_decoding");
  assert.equal(r.observedFacts.length, 1);
  assert.equal(r.supportedDiagnoses.length, 0);
});
test("journal maps secret-bearing RPC errors to a safe reason", async () => {
  const runtime = await setup({
    transaction: async () => {
      throw Error("secret raw prompt https://rpc.invalid?token=key");
    },
  });
  await runtime.investigate(request);
  assert.equal(
    JSON.stringify(await runtime.journal()).includes("token=key"),
    false,
  );
});
test("failed optional revert still rechecks canonical block", async () => {
  let calls = 0;
  const runtime = await setup({
    revert: async () => {
      throw Error("unavailable");
    },
    block: async () => ({
      number: "0x1",
      hash: ++calls === 1 ? blockHash : "0x" + "ff".repeat(32),
    }),
  });
  const r = await runtime.investigate(request);
  assert.equal(r.stoppingReason, "reorganization");
  assert.equal(r.observedFacts.length, 0);
});
test("revert explicitly bound to another transaction is rejected", async () => {
  const fixture = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(new URL("./fixtures/recorded-revert.json", import.meta.url)),
  );
  const runtime = await setup({
    revert: async () => ({
      ...fixture.replay,
      atBlock: "0x1",
      transactionHash: "0x" + "ff".repeat(32),
    }),
  });
  const r = await runtime.investigate(request);
  assert.equal(r.stoppingReason, "invalid_revert_binding");
  assert.equal(r.observedFacts.length, 1);
});
test("odd-length revert bytes cannot silently decode", async () => {
  const fixture = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(new URL("./fixtures/recorded-revert.json", import.meta.url)),
  );
  const runtime = await setup({
    revert: async () => ({
      ...fixture.replay,
      atBlock: "0x1",
      data: fixture.replay.data + "f",
    }),
  });
  const r = await runtime.investigate(request);
  assert.equal(r.stoppingReason, "invalid_revert_decoding");
});
test("journal replacement failure does not mutate accepted in-memory history", async () => {
  const fs = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "journal-failure-"));
  const runtime = await createInvestigator({ stateDir, rpc: {} });
  await fs.mkdir(join(stateDir, "journal.json"));
  await assert.rejects(
    runtime.investigate({ ...request, transactionHash: "bad" }),
    /local_persistence_failed/,
  );
  assert.deepEqual(await runtime.journal(), []);
});
test("invalid request does not echo untrusted objects", async () => {
  const runtime = await setup();
  const r = await runtime.investigate({
    ...request,
    chainId: { secret: "credential" },
    transactionHash: { secret: "credential" },
  });
  assert.equal(JSON.stringify(r).includes("credential"), false);
});
test("authentic fixture bytes match recorded manifest digest and identity", async () => {
  const fs = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const manifest = JSON.parse(
    await fs.readFile(
      new URL("./fixtures/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const bytes = await fs.readFile(
    new URL("./fixtures/recorded-revert.json", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.sha256,
  );
  const fixture = JSON.parse(bytes);
  assert.equal(fixture.transaction.hash, manifest.transactionHash);
  assert.equal(fixture.receipt.blockHash, manifest.blockHash);
});
test("unavailable final canonical block invalidates collected facts", async () => {
  let calls = 0;
  const runtime = await setup({
    block: async () => {
      if (++calls > 1) throw Error("offline");
      return { number: "0x1", hash: blockHash };
    },
  });
  const r = await runtime.investigate(request);
  assert.equal(r.stoppingReason, "rpc_unavailable");
  assert.equal(r.observedFacts.length, 0);
  assert.ok(r.evidence.every((e) => e.validation === "invalid"));
});
test("artifact storage failure is a local persistence failure", async () => {
  const fs = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "artifact-failure-"));
  const runtime = await createInvestigator({
    stateDir,
    rpc: {
      transaction: async () => ({
        hash,
        chainId: 8453,
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
    },
  });
  await fs.writeFile(join(stateDir, "artifacts"), "blocked");
  await assert.rejects(
    runtime.investigate(request),
    /local_persistence_failed/,
  );
  const checkpoint = (await runtime.journal())[0];
  assert.equal(checkpoint.transactionHash, hash);
  assert.deepEqual(checkpoint.evidence, []);
  assert.equal(checkpoint.resolved, false);
});
