# B23 public candidate shortlist and outreach drafts

**Prepared:** 2026-09-28  
**Status:** Founder review draft. No one has been contacted or invited.

This is a short list of public project leads for the invite-only, unpaid Base
Sepolia `zk-prepaid` pilot. The links below are first-party project
repositories or documentation. They show relevant public technical work only;
they do **not** establish that a maintainer currently operates an agent, is
available, controls a separate credential, is independent of other candidates,
or wants to participate. Treat each entry as an unverified lead, not a
qualified operator or endorsement.

Do not send an invitation until the hosted launch gate is complete and the
founder has selected and approved the recipient, route, and message. Prefer a
private founder introduction where available. This document records no private
contact details.

## Public project leads

| Route | Public lead | First-party evidence and fit | Still needs private screening |
|---|---|---|---|
| **B — x402-native agent** | [`naividh/agent-procure`](https://github.com/naividh/agent-procure) | Its README describes an autonomous research agent that discovers and pays x402 APIs using `@x402/fetch` on Base Sepolia, with budget controls and an audit trail. The listed paid services are mock services, so the public evidence does not demonstrate a successful call to this pilot's gateway. | Confirm a currently controlled agent can register the pilot's custom `zk-prepaid` adapter, run it from the operator's own environment, and meet the pilot's credential and evidence rules. |
| **B — x402-native agent** | [`tevfikefeaydin/agenttoll`](https://github.com/tevfikefeaydin/agenttoll) | The README describes an x402-paying client, an MCP package, and a self-hosted Base Sepolia development path. It also documents a hosted paid API service. This is evidence of relevant x402 implementation work, not evidence of a qualifying external operator. | Confirm whether the proposed operator can act independently of the hosted service, run a distinct agent, and install/register `zk-prepaid`; the repo documents standard x402 client flows, not this custom scheme. |
| **A/C — coding-agent sidecar** | [`BackTrackCo/tenjin-agent`](https://github.com/BackTrackCo/tenjin-agent) | The README describes a local Claude Code integration with an x402 MCP server, a locally created wallet, and per-call/daily limits. This is a relevant coding-agent and local payment workflow. It does not show use of the `zk-credits` sidecar or routing LLM traffic through it. | Confirm a current coding-agent operator can use the supported sidecar path, controls their own credential, and can run the clean warm-up plus counted request. |
| **A/C — coding-agent sidecar** | [`MikeyPetrillo/Agent402`](https://github.com/MikeyPetrillo/Agent402) | The README documents local MCP use and setup guidance for coding-agent hosts including Codex CLI. It is self-hostable and x402-oriented, which may make its maintainer or user community technically relevant. This does not demonstrate compatibility with the pilot sidecar. | Confirm a specific operator—not merely the project—runs a coding agent, can configure the supported sidecar, and meets the independence and credential requirements. |

All four leads remain **eligibility unverified**. A public code sample, demo,
or maintainer account is not proof of live operation or a separate operator.
The pilot should select only distinct people or organizations after a private
screening conversation; do not infer independence from repository ownership,
handles, or project names.

## Screening points for the founder

Ask each prospective operator to confirm, without sharing secrets:

1. They currently operate an agent or coding-agent environment they control.
2. They can keep the pilot credential and sidecar on their own machine and will
   not send a credential, password, raw prompt, response body, or payment header.
3. They can use the supported client path for their route and run on Base
   Sepolia.
4. They are willing to follow the pilot's clean activation procedure and send
   only the requested redacted schema-version-2 JSON evidence bundle through a
   founder-managed private transfer.
5. They have no relationship that would make their activation non-independent
   from another selected operator or the project team.

The activation must be verified against the live launch gate and gateway
baseline. The public sources linked here do not qualify an activation.

## Outreach drafts for founder review

These are drafts only. No message has been sent. Replace or omit the linked
project reference as appropriate, and obtain approval for the exact recipient
and text before sending.

### x402-native agent lead

> Hello — I’m preparing a small invite-only, unpaid technical pilot on Base
> Sepolia for `zk-prepaid`, a custom x402 v2 scheme. I found your public
> [x402 agent project](https://github.com/naividh/agent-procure) and wondered
> whether you might be open to a short screening conversation. The pilot asks
> an operator to run an agent they control with the supported `zk-prepaid`
> client adapter and complete one clean exchange. No purchase or mainnet
> transaction is part of the pilot. Operators keep their credentials; we ask
> only for a redacted JSON evidence bundle through a private transfer. Would
> you be interested in hearing the setup and eligibility requirements?

### Coding-agent sidecar lead

> Hello — I’m preparing a small invite-only, unpaid Base Sepolia pilot for a
> local `zk-prepaid` sidecar used with a coding agent. I found your public
> [coding-agent integration project](https://github.com/BackTrackCo/tenjin-agent)
> and wanted to ask whether you might be open to a short screening conversation.
> The operator runs the supported sidecar locally, keeps their own credential,
> and completes one clean warm-up and one counted exchange. There is no
> purchase or mainnet transaction. Evidence is limited to a redacted JSON
> bundle sent privately; we do not ask for secrets or prompts. Would you be
> interested in reviewing the requirements?

### Founder introduction request

> I’m looking for a few independent operators for a small, invite-only,
> unpaid Base Sepolia technical pilot. The useful fit is someone who already
> runs their own x402-capable agent or coding agent, can keep a local credential
> private, and is comfortable trying a supported client adapter or sidecar.
> Could you make an opt-in introduction to someone who fits? Please do not
> share anyone’s contact details without their agreement; I can send a short
> description for them to review first.

## Source policy and limits

The shortlist uses only the linked first-party public project repositories.
No secondary reporting or private information was used. Documentation can be
stale; confirm current project state and the operator's own setup in screening.
