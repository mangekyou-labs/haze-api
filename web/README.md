# ZK API Credits — web app

Next.js App Router app for the invite-only, experimental Base Sepolia research
pilot: GitHub sign-in, invite redemption, local credential creation and backup,
founder-provisioned test credits, and local credential recovery. External slots
A and C receive a fixed $25 honorarium for a 30-minute session regardless of
setup success. It is not product revenue or willingness-to-pay evidence.

There is no payment step in this app: no card, no wallet flow, no paid plan,
and no recurring charge. Credits are founder-provisioned test credits. The
circuit is experimental and not independently audited. Product calls have no
payment step. For valid spends, the payment proof is designed for payer and
credential unlinkability; the model provider still receives requests.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app needs `AUTH_SECRET`, `AUTH_URL`, and GitHub OAuth credentials
(`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`); copy `.env.example` to
`.env.local` and fill in only what the environment needs. `GATEWAY_URL` points
at the Base gateway, and `ENABLE_DEV_LOGIN=1` enables the test-only credential
provider used by the browser suites.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, after preparing the vendored shared package |
| `npm test -- --run` | Vitest unit and copy-contract suites |
| `npm run test:e2e` | Playwright browser suites (builds and serves the app) |

## Supported clients

The pilot serves one spend path: `POST /v1/chat/completions` through the
project sidecar, or an x402-native agent that explicitly registers the custom
`zk-prepaid` adapter. Generic x402 clients, unmodified agents, public
facilitators, Bazaar, MCP, and the standard `exact` rail are unsupported. The
deployed resource server advertises x402 v2, `zk-prepaid`, `eip155:84532`,
`prepaid-claim`, and `escrow` at `/supported`.

## Privacy boundary

Pilot telemetry does not collect prompts, responses, secrets, proofs,
nullifiers, request signals, or payer/spend-plane joins. The gateway and the
upstream inference provider can still observe request content and traffic
metadata.
