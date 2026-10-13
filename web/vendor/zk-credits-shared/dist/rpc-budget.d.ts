/** Per-process RPC budget. Provider quotas remain the cross-instance ceiling. */
export declare function createRpcBudgetFetch(options: {
    requestsPerMinute: number;
    maxConcurrent?: number;
    now?: () => number;
    fetch?: typeof globalThis.fetch;
}): typeof globalThis.fetch;
