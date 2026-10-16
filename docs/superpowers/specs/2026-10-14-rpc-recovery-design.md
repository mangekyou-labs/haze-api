# RPC recovery for hosted funding and local witnesses

The user approved pacing RPC requests, prioritizing funding, bounded retries of
safe reads, receipt-first recovery, and preserving uncertain broadcasts. The
same recovery transport will protect local witness synchronization. Provider
402 quota errors and gateway x402 payment failures are distinct failures.

Keep the existing request budget as a per-process ceiling. Add a bounded queue
with foreground and background lanes, conservative weighted pacing at 400
credits/second, shared provider cooldown, and at most two retries for explicitly
allowlisted reads on 429, transient 5xx, or network failure. Never automatically
retry submission, unknown methods, mixed batches, quota exhaustion, or aborts.
Queue waits and retries respect cancellation and a 30-second total deadline.
Gateway event sync uses the background lane. No distributed quota is claimed.

When a funding hash exists, verify its receipt, confirmations, contract event,
and commitment first. A successful matching receipt completes recovery without
historical scans. Pending/missing receipts fall back to commitment reconciliation
to preserve replacement recovery; RPC failures preserve uncertainty.

Local witness synchronization uses the same paced read transport, coalesces
concurrent syncs, and retains incremental checkpoints after successful ranges.
Failed synchronization remains retryable; no stale witness fallback is added.
Published packages are not changed by deploying the gateway.

Follow-up QA supplied the exact gateway-root confirmation timeout and missing
CLI version flag. Root verification now retries only reachability/throttling/
transient server failures, allowing 30 seconds per call within a 60-second
deadline. A definitive unknown root still fails closed immediately. Errors
distinguish gateway unavailability from unknown roots and local RPC failures.
The packaged CLI reports its version without starting the sidecar. Independent
RPC configuration persists across sessions, with explicit environment precedence.

Validation seams: JSON-RPC fetch under deterministic throttling, sponsor recovery
through its public adapter, concurrent local witness requests, and billing
reservations after uncertain submission. Existing browser recovery remains valid.

Live rollout exposed a second startup dependency: the gateway awaited history
synchronization before opening its HTTP port. Start that synchronization after
listening, using the same non-overlapping loop as periodic recovery. Liveness
responds during backfill; durable root snapshots still govern payment checks.
The initial constructor-root read retains its existing bounded RPC deadline.


Follow-up legacy setup QA reproduced a valid witness being rejected: its root
matched the deployed contract currentRoot, but the gateway index lagged by
77,356 blocks. BASE_SYNC_MAX_BLOCK_RANGE was 10; read-only probes of the actual
configured gateway RPC accepted 100 and 2,000 blocks. Restore the tested
2,000-block range to reduce catch-up requests by 200 times.

Use the durable finalized index first. On an index miss, both public/admin root
checks and the production proof verifier use contract knownRoot(root) at
head minus BASE_CONFIRMATIONS (default three), never latest unconfirmed state.
A true contract result permits the normal proof checks; false rejects the root.
Read failures remain uncertainty (503 for root-check, verifier failure for
payment), with no manual whitelist, credential changes or chain transactions.
Do not persist fallback results or advance the history cursor; historical
backfill and reorg handling remain owned by the indexer.
