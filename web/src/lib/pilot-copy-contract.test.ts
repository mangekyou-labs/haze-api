import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Copy-contract freeze for the invite-only, unpaid, experimental Base Sepolia
// pilot. The scan is limited to these explicitly active surfaces: repository
// and installation guides, landing metadata and page, footer, sign-in,
// onboarding, dashboard, and recovery. Archives, historical design documents,
// backend payment routes, and dormant components are intentionally excluded.
const ACTIVE_COPY = [
  'README.md',
  'web/README.md',
  'contracts/README.md',
  'packages/zk-credits-sidecar/README.md',
  'packages/x402-zk-prepaid/README.md',
  'web/src/app/layout.tsx',
  'web/src/app/page.tsx',
  'web/src/components/site-footer.tsx',
  'web/src/app/sign-in/page.tsx',
  'web/src/app/onboarding/page.tsx',
  'web/src/app/dashboard/page.tsx',
  'web/src/app/dashboard/pilot-onboarding-flow.tsx',
  'web/src/app/recover/page.tsx',
  'web/src/app/recover/recover-credential-form.tsx',
] as const;

const METADATA_SOURCE = 'web/src/app/layout.tsx';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), '..', relativePath), 'utf8');
}

const sources = ACTIVE_COPY.map((relativePath) => ({ relativePath, contents: read(relativePath) }));
const combined = sources.map(({ contents }) => contents).join('\n');

const REQUIRED_CONTRACT = [
  { label: 'invite-only access', pattern: /\binvite-only\b/i },
  { label: 'unpaid pilot status', pattern: /\bunpaid\b/i },
  { label: 'experimental pilot status', pattern: /\bexperimental\b/i },
  { label: 'Base Sepolia network', pattern: /\bBase Sepolia\b/ },
  { label: 'founder-provisioned test credits', pattern: /founder-provisioned test credits/i },
  { label: 'project sidecar client', pattern: /project sidecar/ },
  { label: 'OpenAI-compatible spend path', pattern: /POST \/v1\/chat\/completions/ },
  { label: 'x402-native adapter client', pattern: /x402-native agent/ },
  { label: 'zk-prepaid scheme', pattern: /\bzk-prepaid\b/ },
  { label: 'deployed /supported advertisement', pattern: /\/supported/ },
  { label: 'x402 v2 advertisement', pattern: /x402 v2/ },
  { label: 'network advertisement', pattern: /eip155:84532/ },
  { label: 'prepaid-claim advertisement', pattern: /prepaid-claim/ },
  { label: 'escrow advertisement', pattern: /\bescrow\b/ },
  { label: 'unsupported generic x402 clients', pattern: /generic x402 clients/i },
  { label: 'unsupported public facilitators', pattern: /public facilitators/i },
  { label: 'unsupported Bazaar', pattern: /\bBazaar\b/ },
  { label: 'unsupported MCP', pattern: /\bMCP\b/ },
  { label: 'unsupported exact rail', pattern: /exact`?\s+rail/i },
  { label: 'independent audit warning', pattern: /not (?:been )?independently audited/i },
  {
    label: 'telemetry privacy boundary',
    pattern: /Pilot telemetry does not collect[\s\S]{0,200}payer\/spend-plane joins/,
  },
  {
    label: 'provider observation disclosure',
    pattern:
      /gateway\s+and\s+the\s+upstream\s+provider\s+can\s+still\s+observe\s+request\s+content\s+and\s+traffic\s+metadata/i,
  },
];

const REQUIRED_IN_METADATA = [
  { label: 'pilot status', pattern: /invite-only, unpaid, experimental Base Sepolia pilot/i },
  { label: 'audit warning', pattern: /not independently audited/i },
];

const REJECTED_TERMS = [
  { label: 'Stripe', pattern: /\bstripe\b/i },
  { label: 'checkout', pattern: /\bcheckout\b/i },
  { label: 'buy or purchase', pattern: /\bbuy(?:ing)?\b|\bpurchas(?:e|es|ed|ing)\b/i },
  { label: 'price or pricing', pattern: /\bprice|\bpricing\b/i },
  { label: 'renewal', pattern: /\brenew/i },
  { label: 'SKU', pattern: /\bsku\b/i },
  { label: 'legacy plan names', pattern: /\b(?:starter|builder|scale)\b/i },
  { label: 'fixed 30-day validity', pattern: /\b(?:30[- ]day|thirty[- ]day)\b/i },
  { label: 'subscription', pattern: /subscri/i },
  { label: 'dollar pricing', pattern: /\$\d/ },
  { label: 'broad anonymity claim', pattern: /\banonym(?:ous|ity)\b/i },
];

describe('pilot copy contract', () => {
  it.each(REQUIRED_CONTRACT)('states $label', ({ pattern }) => {
    expect(combined).toMatch(pattern);
  });

  it.each(REQUIRED_IN_METADATA)('states $label in the landing metadata', ({ pattern }) => {
    expect(read(METADATA_SOURCE)).toMatch(pattern);
  });

  it.each(REJECTED_TERMS)('rejects $label on every active surface', ({ pattern }) => {
    const offenders = sources
      .filter(({ contents }) => pattern.test(contents))
      .map(({ relativePath }) => relativePath);
    expect(offenders).toEqual([]);
  });
});
