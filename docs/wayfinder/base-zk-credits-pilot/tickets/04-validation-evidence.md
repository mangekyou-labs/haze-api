# Define pilot activation and continuation evidence

Type: grilling  
Status: resolved  
Assignee: grok  
Claimed: 2026-09-20  
Resolved: 2026-09-20  
Blocked by: none

## Question

What exact user behavior demonstrates that payer/credential unlinkability is a
must-have product rather than an admired technical feature?

## Recommended answer

Run a four-week validation program:

1. Interview 12–15 people across multi-agent/x402 builders, privacy-oriented
   API operators, and coding-agent power users. Ask for recent incidents,
   workarounds, architecture artifacts, and budget impact—not feature opinions.
2. Select at most three design partners and charge $10–$40 or obtain a dated,
   signed paid-conversion commitment.
3. Concierge-integrate one bounded real endpoint through the sidecar on Base
   Sepolia and observe installation, backup, proof generation, failure, and
   recovery without concealing founder intervention.
4. Run real workloads for 7–14 days and compare the private path with a simpler
   linkable x402 session control.

Use the quantitative continuation gate in the map. If users prefer the
linkable control, narrow the private product further or ship the simpler
session product instead.

## Decision evidence required

- Named recruiting segments and an interview script focused on past behavior.
- Definitions for activation, real call, renewal intent, manual recovery, and
  accepted latency.
- Privacy-safe metrics for checkout-to-proof conversion, p50/p95 proving
  latency, proof failures, retries, replay bytes, weekly return, and successful
  integrations without founder assistance.
- A stop/continue decision owner and review date.

## Downstream consequences

This decision fixes telemetry requirements, onboarding scope, concierge
operations, pricing tests, and the evidence required before any mainnet plan.

## Comments

### Round 1 (2026-09-20)

User accepted all recommended answers:

1. Recruit only the destination wedge: multi-agent operators, plus
   coding-agent operators who already split keys or accounts across agents.
   Disqualify anyone whose last incident is prompt leakage, provider
   blindness, or network anonymity.
2. Must-have evidence is a recent incident with a costly workaround plus an
   artifact. Current paid isolation is supporting evidence. Preference
   without a workaround is a no.
3. Twelve interviews first, then at most three paid partners. No fourth
   concierge backup.
4. Keep 1,000 real calls per partner; that requires at least four live SKUs
   or renewals.
5. Live SKU only ($20 service fee plus $20 bond). No discounted validation
   price, complimentary credentials, or fee waivers.
6. Paper comparison only against a linkable session. Do not implement a
   second rail.
7. Activation is paid live SKU, sidecar on their machine, first real call
   from their agent, secret never handled by us. Two agents are not required
   at activation.
8. Continuation requires two of three partners to run a two-agent
   deployment.
9. Real calls are partner-originated committed claims. Exact retries,
   cancellations, and founder smokes do not count.
10. Founders may install and configure; they may not handle the secret.
    Interventions count as founder assistance, separately from the recovery
    gate.
11. Renewal intent is dated written willingness at the live SKU. Actual
    second checkout is required before any mainnet map, not to pass the
    pilot gate.
12. Manual recovery includes any founder access to secret, password, or
    decrypted export, and re-issuing because backup failed. Walking them
    through their own backup does not fail the gate.
13. Each partner writes a p95 accepted proving latency before the first paid
    claim, measured as local sidecar proving time, no looser than the
    published SLO.
14. The map owner owns stop/continue. Missing any destination line, plus the
    two-agent line, stops continuation toward production. Qualitative notes
    cannot override a missed line. Sepolia R&D may continue.

### Round 2 (2026-09-20)

User accepted all recommended answers:

15. Recruit named operators who already split keys or run multiple agents,
    plus Ethereum Research / x402 builder circles. No public campaign.
16. Week-1 kill unless at least four of twelve meet the incident-plus-artifact
    bar, at least three will pay the live SKU, and at least three already
    split credentials or will in the soak.
17. Use the seven-question past-behavior script, with live artifacts and
    on-the-spot disqualification.
18. Sidecar-local aggregates plus a weekly export. Control plane may know a
    principal paid and activated; it may not join that to nullifiers or
    request signals. Accept the metric ledger as written: destination lines
    plus two-agent are gates; checkout-to-first-real-call, proof failures,
    retries, replay bytes, week-1 return, and zero-assistance integrations
    are measured only. No remaining-credit, per-credential history, or
    prompt fields.
19. Majority of twelve choosing a linkable session for the same job kills
    concierge. A design partner who would rather have the linkable session
    is not a design partner.
20. Real workload is their daily driver or existing agents. Eval harness
    traffic does not count.
21. Days 1–7 interviews; day 7 week-1 sitting; days 8–14 concierge after the
    paid-traffic gate; days 15–28 workload; day 28 stop/continue sitting.
    Hold 8–28 if the circuit gate is late. Do not compress workload below
    14 days. Absolute dates start on interview 1.

## Answer

Payer and credential unlinkability is a must-have only if named operators
who already isolate agents will pay the live SKU, run their own work through
the sidecar, split credentials across two agents, hit 1,000 real calls, and
write that they will buy again — without the team handling a secret.
Preference, synthetic traffic, a cheaper SKU, or a built linkable rail do
not count.

Glossary terms used here are in [CONTEXT.md](../CONTEXT.md).

### Funnel

Recruit twelve interviews from named multi-agent operators and coding-agent
operators who already split keys or accounts, plus Ethereum Research / x402
builder circles. No public campaign and no “privacy API” landing page.
Disqualify anyone whose last incident is prompt leakage, provider blindness,
or network anonymity.

Must-have discovery evidence is a recent incident with a costly workaround
plus an artifact. Current paid isolation is supporting evidence. A preference
with no workaround is a no.

Then select at most three paid design partners. There is no fourth concierge
backup.

### Interview script

Same questions every call. Ask for artifacts live. Do not sell.

1. How many agents currently call paid APIs on your behalf, and who pays?
2. When did a provider, resource server, or platform last correlate those
   agents, share a rate limit, ban a shared key, or attribute spend to the
   wrong owner? When was it, what did it cost, and what is the artifact?
3. What workaround do you run today (separate keys, separate accounts, a
   proxy, per-agent billing identities)? Show it.
4. What would break if the resource server learned which agents share a
   payer?
5. Two paper designs: (A) a linkable session — simple, payer-identifying;
   (B) `zk-prepaid` — local proving, credential backup, ordinary spends
   unlinkable. Which would you deploy for the job in question 2, and why?
6. If B: what p95 extra proving latency is unacceptable, and would you pay
   the live SKU ($20 service + $20 bond, 250 bounded coding calls, 30 days)
   for a Sepolia soak?
7. Would you run a two-agent deployment in that soak?

Disqualify on the spot if question 2 is about prompts, provider blindness,
or anonymity; if there is no workaround; or if they choose A for the same
job. Record notes plus an artifact pointer, not spend-plane identifiers.

### Week-1 kill

After twelve interviews, do not start concierge unless all of these hold:

- at least four of twelve meet the incident-plus-artifact bar;
- at least three will pay the live SKU;
- at least three already split credentials or will in the soak;
- a majority of the twelve would not deploy a linkable session for the same
  job.

A candidate who would rather have a linkable session is not a design
partner. Interviews still count as evidence if concierge is killed.

### Activation and soak

The live SKU is the only conversion instrument ($20 non-refundable service
fee plus $20 refundable bond). No discounted validation price, complimentary
credentials, or fee waivers.

An activated design partner has paid that SKU, runs the sidecar on its own
machine, and has produced at least one real call, without the team handling
its secret. Two agents are not required at activation.

A real call is a committed claim from the partner’s own agent loop: daily
driver for coding-agent partners, existing agents for multi-agent partners.
Exact retries, cancellations, founder smokes, and eval-harness traffic are
not real calls.

Founders may install and configure. They may not see, store, or type a
secret, backup password, or decrypted export, and they may not re-issue a
credential because backup failed. Walking a partner through its own backup
is allowed. Interventions are founder assistance, counted separately from
manual recovery.

Do not implement a second payment rail. The linkable session exists only as
paper comparison in the script and partner brief.

### Continuation gate

This amends the map destination. Continue toward production only if all of
the following are true:

- three activated design partners;
- two partners completing at least 1,000 real calls (at least four live
  SKUs or renewals each);
- two partners with a two-agent deployment;
- two partners with renewal intent at the live SKU;
- p95 local sidecar proving time within the accepted proving latency each
  partner wrote before its first paid claim, and no looser than the
  published SLO from [Choose the pilot prover topology and operational SLOs](06-prover-topology-and-slos.md);
- zero manual recoveries.

The map owner sits stop/continue. A missed line stops a mainnet or ceremony
map. Qualitative notes cannot override it. Sepolia R&D may continue.

Renewal intent is dated written willingness at the live SKU. An actual
second-or-later checkout is required before any mainnet map, not to pass
this gate.

### Evidence plane

Each partner sidecar keeps local aggregates and sends a weekly export: real
calls, p50/p95 prove time, proof failures, exact retries, replay bytes,
founder-assistance events, and week-1 return. No nullifiers, request
signals, prompts, remaining-credit fields, or per-credential history.

The control plane may know that a principal paid and activated. It may not
join those facts to nullifiers or request signals. Founder smokes are tagged
in the sidecar and excluded from the real-call counter. Two-agent evidence
is partner attestation plus two credential backups the partner holds.

| Metric | Source | Gate? |
| --- | --- | --- |
| Interview-to-incident-bar | notes | week-1 kill (≥4/12) |
| Interview-to-paid-SKU | notes + Stripe | week-1 kill (≥3) |
| Interview choice of linkable vs `zk-prepaid` | notes | week-1 kill |
| Checkout-to-first-real-call | sidecar + checkout date | measured |
| Activated design partners | glossary | continuation (≥3) |
| Real calls per partner | sidecar | continuation (≥1,000 for 2) |
| Two-agent deployment | attestation + two backups they hold | continuation (2 of 3) |
| p50/p95 proving latency | sidecar | continuation (p95 ≤ accepted) |
| Proof failures | sidecar | measured |
| Exact retries | sidecar | measured |
| Replay bytes | sidecar | measured |
| Week-1 return (a real call on two distinct UTC days in the first seven days after activation) | sidecar | measured |
| Integrations with zero founder assistance | concierge log | measured |
| Manual recovery | concierge log | continuation (exactly 0) |
| Renewal intent | dated writing | continuation (2 of 3) |
| Actual second-or-later checkout | Stripe | mainnet map only |

### Calendar

Days 1–7 interviews; day 7 week-1 sitting; days 8–14 concierge activation
after the paid-traffic gate on [Freeze the pilot proof and authorization boundary](03-proof-and-authorization-boundary.md);
days 15–28 workload; day 28 stop/continue sitting. If that cryptographic
gate is late, hold days 8–28 rather than soaking on the unsafe circuit. Do
not compress workload below 14 days. Absolute dates start on interview 1.

### Round 3 (2026-09-20)

User confirmed the shared understanding. Ticket closed.

