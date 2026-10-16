# Base Sepolia RPC usage protection

Hosted funding uses the operator-owned `BASE_RPC_URL`. Users can choose their
local client's endpoint with `zk-credits config rpc`; arbitrary user URLs are
not accepted by the signing service.

Updated by [RPC recovery](2026-10-14-rpc-recovery-design.md): safe reads now use
bounded retries and a cancellable queue with a 30-second deadline, including
response-body reads. Submission methods still have no automatic retries.

All gateway RPC clients share a token bucket with 300 tokens, refilling at 300
requests per minute, and at most eight concurrent HTTP requests. Web recovery
uses a separate bucket of 60 tokens, refilling at 60 requests per minute, with
four concurrent requests. Exhaustion rejects locally before contacting the
provider. The original ten-second, no-retry transport is superseded by the
recovery transport described above.
Provider HTTP 429 responses impose a shared cooldown honoring Retry-After.

Funding-status reads share an in-flight request and a ten-second successful
result cache. Funding invalidates that cache; the chain adapter still performs
fresh preflight checks before signing. Background event sync cannot overlap.
Dashboard polling runs every ten seconds, skips hidden tabs and concurrent
fetches, and stops after two minutes with a manual Check again action.

These budgets are per process, not a distributed quota. Multiple Vercel workers
or gateway replicas multiply capacity. A provider-side quota is required for a
hard account-wide usage ceiling. A distributed rate limiter would be needed
before increasing replica count or promising per-user fairness.

Client releases use `BASE_CLIENT_RPC_URL` or the public Base Sepolia endpoint;
they must never embed the operator's `BASE_RPC_URL` credential. Existing client
artifacts are not rewritten by this change.

Verification covers budget exhaustion, refill, concurrency, provider cooldown,
status coalescing, expiry, funding invalidation, and dashboard recovery flows.
