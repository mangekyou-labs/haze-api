declare module 'snarkjs' {
  interface Groth16 {
    fullProve(
      input: unknown,
      wasm: string | Uint8Array,
      zkey: string | Uint8Array,
    ): Promise<{ proof: unknown; publicSignals: unknown[] }>;
    verify(vk: unknown, pub: unknown[], proof: unknown): Promise<boolean>;
  }

  export const groth16: Groth16;
}
