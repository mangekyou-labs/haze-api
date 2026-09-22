/**
 * Provider payloads and conflict adoption.
 *
 * The behaviour under test is what happens when a create call's outcome is not
 * known: the launch must look the resource up by its exact name and adopt it,
 * refuse to choose between two real resources, and refuse to adopt one whose
 * configuration differs from what the create intended. Getting this wrong
 * creates a duplicate contract or a second database in production.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { rpcChainReader } from './deploy.js';
import {
  NEON_API_BASE,
  PILOT_NEON_REGION,
  PILOT_RENDER_REGION,
  VERCEL_PROJECTS_VERSION,
  ProviderRequestError,
  ProviderTimeoutError,
  RESOURCE_NAMES,
  githubOAuthCallback,
  httpTransport,
  neonCreateDatabasePayload,
  neonConnectionUri,
  neonCreateProjectPayload,
  neonProjectAdapter,
  renderCreateServicePayload,
  renderOwnerId,
  renderServiceAdapter,
  resolveResource,
  selectDirectConnectionUri,
  selectSingleOwner,
  vercelCreateProjectPayload,
  vercelProjectAdapter,
  type ResourceAdapter,
} from './providers.js';

interface FakeResource {
  id: string;
  name: string;
  region: string;
}

/** An adapter whose only real behaviour is the create/lookup interaction. */
function adapter(options: {
  name?: string;
  existing?: FakeResource[];
  created?: FakeResource;
  verify?: (candidate: FakeResource) => string[];
  createError?: Error;
  readBack?: FakeResource[];
}): ResourceAdapter<FakeResource> & { creates: number } {
  const state = { creates: 0 };
  let lookupCount = 0;
  return {
    get creates() {
      return state.creates;
    },
    name: options.name ?? RESOURCE_NAMES.neonProject,
    async lookup() {
      lookupCount += 1;
      if (options.existing && options.existing.length > 0) return options.existing;
      // After a create, the read-back lookup returns the created resource.
      if (state.creates > 0 && options.readBack) return options.readBack;
      if (state.creates > 0 && options.created) return [options.created];
      return [];
    },
    idOf: (candidate) => candidate.id,
    identify: (candidate) => `${candidate.name} (${candidate.id})`,
    async create() {
      state.creates += 1;
      if (options.createError) throw options.createError;
      void lookupCount;
      return options.created ?? { id: 'created', name: options.name ?? 'name', region: PILOT_NEON_REGION };
    },
    verify: options.verify ?? (() => []),
    detailOf: (candidate) => ({ id: candidate.id, name: candidate.name, region: candidate.region }),
  };
}

describe('resource resolution', () => {
  it('creates when the exact name does not exist, then reads it back', async () => {
    const target = adapter({ created: { id: 'proj_1', name: RESOURCE_NAMES.neonProject, region: PILOT_NEON_REGION } });
    const resolution = await resolveResource(target);
    expect(resolution.kind).toBe('created');
    expect(target.creates).toBe(1);
    expect(resolution).toMatchObject({ detail: { id: 'proj_1', region: PILOT_NEON_REGION } });
  });

  it('adopts the single existing resource instead of creating a second', async () => {
    const existing = { id: 'proj_9', name: RESOURCE_NAMES.neonProject, region: PILOT_NEON_REGION };
    const target = adapter({ existing: [existing] });
    const resolution = await resolveResource(target);

    expect(resolution.kind).toBe('adopted');
    expect(target.creates).toBe(0);
    expect(resolution).toMatchObject({ detail: { id: 'proj_9' } });
  });

  it('stops and lists the candidates when the name is ambiguous', async () => {
    const target = adapter({
      existing: [
        { id: 'proj_a', name: RESOURCE_NAMES.neonProject, region: PILOT_NEON_REGION },
        { id: 'proj_b', name: RESOURCE_NAMES.neonProject, region: PILOT_NEON_REGION },
      ],
    });
    const resolution = await resolveResource(target);
    expect(resolution.kind).toBe('ambiguous');
    expect(resolution).toMatchObject({
      candidates: [`${RESOURCE_NAMES.neonProject} (proj_a)`, `${RESOURCE_NAMES.neonProject} (proj_b)`],
    });
    expect(target.creates).toBe(0);
  });

  it('refuses to adopt a resource whose configuration drifted from the intent', async () => {
    const target = adapter({
      existing: [{ id: 'proj_9', name: RESOURCE_NAMES.neonProject, region: 'aws-us-east-1' }],
      verify: (candidate) => (candidate.region === PILOT_NEON_REGION ? [] : [`region is ${candidate.region}`]),
    });
    await expect(resolveResource(target)).rejects.toThrow(/does not match the intended configuration: region is aws-us-east-1/u);
  });

  it('refuses a read-back that reports a different number of resources than were created', async () => {
    const target = adapter({
      created: { id: 'proj_1', name: RESOURCE_NAMES.neonProject, region: PILOT_NEON_REGION },
      readBack: [],
    });
    await expect(resolveResource(target)).rejects.toThrow(/reads back as 0 resources/u);
  });

  it('propagates a timeout so the caller records unknown rather than retrying blind', async () => {
    const target = adapter({ createError: new ProviderTimeoutError('create timed out') });
    await expect(resolveResource(target)).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});

describe('owner selection', () => {
  it('auto-selects only when exactly one candidate is visible', () => {
    expect(selectSingleOwner([{ id: 'tea-1', name: 'solo' }])).toEqual({ id: 'tea-1', name: 'solo' });
  });

  it('stops and lists every candidate when several are visible', () => {
    expect(() => selectSingleOwner([
      { id: 'tea-1', name: 'personal' },
      { id: 'tea-2', name: 'team' },
    ])).toThrow(/several owners are visible \(personal \(tea-1\), team \(tea-2\)\)/u);
  });

  it('stops when the token sees no owner at all', () => {
    expect(() => selectSingleOwner([])).toThrow(/no owner visible/u);
  });
});

describe('provider payloads', () => {
  it('pins the Neon project to Singapore with a deterministic name', () => {
    const payload = neonCreateProjectPayload();
    expect(payload).toEqual({
      project: { name: RESOURCE_NAMES.neonProject, region_id: PILOT_NEON_REGION, pg_version: 17 },
    });
    expect(neonCreateDatabasePayload()).toEqual({ database: { name: RESOURCE_NAMES.neonDatabase } });
  });

  it('requires the direct TLS connection string and refuses the pooled host', () => {
    const direct = `postgresql://user:pw@ep-cool-1.aws.neon.tech/${RESOURCE_NAMES.neonDatabase}?sslmode=require`;
    const pooled = `postgresql://user:pw@ep-cool-1-pooler.aws.neon.tech/${RESOURCE_NAMES.neonDatabase}?sslmode=require`;
    expect(selectDirectConnectionUri([pooled, direct])).toBe(direct);
    expect(() => selectDirectConnectionUri([pooled])).toThrow(/only pooled connection strings/u);
  });

  it('refuses a direct connection string that does not require TLS', () => {
    expect(() => selectDirectConnectionUri(['postgresql://user:pw@ep.aws.neon.tech/db']))
      .toThrow(/does not require TLS/u);
  });

  it('keeps every Render secret out of the payload', () => {
    const payload = renderCreateServicePayload({
      name: RESOURCE_NAMES.renderService,
      ownerId: 'tea-1',
      repo: 'https://github.com/mangekyou-labs/haze-api',
      branch: 'feature-base-zk-credits',
      secretKeys: ['DATABASE_URL', 'BILLING_INTERNAL_TOKEN', 'OPENROUTER_API_KEY'],
      plainEnv: { NODE_ENV: 'production' },
    });

    expect(payload.serviceDetails.plan).toBe('free');
    expect(payload.serviceDetails.region).toBe(PILOT_RENDER_REGION);
    expect(payload.autoDeploy).toBe('no');
    expect(payload.serviceDetails.healthCheckPath).toBe('/health');
    expect(payload.serviceDetails).toMatchObject({
      runtime: 'docker',
      envSpecificDetails: { dockerContext: '.', dockerfilePath: './ts/Dockerfile' },
    });
    // A secret is declared, never valued.
    expect(payload.envVars.filter((variable) => variable.sync === false)).toHaveLength(4);
    expect(payload.envVars.find((variable) => variable.key === 'DATABASE_URL')?.value).toBeUndefined();
  });

  it('names the staging service separately from production', () => {
    expect(RESOURCE_NAMES.renderStagingService).not.toBe(RESOURCE_NAMES.renderService);
  });

  it('creates the Vercel project as a Next.js app', () => {
    expect(vercelCreateProjectPayload()).toEqual({ name: RESOURCE_NAMES.vercelProject, framework: 'nextjs' });
  });

  it('derives the GitHub callback from the deployed host', () => {
    expect(githubOAuthCallback('https://zk-credits-web.vercel.app/'))
      .toBe('https://zk-credits-web.vercel.app/api/auth/callback/github');
  });
});

/**
 * A recording transport that answers from a per-URL table, so an adapter can be
 * driven end to end without a network.
 */
function recorder(routes: (request: { method: string; url: string; body?: unknown }) => unknown, created = new Set<string>()) {
  const requests: { method: string; url: string; body?: unknown }[] = [];
  return {
    requests,
    created,
    transport: {
      async send(request: { method: string; url: string; body?: unknown }) {
        requests.push(request);
        return { status: 200, body: routes({ ...request, created } as { method: string; url: string; created: Set<string> }) };
      },
    } as unknown as import('./providers.js').HttpTransport,
  };
}

describe('live provider adapters', () => {
  it('creates the Neon project on the first run and adopts it on the next', async () => {
    const created = new Set<string>();
    const stub = recorder(({ method, url, created: state }) => {
      if (method === 'GET' && url.includes('connection_uri')) {
        return { uri: `postgresql://u:p@ep.aws.neon.tech/${RESOURCE_NAMES.neonDatabase}?sslmode=require` };
      }
      if (method === 'POST') {
        state.add('neon');
        return { project: { id: 'proj_1', name: RESOURCE_NAMES.neonProject, region_id: PILOT_NEON_REGION } };
      }
      return { projects: state.has('neon') ? [{ id: 'proj_1', name: RESOURCE_NAMES.neonProject, region_id: PILOT_NEON_REGION }] : [] };
    }, created);

    const options = { transport: stub.transport, apiKey: 'napi_key' };
    const first = await resolveResource(neonProjectAdapter(options));
    expect(first).toMatchObject({ kind: 'created', detail: { projectId: 'proj_1' } });
    // The request carried the deterministic name and the pilot region.
    const create = stub.requests.find((request) => request.method === 'POST')!;
    expect(create.url).toBe(`${NEON_API_BASE}/projects`);
    expect(create.body).toEqual(neonCreateProjectPayload());

    const second = await resolveResource(neonProjectAdapter(options));
    expect(second.kind).toBe('adopted');
    expect(stub.requests.filter((request) => request.method === 'POST')).toHaveLength(1);

    await expect(neonConnectionUri({ ...options, projectId: 'proj_1' })).resolves.toMatch(/sslmode=require/u);
    const connectionUriRequest = stub.requests.find((request) => request.method === 'GET' && request.url.includes('connection_uri'))!;
    expect(connectionUriRequest.url).toContain('pooled=false');
  });

  it('refuses a Neon project whose region drifted from the pilot region', async () => {
    const stub = recorder(() => ({
      projects: [{ id: 'proj_1', name: RESOURCE_NAMES.neonProject, region_id: 'aws-us-east-1' }],
    }));
    await expect(resolveResource(neonProjectAdapter({ transport: stub.transport, apiKey: 'k' })))
      .rejects.toThrow(/does not match the intended configuration: region is aws-us-east-1/u);
  });

  it('creates the Render service with the free Singapore plan and no secret values', async () => {
    const created = new Set<string>();
    const service = {
      id: 'srv_1',
      name: RESOURCE_NAMES.renderService,
      serviceDetails: { region: PILOT_RENDER_REGION, plan: 'free', healthCheckPath: '/health' },
    };
    const stub = recorder(({ method, created: state }) => {
      if (method === 'POST') {
        state.add('render');
        return { service };
      }
      return state.has('render') ? [{ service }] : [];
    }, created);

    const resolution = await resolveResource(renderServiceAdapter({
      transport: stub.transport,
      apiKey: 'rnd_key',
      ownerId: 'tea-1',
      repo: 'https://github.com/mangekyou-labs/haze-api',
      branch: 'feature-base-zk-credits',
      secretKeys: ['DATABASE_URL', 'BILLING_INTERNAL_TOKEN'],
      plainEnv: { NODE_ENV: 'production' },
    }));
    expect(resolution).toMatchObject({ kind: 'created', detail: { serviceId: 'srv_1', plan: 'free', region: PILOT_RENDER_REGION } });

    const body = stub.requests.find((request) => request.method === 'POST')!.body as {
      envVars: { key: string; value?: string }[];
      serviceDetails: { plan: string; runtime: string; envSpecificDetails: { dockerfilePath: string } };
    };
    expect(body.serviceDetails.plan).toBe('free');
    expect(body.serviceDetails.runtime).toBe('docker');
    expect(body.serviceDetails.envSpecificDetails.dockerfilePath).toBe('./ts/Dockerfile');
    expect(body.envVars.find((variable) => variable.key === 'DATABASE_URL')?.value).toBeUndefined();
  });

  it('refuses a Render service on the wrong plan before adopting it', async () => {
    const service = { id: 'srv_9', name: RESOURCE_NAMES.renderService, serviceDetails: { plan: 'starter' } };
    const stub = recorder(({ method }) => (method === 'POST' ? { service } : [{ service }]));
    await expect(resolveResource(renderServiceAdapter({
      transport: stub.transport,
      apiKey: 'k',
      ownerId: 'tea-1',
      repo: 'r',
      branch: 'b',
    }))).rejects.toThrow(/plan is starter/u);
  });

  it('resolves the Render owner only when exactly one is visible', async () => {
    const single = recorder(() => [{ owner: { id: 'tea-1', name: 'personal' } }]);
    await expect(renderOwnerId(single.transport, 'k')).resolves.toBe('tea-1');

    const several = recorder(() => [{ owner: { id: 'tea-1', name: 'personal' } }, { owner: { id: 'tea-2', name: 'team' } }]);
    await expect(renderOwnerId(several.transport, 'k')).rejects.toThrow(/several owners are visible/u);
  });

  it('creates the Vercel project and reads back the production URL', async () => {
    const created = new Set<string>();
    const project = { id: 'prj_1', name: RESOURCE_NAMES.vercelProject, targets: { production: { url: 'zk-credits-web.vercel.app' } } };
    const stub = recorder(({ method, created: state }) => {
      if (method === 'POST') {
        state.add('vercel');
        return project;
      }
      return { projects: state.has('vercel') ? [project] : [] };
    }, created);

    const resolution = await resolveResource(vercelProjectAdapter({ transport: stub.transport, apiKey: 'vercel_key' }));
    expect(resolution).toMatchObject({ kind: 'created', detail: { url: 'https://zk-credits-web.vercel.app' } });
    expect(stub.requests[0]!.url).toContain(`/${VERCEL_PROJECTS_VERSION}/projects?search=${RESOURCE_NAMES.vercelProject}`);
  });

  it('stops with the candidate list when an exact name matches more than one resource', async () => {
    const stub = recorder(() => ({
      projects: [
        { id: 'prj_1', name: RESOURCE_NAMES.vercelProject },
        { id: 'prj_2', name: RESOURCE_NAMES.vercelProject },
      ],
    }));
    const resolution = await resolveResource(vercelProjectAdapter({ transport: stub.transport, apiKey: 'k' }));
    expect(resolution.kind).toBe('ambiguous');
    expect(resolution).toMatchObject({ candidates: expect.arrayContaining(['zk-credits-web (prj_1)', 'zk-credits-web (prj_2)']) });
  });
});

describe('the JSON-RPC chain reader', () => {
  it('maps a receipt and bytecode response into the reconciliation shape', async () => {
    const chain = rpcChainReader({
      rpcUrl: 'https://rpc.example',
      fetch: (async (_url: string, init: RequestInit) => {
        const { method } = JSON.parse(String(init.body)) as { method: string };
        if (method === 'eth_getTransactionReceipt') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: '0x1', contractAddress: '0xabc', blockNumber: '0x1400000' } }));
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x6080' }));
      }) as unknown as typeof fetch,
    });

    // 0x1400000 is 20971520; the reader reports the block exactly as sent.
    await expect(chain.receipt('0xhash')).resolves.toEqual({
      status: 'success',
      contractAddress: '0xabc',
      blockNumber: 20_971_520n,
      transactionHash: '0xhash',
    });
    await expect(chain.code('0xabc')).resolves.toBe('0x6080');
  });

  it('reports a missing receipt and a JSON-RPC error distinctly', async () => {
    const missing = rpcChainReader({
      rpcUrl: 'https://rpc.example',
      fetch: (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }))) as unknown as typeof fetch,
    });
    await expect(missing.receipt('0xhash')).resolves.toBeUndefined();

    const failing = rpcChainReader({
      rpcUrl: 'https://rpc.example',
      fetch: (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'rate limited' } }))) as unknown as typeof fetch,
    });
    await expect(failing.code('0xabc')).rejects.toThrow(/failed: rate limited/u);
  });
});

describe('http transport', () => {
  it('surfaces a non-2xx response as a request error, not a timeout', async () => {
    const transport = httpTransport({
      fetch: (async () => new Response(JSON.stringify({ error: 'nope' }), { status: 422 })) as typeof fetch,
    });
    await expect(transport.send({ method: 'POST', url: 'https://api.example/x', headers: {} }))
      .rejects.toBeInstanceOf(ProviderRequestError);
  });

  it('turns an aborted request into a timeout so the step is recorded as unknown', async () => {
    const transport = httpTransport({
      timeoutMs: 5,
      fetch: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch,
    });
    await expect(transport.send({ method: 'POST', url: 'https://api.example/slow', headers: {} }))
      .rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('returns the parsed body on success', async () => {
    const transport = httpTransport({
      fetch: (async () => new Response(JSON.stringify({ project: { id: 'proj_1' } }), { status: 201 })) as typeof fetch,
    });
    const response = await transport.send({ method: 'POST', url: 'https://api.example/x', headers: {}, body: {} });
    expect(response).toEqual({ status: 201, body: { project: { id: 'proj_1' } } });
  });
});
