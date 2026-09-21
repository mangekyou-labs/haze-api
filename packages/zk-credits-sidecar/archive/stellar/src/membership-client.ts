import {
  deriveMembershipWitness,
  mimcHash,
  skToField,
  type MembershipWitness,
  type PublicMembershipSnapshot,
} from '@zk-credits/shared';

const MAX_SNAPSHOT_AGE_MS = 60_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function parseSnapshot(value: unknown): PublicMembershipSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Membership snapshot is malformed');
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.root !== 'string'
    || typeof snapshot.depth !== 'number'
    || !Array.isArray(snapshot.leaves)
    || !snapshot.leaves.every((leaf) => typeof leaf === 'string')
    || !Array.isArray(snapshot.layers)
    || !snapshot.layers.every((layer) => Array.isArray(layer) && layer.every((node) => typeof node === 'string'))
    || typeof snapshot.generatedAt !== 'string'
  ) {
    throw new Error('Membership snapshot is malformed');
  }
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > MAX_SNAPSHOT_AGE_MS || generatedAt - Date.now() > 5_000) {
    throw new Error('Membership snapshot is stale');
  }
  return {
    root: snapshot.root,
    depth: snapshot.depth,
    leaves: snapshot.leaves,
    layers: snapshot.layers as string[][],
    generatedAt: snapshot.generatedAt,
  };
}

/**
 * Reads only public gateway state. The user's commitment is located locally
 * in the complete snapshot and is never sent in a path or query parameter.
 */
export class MembershipClient {
  private readonly baseUrl: string;

  constructor(gatewayBaseUrl: string, private readonly fetcher: FetchLike = fetch) {
    this.baseUrl = gatewayBaseUrl.replace(/\/$/, '');
  }

  async witnessForSecret(secretK: Uint8Array): Promise<MembershipWitness> {
    const [chainRoot, snapshot] = await Promise.all([
      this.getCurrentChainRoot(),
      this.getSnapshot(),
    ]);
    if (snapshot.root !== chainRoot) {
      throw new Error('Membership snapshot does not match the current chain root');
    }
    const commitment = await mimcHash([BigInt(skToField(secretK))]);
    return deriveMembershipWitness(commitment, snapshot);
  }

  private async getCurrentChainRoot(): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/v1/contract-status`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Current chain root could not be loaded');
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || typeof (payload as { currentRoot?: unknown }).currentRoot !== 'string') {
      throw new Error('Current chain root is unavailable');
    }
    return (payload as { currentRoot: string }).currentRoot;
  }

  private async getSnapshot(): Promise<PublicMembershipSnapshot> {
    const response = await this.fetcher(`${this.baseUrl}/v1/membership-tree`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Membership snapshot could not be loaded');
    return parseSnapshot(await response.json());
  }
}
