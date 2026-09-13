# Stellar Launch Level 4 Web2 Evaluation Path Design

**Date:** 2026-09-13

**Status:** Approved approach; pending written-spec review

**Feature slug:** `stellar-launch`

**Supersedes:** The wallet-gated participant path in
`2026-09-11-stellar-launch-level4-design.md`

## Decision

The Level 4 evaluation's primary participant journey is walletless for normal
Web2 and agentic coding users. Participants authenticate with GitHub, create a
browser-held evaluation identity, consent to the exact Level 4 version, pay
the consent-gated `$1` Stripe test charge, receive a gateway-funded Stellar
testnet deposit through the existing staged deposit path, and submit fixed
feedback.

Freighter installation, wallet connection, SEP-53 signing, and wallet proof
are not required for enrollment, checkout, deposit, feedback, completion, or
the ten-person evidence gate. The gateway still performs a real testnet
deposit, so the hosted acceptance path continues to validate the product's
Stellar behavior without making participants operate a crypto wallet.

The existing wallet challenge/proof API and nullable storage remain available
as an optional compatibility seam for a future Stellar-specific cohort. They
are removed from the normal dashboard journey and do not influence completion
or evidence eligibility.

## Why this approach

Three approaches were considered:

1. **Remove wallet proof entirely.** This produces a clean API but requires
   deleting the existing challenge/proof surface and changing the deployed
   schema for behavior that is not needed by the primary path.
2. **Make wallet proof optional (chosen).** This preserves existing nullable
   columns, purge handling, and future wallet-specific capability while
   removing the Freighter dependency from the user journey and all Level 4
   completion gates.
3. **Maintain separate wallet and Web2 evaluation tracks.** This supports
   distinct cohorts but creates additional UI, reporting, and acceptance-gate
   complexity without a current product need.

The chosen approach limits the migration risk and keeps the core evaluation
contract aligned with the intended audience: a participant should not need
crypto-specific browser tooling to evaluate an agentic coding product.

## Goals and non-goals

### Goals

- Make a normal Web2 participant able to finish Level 4 without Freighter or a
  self-funded wallet.
- Preserve the exact consent version `level4-2026-09-11`.
- Keep the `$1` Stripe test checkout, including retryable webhook behavior.
- Keep the gateway-funded, staged Stellar testnet deposit and explorer
  confirmation.
- Keep browser-held commitment identity and authenticated participant
  ownership boundaries.
- Make feedback available after a confirmed deposit, without wallet proof.
- Make the ten-person evidence gate depend on distinct consenting
  participants and unique confirmed deposits, not unique wallets.
- Preserve optional wallet proof behavior for compatibility and future use
  without exposing it in the primary flow.

### Non-goals

- Replacing the existing staged deposit implementation or adding a chain
  reconciler.
- Removing wallet-proof records or changing the deployed migration solely to
  simplify an optional capability.
- Treating a gateway-funded deposit as proof that a participant controls a
  personal wallet.
- Fabricating the ten-person cohort, telemetry captures, checkout artifacts,
  explorer links, or screenshots.
- Changing normal non-evaluation credit purchase behavior.

## Participant journey

The primary dashboard flow has four visible stages:

1. **Consent and enrollment.** The authenticated GitHub session enrolls once
   with exact consent `level4-2026-09-11`. The web service derives the opaque
   participant ID from the GitHub subject using the web-only evaluation HMAC.
2. **Browser identity and `$1` checkout.** The participant creates or reuses
   the browser-held commitment required by the evaluation checkout. The web
   service starts a Stripe test-mode session for exactly 100 cents and attaches
   only opaque evaluation metadata.
3. **Gateway-funded Stellar deposit.** The successful checkout is processed
   through the existing retryable billing seam and staged gateway deposit
   path. The participant sees a safe explorer link only after a confirmed
   testnet transaction is recorded.
4. **Feedback.** Once the deposit is confirmed, the participant submits the
   bounded fixed feedback fields. The evaluation becomes complete.

The primary UI must not show a required “Verify Freighter” step, an install
prompt, a wallet error blocking checkout, or wallet instructions as part of
the progress indicator. If an internal or future wallet-specific surface
displays wallet status, it must clearly label that status optional and must not
change the primary evaluation state.

Logout continues to clear the authenticated dashboard state and reset the
allowlisted analytics identity. Re-login must not expose a prior participant's
browser or session data.

## Domain and state rules

### Enrollment and identity

- Enrollment is stable for one opaque authenticated participant and rejects a
  changed consent version.
- The browser-held commitment remains a prerequisite for the evaluation
  checkout; it is never exported, logged, or sent as analytics data.
- Public responses expose only the `L4-<first 12 hex characters>` code and
  safe bounded status fields.

### Deposit and feedback

- A checkout/deposit belongs to an enrolled participant and uses the existing
  ownership and idempotency rules.
- A valid canonical 64-hex transaction hash remains unique per participant
  and globally unique in the evaluation store.
- Linking a deposit requires enrollment and the existing deposit validation;
  it does not require `wallet.verified`.
- Feedback requires enrollment and a linked **confirmed** deposit. It does not
  require wallet verification.
- Completion is determined by confirmed deposit plus valid feedback. A wallet
  proof is not part of the completion predicate.
- The existing crash window after chain acceptance and before receipt-hash
  persistence remains documented; this change does not add reconciliation.

### Optional wallet capability

- Existing wallet challenge and proof endpoints may remain protected by the
  same gateway authentication and participant ownership checks.
- Existing wallet uniqueness, Testnet-only SEP-53 validation, single-use
  challenges, and retention purge behavior remain valid when that optional
  API is used.
- A wallet proof may enrich an internal record, but it cannot unlock checkout,
  deposit, feedback, completion, or evidence export.
- Optional wallet data remains restricted and is never included in analytics,
  prompts, API-key data, public status, or exported evidence.

## Evidence contract

The Level 4 export and hosted acceptance evidence represent the walletless
primary path:

- The minimum cohort is ten distinct consenting authenticated participants.
- Each complete participant must have a unique confirmed evaluation deposit
  transaction hash.
- The export contains only public participant codes, redacted safe status, the
  confirmed transaction hash or explorer-safe reference, bounded feedback,
  and completion time as currently permitted by the evidence contract.
- Wallet address, wallet fingerprint, signatures, GitHub subjects, full HMAC
  IDs, browser commitments, prompts, API keys, and secrets are not required
  for eligibility and must not appear in the export.
- A walletless participant is a valid complete record. Post-purge records are
  evaluated according to the revised deposit-plus-feedback predicate, not a
  raw wallet column.

The ten-person gate remains genuinely external. Distinct people, distinct
authenticated sessions, real test-mode checkout events, unique testnet
transactions, and consented feedback must be collected; records must not be
copied or synthesized.

## API and implementation boundaries

The implementation should make the smallest behavior change at the domain
boundary:

- Change memory and Postgres completion predicates to require only confirmed
  deposit and feedback.
- Remove wallet checks from deposit linking and feedback submission while
  retaining enrollment, ownership, hash uniqueness, validation, and retry
  rules.
- Keep the wallet fields nullable and keep the existing wallet-proof routes
  unless a compatibility test demonstrates that a narrower removal is safe.
- Update route and web error mappings so a missing wallet is never reported as
  a checkout or feedback blocker.
- Remove Freighter access and wallet proof from the primary dashboard flow and
  update progress steps to Consent, `$1` checkout/deposit, and Feedback (or an
  equivalent wording that accurately reflects the hosted flow).
- Preserve the existing browser-commitment checkout guard and the gateway's
  staged deposit submission. No gateway secret, HMAC secret, wallet proof, or
  private Stripe data reaches the browser.
- Update evidence serialization and tests so walletless complete records are
  accepted and no wallet field is required in the redacted export.

No migration is expected for this behavior change because the deployed wallet
columns are already nullable and remain restricted optional fields. A
migration is warranted only if implementation discovers an existing database
constraint that still makes wallet proof mandatory; such a migration must be
additive and reversible.

## Telemetry and privacy

The allowlisted PostHog events and scrubbed Sentry behavior remain unchanged in
principle. The walletless path must additionally verify that:

- checkout, deposit, feedback, and logout events use only bounded opaque
  identifiers and safe status values;
- no Freighter detection failure, wallet prompt, signature, commitment, or
  subject is captured as an event property or exception field; and
- logout resets analytics identity even when the participant never used a
  wallet.

Hosted screenshots and dashboard evidence must be scrubbed for subjects,
wallets, signatures, prompts, commitments, tokens, and secrets.

## Verification plan

Before hosted acceptance, tests must cover:

- memory and Postgres walletless completion;
- deposit linking without wallet proof;
- feedback after confirmed deposit without wallet proof;
- optional wallet proof invariants and purge behavior remaining intact;
- checkout ownership, idempotency, concurrency, and retried webhook
  processing;
- explorer-safe status after the gateway-funded transaction is confirmed;
- web dashboard flow with no Freighter API present;
- logout analytics reset on the walletless path; and
- evidence export with ten unique participant/deposit pairs and no required
  wallet data.

The hosted T8.B walk becomes: GitHub OAuth, browser identity/enrollment, exact
consent, `$1` Stripe test checkout with one retried webhook, gateway-funded
testnet deposit, explorer confirmation, feedback, and logout. Freighter is not
an acceptance prerequisite.

T8.C still requires scrubbed Sentry and consented PostHog evidence. T8.D
remains blocked until ten genuine consenting people complete the revised path.
T8.E still requires fresh screenshots, the 4–6 minute demonstration, final
review, and PR reconciliation.

## Risks and honesty boundary

- Gateway-funded deposits validate the system's Stellar path, but they do not
  validate user wallet ownership. Any future wallet-specific cohort must be
  labeled separately.
- Existing wallet records and APIs can create confusing legacy status if the
  UI continues to surface them as a required step; the primary UI must remove
  that ambiguity.
- The crash-after-accept receipt gap remains out of scope and must continue to
  be disclosed in the implementation and testing evidence.
- Hosted OAuth, Stripe ingress, funded gateway operation, telemetry captures,
  and the ten-person cohort require direct external evidence. Local tests and
  synthetic health checks cannot substitute for those gates.
