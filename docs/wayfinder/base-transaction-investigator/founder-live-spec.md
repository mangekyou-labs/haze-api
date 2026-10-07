# Founder live investigator follow-up

The owner invoked wayfinder and implement against this handoff on 2026-10-07. Implement the proposed installed-package launcher and local validation; retain separate live acceptance and recording gates. Publication, deployment, new funding and exact trace payments remain outside scope.

## Important distinctions to preserve

The investigator is a local task runtime, not a component of the facilitator. Its RPC tools fetch execution evidence. Its inference transport calls the model through Haze's custom zk-prepaid x402 adapter. Funding the bundle consumes Base Sepolia test USDC; individual model calls consume prepaid credits offchain. Do not describe each model call as a fresh onchain USDC transfer.

Standard exact x402 resources require their own accepted payment scheme. Haze proofs are not interchangeable with exact USDC transfer authorizations. The useful demo does not need a paid external trace resource or a new Haze-operated exact service. Keep real trace purchases disabled in this demo scope; use public evidence and a transaction whose diagnosis that evidence can support.

Investigated chain and payment-funding chain are independent. If the chosen failed transaction is on Base mainnet, label its evidence as mainnet and the credit funding as Base Sepolia. Prefer a Sepolia example if it yields equally useful accessible evidence. Do not imply an entire mainnet investigation happened on Sepolia.

Current fixture CLI reads recorded JSON and has no live RPC/inference wiring. The optional prepaid smoke still uses recorded evidence and defaults to SKIP. Neither meets the proposed live diagnosis gate. No founder-friendly `zk-credits investigate` command exists. Developer-only factories, private policy JSON, module digests and worktree instructions must not become founder setup steps.

Reuse an existing funded credential sequentially through the established store/setup path, while respecting exclusive runtime ownership. Do not run Codex, starter and investigator concurrently on that credential, or silently create a second ledger. Prior reference policy/bounds/recovery behavior should be read from the existing spec; preserve those constraints rather than reimplementing an unrestricted agent.

## Proposed ticket work: dependency order

The proposed handoff work is tracked as native children of the founder map: [Package the command](https://github.com/mangekyou-labs/haze-api/issues/56) → [Verify the live diagnosis](https://github.com/mangekyou-labs/haze-api/issues/57) → [Add the verified recording segment](https://github.com/mangekyou-labs/haze-api/issues/58). Keep the coding demo intact; the investigator remains optional until live acceptance passes.

### A. Package one founder-facing live investigator command

Problem: the runtime and payment adapter exist as reviewed local integration code, but a founder cannot run a real investigation through the installed package.

Implemented local candidate interface (publication is separate):

`zk-credits investigate --chain base <transaction-hash>`

Final spelling can follow the package's existing CLI conventions. Its user-facing inputs should be the chain and transaction hash; ordinary payment policy, gateway/model selection, state, artifacts and inference factory wiring stay inside the package.

Acceptance:
- Reviewed installed package includes the required investigator runtime and `zk-credits/x402` transport. Check exports and package contents; equal version numbers do not prove registry parity.
- After one existing credential import/setup, the command uses OS-stored credentials and canonical exclusive runtime state. An already configured founder does not repeat activation or edit JSON.
- Wire real bounded RPC collection to the existing investigator and real `localPrepaidInferenceFactory`/`prepareLocalX402Agent` integration. Live mode must not substitute recorded fixtures on failure.
- Keep fixed supported chain/provider/model and spending limits from the reviewed design; no runtime private-key entry, arbitrary model payment URL, or paid exact trace integration.
- Print a readable report with stable evidence references plus nonsecret task-specific credit outcomes. Distinguish confirmed, failed, retired and unknown outcomes; zero or unknown consumption cannot be presented as successful payment.
- Give actionable errors for unavailable credentials/ownership/RPC/model service without bypassing guards or generating speculative diagnoses.
- Demonstrate installation and execution from a clean disposable project using a locally packed candidate. Coordinate public release via #36 separately; do not claim a registry release from a local package run.

### B. Verify a useful live diagnosis and its own prepaid exchange

Problem: offline tests establish implementation behavior, but not live fetch, live inference, model quality and payment settlement in the same investigation.

Acceptance:
- Select one real failed Base transaction with sufficient accessible original evidence; preflight provider access read-only. Avoid promising the deepest failing call if no original trace is available. Historical replay must be labelled as replay.
- Execute the packaged command using an activated, funded credential and actual network RPC/model responses. Observe existing authorization/spend constraints; no exact external purchase needed.
- Produce an understandable diagnosis with references to the evidence actually fetched. Label hypotheses and missing evidence; select a better transaction if the available evidence only permits an unhelpful partial report for the video.
- Record a redacted task summary showing that this same investigation received a 402, used the zk-prepaid proof/payment path, observed validated settlement/model delivery, and confirmed credit consumption. Use observations emitted by this invocation, not a separate smoke test or old counters. Keep raw payment payloads private.
- Separately verify the bundle's Base Sepolia funding transaction/chain without exposing an identity-to-spend join in the video.
- Rehearse the clean founder path again and check useful recovery for common credential/RPC failure; do not retry or authorize replacement spending for unknown outcomes merely to get a successful take.
- Save factual validation notes and reviewed nonsecret artifacts with build identity. Only mark live acceptance complete when both a useful diagnosis and confirmed paid model response are demonstrated.

### C. Add the verified investigator segment to #35 and recording guide

Problem: #35 currently records the coding-agent indexer task and explicitly treats the investigator as follow-up. The new segment must be clearly scoped and reflect live evidence rather than closed fixture tickets.

Acceptance:
- Add an investigator subsection to #35 and `docs/onboarding/base-zk-credits-grant-video.md`; retain the coding demo rather than replacing previously successful work.
- Link A/B and the new validation artifact; recording boxes stay unchecked until exercised.
- Keep the total 2–3 minute target realistic: use a brief second segment or a separate investigator clip if both useful tasks and onboarding cannot fit clearly. No need to repeat setup between segments.
- Explain the custom zk-prepaid scheme and Base Sepolia funding/offchain consumption in ordinary language. Do not suggest universal exact-x402 compatibility or paid execution-data delivery.
- Sync stale implementation status to the evidence already linked in #35 without claiming live Stripe/deployment/publication completion.

## Proposed additions to founder video demo checklist

Paste as an investigator subsection, initially all unchecked:

- [ ] Install the reviewed package build, import the activated credential once if needed, and verify readiness. Keep credential download/import off camera where private data is visible.
- [ ] Show a real failed Base transaction and ask the investigator to explain its failure by supplying its chain and hash.
- [ ] Run the packaged investigator command; fetch live transaction/receipt/block evidence and any accessible supporting evidence, with no fixture fallback.
- [ ] Show the returned diagnosis, supporting evidence references, and a concrete next action; label any remaining uncertainty.
- [ ] Show reviewed payment evidence from this same investigation: 402 challenge, zk-prepaid authorization/settlement, successful model response, and confirmed consumed credits. Do not display raw proofs or payment headers.
- [ ] Show that the prepaid bundle was funded with test USDC on Base Sepolia. Explain that model requests consume credits offchain; label the investigated transaction's chain separately if different.
- [ ] Complete a successful live rehearsal before recording; keep recorded/simulated tests out of the claimed live segment.
- [ ] Review the final video for credentials, proofs, nullifiers, private content and identity-to-spend joins, and label the prototype experimental/testnet payment.

If the founder already imported a valid funded credential during the coding segment, the investigator segment starts with the transaction hash. Stripe is only shown if that separate onboarding flow has itself been verified and is desired in the recording; it need not gate this live use case.
