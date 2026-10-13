/** Per-process RPC budget. Provider quotas remain the cross-instance ceiling. */
export function createRpcBudgetFetch(options) {
    const capacity = options.requestsPerMinute;
    if (!Number.isFinite(capacity) || capacity < 1)
        throw new Error('invalid_rpc_budget');
    const now = options.now ?? Date.now;
    let tokens = capacity;
    let updatedAt = now();
    let active = 0;
    let cooldownUntil = 0;
    const limited = (seconds) => new Response('{"error":"rpc_busy"}', {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.max(1, Math.ceil(seconds))) },
    });
    return async (input, init) => {
        const time = now();
        tokens = Math.min(capacity, tokens + Math.max(0, time - updatedAt) * capacity / 60_000);
        updatedAt = time;
        if (time < cooldownUntil)
            return limited((cooldownUntil - time) / 1000);
        if (tokens < 1)
            return limited((1 - tokens) * 60 / capacity);
        if (active >= (options.maxConcurrent ?? 4))
            return limited(1);
        tokens -= 1;
        active += 1;
        try {
            const response = await (options.fetch ?? globalThis.fetch)(input, init);
            if (response.status === 429) {
                const retry = response.headers.get('Retry-After');
                const seconds = retry && /^\d+$/u.test(retry) ? Number(retry)
                    : retry ? (Date.parse(retry) - now()) / 1000 : 10;
                cooldownUntil = Math.max(cooldownUntil, now() + (Number.isFinite(seconds) ? Math.max(1, seconds) : 10) * 1000);
            }
            return response;
        }
        finally {
            active -= 1;
        }
    };
}
