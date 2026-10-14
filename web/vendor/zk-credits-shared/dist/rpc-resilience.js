import { createRpcBudgetFetch } from './rpc-budget.js';
// Conservative costs for the methods used by funding and witness synchronization.
// Provider quotas are account-wide; this scheduler is only process-local.
const READS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_estimateGas',
    'eth_feeHistory', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_getBalance',
    'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getLogs',
    'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
const COSTS = { eth_chainId: 5, eth_estimateGas: 300, eth_getLogs: 255 };
class RpcResponseTooLargeError extends Error {
    constructor() { super('rpc_response_too_large'); }
}
function methods(init) {
    if (typeof init?.body !== 'string')
        return [];
    try {
        const body = JSON.parse(init.body);
        const items = Array.isArray(body) ? body : [body];
        return items.length && items.every(item => typeof item?.method === 'string')
            ? items.map(item => item.method) : [];
    }
    catch {
        return [];
    }
}
function retryAfter(response) {
    const value = response.headers.get('Retry-After');
    if (!value)
        return 10_000;
    const delay = /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(delay) ? Math.max(1000, delay) : 10_000;
}
/** Bounded, cancellable RPC scheduling. Writes and unknown methods are never retried. */
export function createResilientRpcFetch(options) {
    const credits = options.creditsPerSecond ?? 400;
    const concurrency = options.maxConcurrent ?? 4;
    const timeout = options.timeoutMs ?? 30_000;
    if (![credits, concurrency, timeout, options.maxQueued ?? 64].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('invalid_rpc_scheduler');
    }
    const budget = createRpcBudgetFetch({ ...options, maxConcurrent: concurrency, now: () => Date.now() });
    const queue = [];
    let active = 0;
    let cooldownUntil = 0;
    let nextDispatch = 0;
    let history = [];
    let timer;
    function pump() {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (!queue.length || active >= concurrency)
            return;
        const time = Date.now();
        history = history.filter(entry => entry.time > time - 1000);
        const index = Math.max(0, queue.findIndex(job => !job.background));
        const job = queue[index];
        let used = history.reduce((sum, entry) => sum + entry.cost, 0);
        let readyAt = Math.max(cooldownUntil, nextDispatch);
        for (const entry of history) {
            if (used + job.cost <= credits)
                break;
            readyAt = Math.max(readyAt, entry.time + 1000);
            used -= entry.cost;
        }
        if (readyAt > time) {
            timer = setTimeout(pump, readyAt - time);
            return;
        }
        queue.splice(index, 1);
        active += 1;
        history.push({ time, cost: job.cost });
        nextDispatch = time + Math.ceil(job.cost * 1000 / credits);
        job.run();
        pump();
    }
    function enqueue(input, init, cost, background, signal) {
        if (signal.aborted)
            return Promise.reject(signal.reason);
        if (queue.length >= (options.maxQueued ?? 64) || cost > credits) {
            return Promise.resolve(new Response('{"error":"rpc_busy"}', { status: 429, headers: { 'Retry-After': '1' } }));
        }
        return new Promise((resolve, reject) => {
            const job = {
                background, cost, signal,
                cancel() {
                    const index = queue.indexOf(job);
                    if (index >= 0) {
                        queue.splice(index, 1);
                        reject(signal.reason);
                        pump();
                    }
                },
                run() {
                    signal.removeEventListener('abort', job.cancel);
                    void budget(input, { ...init, signal }).then(async (response) => {
                        if (response.status === 429)
                            cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfter(response));
                        // JSON-RPC consumers parse the whole body. Keep the deadline and
                        // caller cancellation active through that read, not just headers.
                        resolve(await readResponse(response, signal));
                    }).catch(reject).finally(() => { active -= 1; pump(); });
                },
            };
            signal.addEventListener('abort', job.cancel, { once: true });
            queue.push(job);
            pump();
        });
    }
    const request = (background) => async (input, init) => {
        const controller = new AbortController();
        const original = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const abort = () => controller.abort(original?.reason);
        if (original?.aborted)
            abort();
        original?.addEventListener('abort', abort, { once: true });
        const deadline = setTimeout(() => controller.abort(new Error('rpc_timeout')), timeout);
        const names = methods(init);
        const safe = names.length > 0 && names.every(name => READS.has(name));
        const cost = names.length ? names.reduce((sum, name) => sum + (COSTS[name] ?? 80), 0) : 80;
        try {
            for (let attempt = 0;; attempt += 1) {
                let response;
                try {
                    response = await enqueue(input, init ?? {}, cost, background, controller.signal);
                }
                catch (error) {
                    if (!safe || attempt >= 2 || controller.signal.aborted || error instanceof RpcResponseTooLargeError)
                        throw error;
                    await pause(500 * 2 ** attempt + Math.random() * 100, controller.signal);
                    continue;
                }
                if (!safe || attempt >= 2 || ![429, 500, 502, 503, 504].includes(response.status))
                    return response;
                const delay = response.status === 429 ? retryAfter(response) : 500 * 2 ** attempt;
                await response.body?.cancel();
                await pause(delay + Math.random() * 100, controller.signal);
            }
        }
        finally {
            clearTimeout(deadline);
            original?.removeEventListener('abort', abort);
        }
    };
    return Object.assign(request(false), { background: request(true) });
}
async function readResponse(response, signal) {
    if (!response.body)
        return response;
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel(signal.reason).catch(() => { }); };
    signal.addEventListener('abort', abort, { once: true });
    const chunks = [];
    let size = 0;
    try {
        signal.throwIfAborted();
        while (true) {
            const chunk = await reader.read();
            signal.throwIfAborted();
            if (chunk.done)
                break;
            size += chunk.value.byteLength;
            if (size > 10 * 1024 * 1024) {
                await reader.cancel();
                throw new RpcResponseTooLargeError();
            }
            chunks.push(chunk.value.slice().buffer);
        }
        return new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    finally {
        signal.removeEventListener('abort', abort);
        reader.releaseLock();
    }
}
function pause(ms, signal) {
    if (signal.aborted)
        return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
}
