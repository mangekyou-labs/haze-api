import { createResilientRpcFetch } from '@zk-credits/shared/base';

/** One process budget for endpoint validation and witness synchronization. */
export const rpcFetch: typeof fetch = createResilientRpcFetch({ requestsPerMinute: 300 });
