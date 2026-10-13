# Sign-in responsiveness and sandbox top-up options

Issue: [haze-api #59](https://github.com/mangekyou-labs/haze-api/issues/59).
Implemented 2026-10-13. This extends the account-linked sandbox billing decision;
the activation contract still charges $20 simulated USD for one 250-credit bundle.

## Design

An authenticated dashboard renders without waiting for gateway network status.
The existing sanitized status endpoint loads independently, with a four-second
gateway deadline and a six-second browser deadline. Its loading and unavailable
states do not disable top-ups or balance loading. Request-scoped session caching
avoids repeating authentication work between the header and page.

GitHub remains the billing identity provider. The submit control shows a pending
state and prevents duplicate submissions. Expired or unreadable OAuth checks,
callback failures, and denied authorization offer a readable retry path without
exposing provider error details. An existing session redirects to the dashboard.
The source repository link moves from the header and landing hero to the footer.
The header, hero, footer, and page metadata use Haze Credits, with an H logo.
The header offers Sign in with a GitHub logo to signed-out visitors and only shows Dashboard
when the session contains an authenticated user ID. The hero describes ZK API
credits. The footer shows the product name and source link; the landing page
omits the long credential/traffic note.

The visible Stripe TEST choices are three selectable cards: $5, $20, and $100.
$20 is selected by default. Native radio controls support keyboard selection,
and selecting an amount sends no payment request. One purple Pay with Stripe
button opens Checkout for the selected amount. $5 contributes balance
toward activation; $20 funds one activation; $100 covers five separate activations.
They do not introduce contract tiers. Both Checkout and the billing service
allowlist these amounts, while omitted amounts preserve the existing $20 API.
The stored request binds its amount, and a retry cannot change it. Signed payment
events must match the persisted amount and session before crediting once.

Checkout return verification checks the exact pending request and amount in the
sanitized billing snapshot. An existing positive balance cannot stand in for a
new payment. A delayed webhook leaves an honest verification-pending message.
Pending verification survives reload and an initial snapshot failure. Every
accepted snapshot, including manual refresh after polling stops, reconciles the
exact paid request and clears its retry key before a new top-up is started.

## CROPS review

- **Censorship resistance:** GitHub authentication, Stripe Checkout, the hosted
  frontend, gateway, and shared testnet funder remain access dependencies. A
  gateway status outage no longer blocks rendering. Recovery remains separate
  from account-linked billing. This change does not claim that the hosted flow
  is uncensorable or change contract authority.
- **Open source:** The footer links the AGPL repository, including the frontend,
  billing service, and deployment documentation. GitHub and Stripe remain
  proprietary external services in the sandbox flow.
- **Privacy:** The page states that GitHub identifies the billing account and
  Haze can link it and Stripe test payments to funding history. Credential
  secrets stay on the device. Billing identifiers remain outside spend proofs;
  payment-proof unlinkability does not conceal the account or inference traffic
  from service operators.
- **Security:** Existing authenticated account ownership, internal gateway
  authorization, test-key enforcement, and signed webhook verification remain.
  Amount validation, persisted request binding, and credit-once replay handling
  cover the new choices. Stripe test balance is simulated money, separate from
  the shared funder's Base Sepolia test USDC and gas. Existing reservation and
  ambiguous-funding reconciliation behavior is unchanged. This is a scoped
  feature review, not a contract audit.

## Verification

Behavioral tests were added vertically at the approved browser, Checkout HTTP,
and billing-service seams. Observed failures before implementation included a
$5 payment rejected as invalid, a changed retry amount accepted, a dashboard
waiting for status, and an old balance falsely confirming a new payment.

- Web unit tests: 62 passed across 12 files.
- Web TypeScript check and production build: passed.
- Web lint: zero errors; eight existing archive/config warnings.
- Browser suite: 21 passed, covering held status requests, OAuth pending/errors,
  signed-in redirects, all three packages and retry IDs, delayed payment events,
  source navigation, reload after a failed snapshot, late webhook reconciliation
  by manual refresh after the polling deadline, keyboard/card amount selection
  without a payment request, signed-out navigation after sign-out, and existing
  recovery flows. Desktop and mobile layouts were visually inspected.
- Gateway TypeScript check: passed.
- Sandbox billing, PostgreSQL store, and pilot-route tests: 33 passed with
  `RUN_DB_TESTS=1` against a disposable local PostgreSQL instance. It was stopped
  after the run. No configured remote database was used.
- `git diff --check`: passed.

Browser tests use test-only OAuth configuration and mocked Stripe/gateway
responses. They do not assert a completed real GitHub login, an external Stripe
Checkout payment, or a hosted onchain activation. Those require configured
provider accounts and deployment validation.

Current documentation consulted through Context7:
[Auth.js custom sign-in](https://authjs.dev/guides/pages/signin),
[Stripe Checkout sessions](https://docs.stripe.com/api/checkout/sessions/create),
and [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).
Installed Next.js documentation supplied page, redirect, and loading guidance.
