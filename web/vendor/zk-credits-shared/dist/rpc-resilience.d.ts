export type ResilientRpcFetch = typeof globalThis.fetch & {
    background: typeof globalThis.fetch;
};
/** Bounded, cancellable RPC scheduling. Writes and unknown methods are never retried. */
export declare function createResilientRpcFetch(options: {
    requestsPerMinute: number;
    creditsPerSecond?: number;
    maxConcurrent?: number;
    maxQueued?: number;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}): ResilientRpcFetch;
