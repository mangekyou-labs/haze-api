/**
 * Minimal type declaration for `circomlibjs`.
 *
 * `circomlibjs` ships no type definitions. We declare only the members the
 * codebase uses (MiMCSponge constants), keeping strict mode intact without
 * an `any`-escape. The constants are read from circomlibjs, while the hash
 * arithmetic itself is performed over BLS12-381 Fr in `merkle.ts`.
 */
declare module 'circomlibjs' {
  export function buildMimcSponge(): Promise<{
    cts: Uint8Array[];
    F: {
      toObject: (x: Uint8Array) => bigint;
    };
  }>;
}
