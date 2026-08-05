/**
 * Minimal type declaration for `circomlibjs`.
 *
 * `circomlibjs` ships no type definitions. We declare only the members the
 * codebase uses (MiMCSponge hash), keeping strict mode intact without an
 * `any`-escape. Values are typed as `Uint8Array` to match the byte-array
 * conversion performed by the Merkle tree implementation.
 */
declare module 'circomlibjs' {
  export function buildMimcSponge(): Promise<{
    F: {
      e: (x: Uint8Array) => Uint8Array;
    };
    multiHash: (arr: bigint[]) => Uint8Array;
  }>;
}
