# Live investigator validation

The installed local package candidate produced a useful diagnosis and confirmed its own paid model response. The second fresh rehearsal also succeeded, completing the live verification prerequisite; publication and recording remain separate work.

## Gateway and request fixes

The owner explicitly authorized updating the hosted gateway with the existing Render credentials. Its OpenRouter key was replaced with the configured local key and the existing live commit `2f3117db7dade105b34c0bb37540efadb2337411` redeployed. The Base Sepolia RPC was replaced with the existing local endpoint and its log range set to 2,000. Readiness subsequently passed every check, including synchronized root, RPC lag, provider configuration and v2 compatibility.

The exact investigator request returned OpenRouter HTTP 404 because no endpoint supported all requested parameters. Removing `parallel_tool_calls` made that request succeed while the runtime retained sequential local tool execution. The report schema now describes the fields already required by the evidence validator. Provider routing limits, fixed model, evidence validation and payment bounds remain enforced.

## Successful installed invocation

Command: `zk-credits investigate --chain base 0xc4744cb2714fa9238da819c4299f091302c0dc170acb0886bb975234ac10c69b`.

Read-only preflight verified the failed receipt, canonical block identity and original public execution recording. The original execution returned `AerodromeV3: insufficient received`. The report cites that evidence, labels slippage protection as a hypothesis, and recommends checking swap calldata and minimum output. No replay simulation or paid execution-data purchase was used. The underlying cause and deepest failing call are not established by this root error alone. The report also retains missing-evidence and rejected-model-claim notices; those are limitations, not supported findings.

The same invocation reported one 402 challenge, validated model delivery, one confirmed consumed credit, one locally retired slot, zero failed outcomes and zero unknown outcomes. These are invocation observations, not aggregate gateway counters or the separate direct provider diagnostics.

Package build: `14533b1ebbca1bf21194fd289539ab08dbaeac711c2e6f2719e453bb874f972e`.
Installed investigator SHA-256: `00823247e895a929b5c4528eee708bcef16175b932c748612b8cf831aa6b7b8c`.
Local tarball SHA-256: `ce185e77793c2612d2058676d13adb34874cd11dcfb8e7534d010a3aa19e9f6c`.

This was an isolated build from commit `5c0ddc0` plus the reviewed inference fix, packaged as the checkout's version 0.2.10 and installed in a fresh disposable project. The earlier candidate had version 0.2.11; version numbers do not establish registry parity. No registry release is claimed.

## Fresh rehearsal

A second plain installed command investigated `0x96e2a530350fd2f99741b7a40659531217393e2a33242ad81f1df2f749d07b1d` on 2026-10-08. Read-only preflight again verified the failed receipt, canonical block and original execution. It returned a complete cited report for `ERC20: transfer amount exceeds balance`, a balance hypothesis and checks for calldata and historical balances. This invocation independently observed one challenge, validated model delivery and one confirmed consumed credit, with zero unknown or failed outcomes. Its [raw nonsecret rehearsal report](founder-live-rehearsal-2026-10-08.txt) preserves the output.

Suggested checks are model proposals. The transaction target is not independently established as the token contract, and the outer sender is not established as the account whose token balance caused the nested failure. Identify the token and transfer account from calldata or original trace before applying those balance checks. Neither report establishes the deepest failing call.

## Funding and recovery

Separately verified Base Sepolia chain 84532, successful canonical funding receipt, matching BundleFunded event, at least five confirmations and an unexpired credential. Funding identifiers and any credential-to-spend mapping are omitted from this artifact.

Repeating the successful hash recovered its prior report: zero new challenges, zero new consumed credits, zero unknown outcomes. Missing OS credentials gave setup guidance before spending. A controlled RPC outage at the installed boundary returned `rpc_unavailable`, actionable RPC guidance and zero challenges or retired slots. That failure check was controlled, not a claim of a live provider outage.

Earlier failed attempts were each checked with a read-only, exact claim lookup against the gateway's verified database. Cancelled generation-one claims with no replay were reconciled as failed through the owner runtime. Their retired slots and journals remain intact; no unresolved outcome was bypassed.

## Verification

144 investigator tests passed. The isolated package suite passed 139 tests, with three existing skips. Package build/typechecking passed. Parallel standards and spec reviews found no code defects. Graphify was updated. Raw credentials, proofs, payment headers, nullifiers and funding identity joins remain private.
