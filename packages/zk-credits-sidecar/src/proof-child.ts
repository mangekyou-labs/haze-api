/**
 * Prover worker entry point for one Groth16 prove.
 *
 * The coordinator runs every prove in a fresh child process so a stalled or
 * runaway WASM prover can be killed at the deadline without taking the sidecar
 * with it. snarkjs cannot run inside a `worker_threads` worker — its
 * `web-worker` polyfill re-enters itself there — so the worker boundary is a
 * real process boundary. The child receives only the witness input and the
 * pinned artifact paths over IPC, returns the proof and public signals, and
 * exits.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface ProofWorkerRequest {
  input: Record<string, unknown>;
  wasmPath: string;
  zkeyPath: string;
}

export interface ProofWorkerResult {
  proof?: Record<string, unknown>;
  publicSignals?: string[];
  error?: string;
}

async function prove(request: ProofWorkerRequest): Promise<ProofWorkerResult> {
  const module = await import('snarkjs') as unknown as {
    groth16?: {
      fullProve(
        input: Record<string, unknown>,
        wasm: string,
        zkey: string,
      ): Promise<{ proof: Record<string, unknown>; publicSignals: string[] }>;
    };
  };
  if (!module.groth16?.fullProve) return { error: 'groth16_prover_unavailable' };
  const result = await module.groth16.fullProve(request.input, request.wasmPath, request.zkeyPath);
  return { proof: result.proof, publicSignals: result.publicSignals };
}

let replied = false;
function reply(result: ProofWorkerResult): void {
  if (replied) return;
  replied = true;
  process.send?.(result, () => process.exit(0));
}

process.once('message', (request: ProofWorkerRequest) => {
  prove(request).then(
    (result) => reply(result),
    (error: unknown) => reply({ error: error instanceof Error ? error.message : 'proof_worker_failed' }),
  );
});
