/**
 * Provider payloads and the reconciliation that makes a retry safe.
 *
 * Every external resource is created under a deterministic name, and the
 * decision to create, adopt, or stop is made in one place (`resolveResource`)
 * rather than inside each provider client. That matters because the launch
 * spans operations that cannot be undone: a create call that times out may or
 * may not have happened, and the only safe response is to look the resource up
 * by its exact name before trying again.
 *
 * The rules, in order:
 *
 * 1. an exact-name lookup that finds nothing means create;
 * 2. an exact-name lookup that finds exactly one resource adopts it, then
 *    verifies its configuration against what the create intended;
 * 3. an exact-name lookup that finds several stops and lists them, because
 *    choosing between two real resources is not a decision a script may make;
 * 4. a transport timeout is reported as a timeout, never as a failure, so the
 *    caller records `unknown` state instead of retrying blind.
 *
 * Payload shapes follow the documented provider APIs:
 * https://api-docs.neon.tech/reference/createproject,
 * https://api.render.com/v1/openapi.json, https://vercel.com/docs/rest-api.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { StepDetail } from './state.js';

/**
 * Deterministic resource names. Staging is a separate service and a separate
 * database so a staging run can never touch production state.
 */
export const RESOURCE_NAMES = {
  neonProject: 'zk-credits-pilot',
  neonDatabase: 'zk_credits',
  renderService: 'zk-credits-gateway',
  renderStagingService: 'zk-credits-gateway-staging',
  vercelProject: 'zk-credits-web',
} as const;

/** Singapore, so the pilot runs in one region end to end. */
export const PILOT_NEON_REGION = 'aws-ap-southeast-1';
export const PILOT_RENDER_REGION = 'singapore';

export class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderRequestError extends Error {
  constructor(readonly status: number, readonly body: unknown, message: string) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

/** Narrow transport so tests drive providers without a network. */
export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export interface HttpTransportOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A transport that distinguishes a timeout from a rejection. The distinction is
 * the difference between "safe to reconcile" and "definitely did not happen".
 */
export function httpTransport(options: HttpTransportOptions = {}): HttpTransport {
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await send(request.url, {
          method: request.method,
          headers: { 'content-type': 'application/json', ...request.headers },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new ProviderTimeoutError(`${request.method} ${request.url} timed out`);
        throw error;
      } finally {
        clearTimeout(timer);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      if (!response.ok) {
        throw new ProviderRequestError(response.status, body, `${request.method} ${request.url} answered ${response.status}`);
      }
      return { status: response.status, body };
    },
  };
}

export interface ResourceAdapter<T> {
  /** The deterministic name this resource must carry. */
  name: string;
  /** Exact-name lookup. */
  lookup(): Promise<T[]>;
  /** A stable id for the resource. */
  idOf(candidate: T): string;
  /** A stable human label, used when a conflict must be reported. */
  identify(candidate: T): string;
  /** Non-idempotent create. */
  create(): Promise<T>;
  /** Returns the ways the resource differs from what the create intended. */
  verify(candidate: T): string[];
  /** Secret-free detail safe to persist. */
  detailOf(candidate: T): StepDetail;
}

export type ResourceResolution<T> =
  | { kind: 'created' | 'adopted'; resource: T; detail: StepDetail }
  | { kind: 'ambiguous'; candidates: string[] };

/**
 * Creates the resource, or adopts the single existing one with the same exact
 * name, or stops and reports the conflict.
 */
export async function resolveResource<T>(adapter: ResourceAdapter<T>): Promise<ResourceResolution<T>> {
  const existing = await adapter.lookup();
  if (existing.length > 1) {
    return { kind: 'ambiguous', candidates: existing.map((candidate) => adapter.identify(candidate)) };
  }
  if (existing.length === 1) {
    const mismatches = adapter.verify(existing[0]!);
    if (mismatches.length > 0) {
      throw new Error(`${adapter.name} exists but does not match the intended configuration: ${mismatches.join(', ')}`);
    }
    return { kind: 'adopted', resource: existing[0]!, detail: adapter.detailOf(existing[0]!) };
  }

  await adapter.create();
  // Read back rather than trusting the create response: a create that reported
  // success but did not persist is a defect the next step must not inherit.
  const created = await adapter.lookup();
  if (created.length !== 1) {
    throw new Error(`${adapter.name} was created but reads back as ${created.length} resources`);
  }
  const mismatches = adapter.verify(created[0]!);
  if (mismatches.length > 0) {
    throw new Error(`${adapter.name} was created but does not match the intended configuration: ${mismatches.join(', ')}`);
  }
  return { kind: 'created', resource: created[0]!, detail: adapter.detailOf(created[0]!) };
}

/**
 * An owner or team id may be auto-selected only when the provider returns
 * exactly one candidate. Anything else stops with the candidate list.
 */
export function selectSingleOwner(candidates: { id: string; name: string }[]): { id: string; name: string } {
  if (candidates.length === 0) throw new Error('the token has no owner visible to it; set the owner id explicitly');
  if (candidates.length > 1) {
    const listed = candidates.map((candidate) => `${candidate.name} (${candidate.id})`).join(', ');
    throw new Error(`several owners are visible (${listed}); set the owner id explicitly`);
  }
  return candidates[0]!;
}

// ── Neon ──────────────────────────────────────────────────────────────────

export const NEON_API_BASE = 'https://console.neon.tech/api/v2';

export interface NeonProjectPayload {
  project: { name: string; region_id: string; pg_version: number };
}

export function neonCreateProjectPayload(name: string = RESOURCE_NAMES.neonProject, regionId: string = PILOT_NEON_REGION): NeonProjectPayload {
  return { project: { name, region_id: regionId, pg_version: 17 } };
}

export function neonCreateDatabasePayload(name: string = RESOURCE_NAMES.neonDatabase): { database: { name: string } } {
  return { database: { name } };
}

/**
 * Picks the direct TLS connection string. The pooled host cannot hold the claim
 * store's own transactions, so a pooled URL is refused rather than preferred.
 */
export function selectDirectConnectionUri(uris: string[]): string {
  const direct = uris.filter((uri) => !/-pooler/u.test(uri));
  if (direct.length === 0) throw new Error('the project returned only pooled connection strings');
  const withTls = direct.filter((uri) => uri.includes('sslmode=require'));
  if (withTls.length === 0) throw new Error('the direct connection string does not require TLS');
  return withTls[0]!;
}

export interface NeonProjectRecord {
  id: string;
  name: string;
  region_id?: string;
}

export function neonProjectDetail(record: NeonProjectRecord): StepDetail {
  return { projectId: record.id, name: record.name, region: record.region_id ?? PILOT_NEON_REGION };
}

// ── Render ────────────────────────────────────────────────────────────────

export const RENDER_API_BASE = 'https://api.render.com/v1';

export interface RenderServicePayload {
  type: 'web_service';
  name: string;
  ownerId: string;
  repo: string;
  branch: string;
  autoDeploy: 'no';
  serviceDetails: {
    runtime: 'docker';
    region: string;
    plan: 'free';
    healthCheckPath: string;
    envSpecificDetails: {
      dockerCommand: string;
      dockerContext: string;
      dockerfilePath: string;
    };
  };
  envVars: { key: string; sync: boolean; value?: string }[];
}

/**
 * Free, Singapore, non-auto-deploying. Every secret is declared `sync: false`
 * so its value is supplied out of band and never appears in a payload the
 * launch writes to disk.
 */
export function renderCreateServicePayload(options: {
  name: string;
  ownerId: string;
  repo: string;
  branch: string;
  healthCheckPath?: string;
  secretKeys?: string[];
  plainEnv?: Record<string, string>;
}): RenderServicePayload {
  return {
    type: 'web_service',
    name: options.name,
    ownerId: options.ownerId,
    repo: options.repo,
    branch: options.branch,
    autoDeploy: 'no',
    serviceDetails: {
      runtime: 'docker',
      region: PILOT_RENDER_REGION,
      plan: 'free',
      healthCheckPath: options.healthCheckPath ?? '/health',
      envSpecificDetails: {
        dockerCommand: '',
        dockerContext: '.',
        dockerfilePath: './ts/Dockerfile',
      },
    },
    envVars: [
      ...Object.entries(options.plainEnv ?? {}).map(([key, value]) => ({ key, value, sync: false })),
      ...(options.secretKeys ?? []).map((key) => ({ key, sync: false })),
    ],
  };
}

export interface RenderServiceRecord {
  id: string;
  name: string;
  serviceDetails?: { region?: string; plan?: string; healthCheckPath?: string };
}

export function renderServiceDetail(record: RenderServiceRecord): StepDetail {
  return {
    serviceId: record.id,
    name: record.name,
    region: record.serviceDetails?.region ?? PILOT_RENDER_REGION,
    plan: record.serviceDetails?.plan ?? 'free',
    url: `https://${record.name}.onrender.com`,
  };
}

// ── Vercel ────────────────────────────────────────────────────────────────

export const VERCEL_API_BASE = 'https://api.vercel.com';

export interface VercelProjectPayload {
  name: string;
  framework: 'nextjs';
}

export function vercelCreateProjectPayload(name: string = RESOURCE_NAMES.vercelProject): VercelProjectPayload {
  return { name, framework: 'nextjs' };
}

export interface VercelProjectRecord {
  id: string;
  name: string;
  targets?: { production?: { url?: string } };
}

export function vercelProjectDetail(record: VercelProjectRecord): StepDetail {
  return {
    projectId: record.id,
    name: record.name,
    url: record.targets?.production?.url ? `https://${record.targets.production.url}` : null,
  };
}

/**
 * The GitHub OAuth callback the user must register. It is derived from the
 * deployed host, which is why the OAuth credential pair is deferred until after
 * the web project exists.
 */
export function githubOAuthCallback(webBaseUrl: string): string {
  return `${webBaseUrl.replace(/\/+$/u, '')}/api/auth/callback/github`;
}

// ── Live adapters ─────────────────────────────────────────────────────────

/**
 * The REST versions the payloads above target. They are named constants rather
 * than literals in the request builders so a provider version bump is a
 * one-line change with a failing test rather than a silent drift.
 */
export const VERCEL_PROJECTS_VERSION = 'v9';
export const VERCEL_CREATE_PROJECT_VERSION = 'v11';

function api(transport: HttpTransport, apiKey: string) {
  return async <T>(request: Omit<HttpRequest, 'headers'> & { headers?: Record<string, string> }): Promise<T> => {
    const response = await transport.send({
      ...request,
      headers: { authorization: `Bearer ${apiKey}`, ...request.headers },
    });
    return response.body as T;
  };
}

export interface NeonAdapterOptions {
  transport: HttpTransport;
  apiKey: string;
  name?: string;
  regionId?: string;
}

/**
 * Creates or adopts the pilot Neon project. The connection string is read back
 * separately, because a project is the durable resource and the URI is derived
 * from its endpoint once it is ready.
 */
export function neonProjectAdapter(options: NeonAdapterOptions): ResourceAdapter<NeonProjectRecord> {
  const call = api(options.transport, options.apiKey);
  const name = options.name ?? RESOURCE_NAMES.neonProject;
  const region = options.regionId ?? PILOT_NEON_REGION;

  const list = async (): Promise<NeonProjectRecord[]> => {
    const body = await call<{ projects?: NeonProjectRecord[] }>({
      method: 'GET',
      url: `${NEON_API_BASE}/projects?limit=100`,
    });
    return (body.projects ?? []).filter((project) => project.name === name);
  };

  return {
    name,
    lookup: list,
    idOf: (project) => project.id,
    identify: (project) => `${project.name} (${project.id})`,
    async create() {
      const body = await call<{ project: NeonProjectRecord }>({
        method: 'POST',
        url: `${NEON_API_BASE}/projects`,
        body: neonCreateProjectPayload(name, region),
      });
      return body.project;
    },
    verify: (project) => [
      ...(project.name === name ? [] : [`name is ${project.name}`]),
      ...(project.region_id === undefined || project.region_id === region ? [] : [`region is ${project.region_id}`]),
    ],
    detailOf: neonProjectDetail,
  };
}

/** Reads the project's direct TLS connection string back for the gateway. */
export async function neonConnectionUri(options: NeonAdapterOptions & { projectId: string; roleName?: string }): Promise<string> {
  const call = api(options.transport, options.apiKey);
  const database = RESOURCE_NAMES.neonDatabase;
  const role = options.roleName ?? 'neondb_owner';
  const body = await call<{ uri?: string }>({
    method: 'GET',
    // Neon otherwise defaults this endpoint to the pooler. The pilot gateway
    // needs the direct endpoint so migrations and TLS verification see the
    // project's actual database host.
    url: `${NEON_API_BASE}/projects/${options.projectId}/connection_uri?database_name=${encodeURIComponent(database)}&role_name=${encodeURIComponent(role)}&pooled=false`,
  });
  if (!body.uri) throw new Error('Neon did not return a connection string for the project');
  return selectDirectConnectionUri([body.uri]);
}

export interface RenderAdapterOptions {
  transport: HttpTransport;
  apiKey: string;
  ownerId: string;
  repo: string;
  branch: string;
  name?: string;
  healthCheckPath?: string;
  secretKeys?: string[];
  plainEnv?: Record<string, string>;
}

type RenderServiceResponse = RenderServiceRecord | { service: RenderServiceRecord };

function renderServiceFromResponse(body: RenderServiceResponse): RenderServiceRecord {
  return 'service' in body ? body.service : body;
}

export function renderServiceAdapter(options: RenderAdapterOptions): ResourceAdapter<RenderServiceRecord> {
  const call = api(options.transport, options.apiKey);
  const name = options.name ?? RESOURCE_NAMES.renderService;
  const healthCheckPath = options.healthCheckPath ?? '/health';

  const list = async (): Promise<RenderServiceRecord[]> => {
    const body = await call<RenderServiceResponse[]>({
      method: 'GET',
      url: `${RENDER_API_BASE}/services?name=${encodeURIComponent(name)}&limit=100`,
    });
    return (Array.isArray(body) ? body : [])
      .map((entry) => (entry && typeof entry === 'object' && 'service' in entry ? entry.service : entry))
      .filter((service): service is RenderServiceRecord => Boolean(service) && service.name === name);
  };

  return {
    name,
    lookup: list,
    idOf: (service) => service.id,
    identify: (service) => `${service.name} (${service.id})`,
    async create() {
      const body = await call<RenderServiceResponse>({
        method: 'POST',
        url: `${RENDER_API_BASE}/services`,
        body: renderCreateServicePayload({
          name,
          ownerId: options.ownerId,
          repo: options.repo,
          branch: options.branch,
          healthCheckPath,
          ...(options.secretKeys === undefined ? {} : { secretKeys: options.secretKeys }),
          ...(options.plainEnv === undefined ? {} : { plainEnv: options.plainEnv }),
        }),
      });
      return renderServiceFromResponse(body);
    },
    verify: (service) => {
      const details = service.serviceDetails ?? {};
      return [
        ...(service.name === name ? [] : [`name is ${service.name}`]),
        ...(details.region === undefined || details.region === PILOT_RENDER_REGION ? [] : [`region is ${details.region}`]),
        ...(details.plan === undefined || details.plan === 'free' ? [] : [`plan is ${details.plan}`]),
        ...(details.healthCheckPath === undefined || details.healthCheckPath === healthCheckPath
          ? []
          : [`health check is ${details.healthCheckPath}`]),
      ];
    },
    detailOf: renderServiceDetail,
  };
}

/** Resolves the Render owner, auto-selecting only when exactly one is visible. */
export async function renderOwnerId(transport: HttpTransport, apiKey: string): Promise<string> {
  const body = await api(transport, apiKey)<{ owner: { id: string; name: string } }[]>({
    method: 'GET',
    url: `${RENDER_API_BASE}/owners?limit=100`,
  });
  const candidates = (Array.isArray(body) ? body : []).map((entry) => entry?.owner).filter(Boolean);
  return selectSingleOwner(candidates).id;
}

export interface VercelAdapterOptions {
  transport: HttpTransport;
  apiKey: string;
  name?: string;
  teamId?: string;
}

export function vercelProjectAdapter(options: VercelAdapterOptions): ResourceAdapter<VercelProjectRecord> {
  const call = api(options.transport, options.apiKey);
  const name = options.name ?? RESOURCE_NAMES.vercelProject;
  const scope = options.teamId ? `?teamId=${encodeURIComponent(options.teamId)}` : '';

  const list = async (): Promise<VercelProjectRecord[]> => {
    const body = await call<{ projects?: VercelProjectRecord[] }>({
      method: 'GET',
      url: `${VERCEL_API_BASE}/${VERCEL_PROJECTS_VERSION}/projects?search=${encodeURIComponent(name)}&limit=100${scope ? `&${scope.slice(1)}` : ''}`,
    });
    return (body.projects ?? []).filter((project) => project.name === name);
  };

  return {
    name,
    lookup: list,
    idOf: (project) => project.id,
    identify: (project) => `${project.name} (${project.id})`,
    async create() {
      return await call<VercelProjectRecord>({
        method: 'POST',
        url: `${VERCEL_API_BASE}/${VERCEL_CREATE_PROJECT_VERSION}/projects${scope}`,
        body: vercelCreateProjectPayload(name),
      });
    },
    verify: (project) => (project.name === name ? [] : [`name is ${project.name}`]),
    detailOf: vercelProjectDetail,
  };
}
