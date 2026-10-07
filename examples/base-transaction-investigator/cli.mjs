#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInvestigator } from "./investigator.mjs";
const [chain, hash, stateDir] = process.argv.slice(2);
if (!chain || !hash || !stateDir) {
  console.error(
    "Usage: node cli.mjs <8453|84532> <transaction-hash> <owner-local-state-directory>",
  );
  process.exit(1);
}
const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/recorded-revert.json", import.meta.url),
    "utf8",
  ),
);
const rpc = {
  provenance: "recorded_authentic",
  transaction: async (requested) =>
    requested === fixture.transaction.hash ? fixture.transaction : null,
  receipt: async () => fixture.receipt,
  block: async () => fixture.block,
  revert: async () => fixture.replay,
};
const investigator = await createInvestigator({
  stateDir: resolve(stateDir),
  rpc,
});
try {
  console.log(
    JSON.stringify(
      await investigator.investigate({
        schemaVersion: 1,
        chainId: Number(chain),
        transactionHash: hash,
      }),
      null,
      2,
    ),
  );
} finally {
  await investigator.close();
}
