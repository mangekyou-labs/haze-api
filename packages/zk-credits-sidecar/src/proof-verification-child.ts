/** One local self-check; process exit releases snarkjs curve workers. */
interface VerificationRequest {
  verificationKey: unknown;
  publicSignals: string[];
  proof: Record<string, unknown>;
}
process.once('message', async (request: VerificationRequest) => {
  let valid = false;
  try {
    const { groth16 } = await import('snarkjs') as unknown as {
      groth16: { verify(key: unknown, signals: string[], proof: Record<string, unknown>): Promise<boolean> };
    };
    valid = await groth16.verify(request.verificationKey, request.publicSignals, request.proof);
  } catch {
    // Fail closed; never serialize proof or verifier errors to the parent.
  }
  process.send?.(valid === true, () => process.exit(0));
});
