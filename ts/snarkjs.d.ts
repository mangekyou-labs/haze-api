declare module 'snarkjs' {
  export const groth16: {
    verify(verificationKey: object, publicSignals: string[], proof: object): Promise<boolean>;
  };
}
