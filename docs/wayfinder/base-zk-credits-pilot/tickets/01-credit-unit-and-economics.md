# Define the pilot credit unit and economic safety envelope

Type: grilling  
Status: resolved  
Blocked by: none

## Question

What precisely does one credit purchase, which provider/model classes may be
used, and what limits guarantee that every accepted request has bounded
upstream cost?

## Why this must be decided

The current $5 service fee over 5,000 calls leaves about $0.000882 per call
after Stripe and before provider, proof, storage, support, and infrastructure
costs. Treating every request as one credit while allowing unrestricted model,
input, or output size creates an unbounded-loss product.

## Recommended answer

Use a small catalog of fixed price classes. Each class fixes the upstream
provider/model, maximum input tokens, maximum output tokens, timeout, replay
cap, and number of bundle credits charged. Reject requests outside the class
before reservation. Start with one class and one provider-compatible endpoint.

Do not market a credit as an arbitrary API call. Define it as a claim on a
specific bounded service class.

## Decision evidence required

- A worst-case contribution-margin sheet including payment fees, upstream
  usage, proof/gateway compute, encrypted replay storage, and support allowance.
- A hard upstream-dollar ceiling for a bundle and for a single request.
- Retry, timeout, cancellation, and provider-error charging rules.
- A named first provider/model class and retail pilot price.

## Downstream consequences

This decision unlocks the provider catalog, rate limits, bundle tiers, replay
limits, and realistic capacity/load tests.

## Answer

Launch one versioned service class, `coding-deepseek-v4-flash-v1`, through the
OpenRouter Chat Completions endpoint. One credit purchases one successfully
committed response from `deepseek/deepseek-v4-flash`; it does not purchase an
arbitrary API call.

The only pilot SKU contains 250 credits, costs a $20 non-refundable service
fee plus a $20 refundable bond, and expires 30 days after activation. The bond
is a liability and is not counted as revenue. Reaching the 1,000-call
continuation gate therefore requires at least four paid bundles or renewals.

### Service-class boundary

- Accept text messages, tool definitions, and tool calls through Chat
  Completions, with one generated choice.
- Do not accept streaming, images, files, audio, web plugins, model fallback,
  client-selected routing, or unknown cost-affecting fields.
- Fix the model server-side and cap input at 16,000 UTF-8 bytes of text and
  tool payload, output at 4,000 tokens, the request body at 256 KiB, the
  encrypted replay at 1 MiB, and the upstream timeout at 120 seconds.
- Reject an input whose conservative unit count exceeds the class limit before
  reserving a credit.
- Set OpenRouter `provider.max_price` to $0.90 per million input tokens and
  $1.80 per million output tokens. Also enforce an effective provider-cost
  ceiling of $0.025 for each dispatch, including the OpenRouter platform fee.
- Do not silently change the purchased service class. If the model becomes
  unavailable or no eligible route fits the ceilings, fail closed and pause
  new checkout. A replacement model or changed economics requires a new
  service-class version and an explicit policy for outstanding credentials.

The selected model currently advertises tool calling and a listed price well
below these conservative price ceilings. The ceilings, rather than a mutable
market quote, define the economic safety envelope.

### Charging and retry rules

Validate locally, then reserve before dispatch. Commit and consume one credit
only after a provider 2xx response is structurally valid, within the replay
limit, fully buffered, encrypted for replay, and durably committed. A valid
provider refusal carried in such a response is chargeable because the service
was delivered.

Local validation failures, non-2xx provider responses, timeouts, malformed or
oversized responses, and failures before commit cancel the reservation and
consume no credit. An exact retry of a committed claim returns the encrypted
replay without another provider dispatch or credit. A client disconnect after
commit still consumes the credit because the response remains replayable.
Ambiguous commit state remains fenced for reconciliation and must never be
blindly cancelled or redispatched.

Permit at most two upstream dispatches for a nullifier. After two failed
dispatches, leave the claim cancelled and reject further attempts until an
operator confirms a provider incident and explicitly resets it. Do not retry
against a fallback model.

### Economic safety envelope

The contribution calculation deliberately uses the price ceilings instead of
the model's lower current listed price:

| Item | Normal full bundle | Two-dispatch worst case |
| --- | ---: | ---: |
| Service-fee revenue | $20.00 | $20.00 |
| Stripe fee on $40 checkout (2.9% + $0.30) | ($1.46) | ($1.46) |
| Provider usage including 5.5% OpenRouter fee | ($5.70) | ($11.39) |
| Support allowance | ($3.00) | ($3.00) |
| Gateway, proof verification, and RPC allowance | ($0.50) | ($0.50) |
| Replay storage and egress allowance | ($0.10) | ($0.10) |
| Fraud and operational-risk allowance | ($1.00) | ($1.00) |
| Remaining contribution | **$8.24 (41.2%)** | **$2.55 (12.7%)** |

At the class ceilings, one maximum-size request has $0.0216 of listed token
cost, or $0.022788 after the OpenRouter fee, beneath the $0.025 dispatch cap.
The corresponding provider ceiling is $5.697 for 250 one-dispatch claims and
$11.394 if all 250 claims use both permitted dispatches; the independent hard
accounting ceilings are $6.25 and $12.50 respectively.

Finally, cap pilot-wide provider spend at $40 per UTC day and $200 per rolling
30 days. Hitting either cap cancels the reservation without consuming a
credit, returns a retryable service-unavailable response, pauses new checkout,
and alerts the operator. Existing credentials remain valid after operator
review and budget reset.

Sources checked on 2026-09-20:

- [DeepSeek V4 Flash on OpenRouter](https://openrouter.ai/deepseek/deepseek-v4-flash/api)
- [OpenRouter pricing](https://openrouter.ai/pricing)
- [Stripe pricing](https://stripe.com/pricing)
