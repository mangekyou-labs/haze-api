import type { GatewayStore, MembershipLeaf, MembershipTreeState } from './db/gateway.js';
import { MerkleTree } from './merkle.js';

const TREE_CAPACITY = 8;

export interface MembershipTreeBootstrapSnapshot {
  leaves: string[];
  layers: string[][];
}

/** Parses operator-supplied public snapshot data without accepting a lookup key. */
export function parseMembershipTreeBootstrapSnapshot(raw: string): MembershipTreeBootstrapSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT must be JSON');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT must be a public tree snapshot');
  }
  const snapshot = value as { leaves?: unknown; layers?: unknown };
  if (
    !Array.isArray(snapshot.leaves)
    || !snapshot.leaves.every((leaf) => typeof leaf === 'string')
    || !Array.isArray(snapshot.layers)
    || !snapshot.layers.every((layer) => Array.isArray(layer) && layer.every((node) => typeof node === 'string'))
  ) {
    throw new Error('MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT must contain string leaves and layers');
  }
  return { leaves: snapshot.leaves, layers: snapshot.layers as string[][] };
}

function rootMismatch(): Error {
  return new Error('Membership tree root mismatch; refusing to serve a divergent snapshot');
}

async function buildActiveTree(
  leaves: MembershipLeaf[],
  state: MembershipTreeState | null,
): Promise<{ tree: MerkleTree; activeLeaves: MembershipLeaf[] }> {
  const activeLeaves = leaves.filter((leaf) => leaf.status === 'active');
  if (activeLeaves.length > 0 && !state) throw rootMismatch();
  const tree = state
    ? await MerkleTree.fromLayers(state.layers)
    : new MerkleTree();

  if (state && tree.root().toString() !== state.root) throw rootMismatch();
  for (const leaf of activeLeaves) {
    if (!Number.isInteger(leaf.leafIndex) || leaf.leafIndex < 0 || leaf.leafIndex >= TREE_CAPACITY) {
      throw rootMismatch();
    }
    if (tree.getLeaf(leaf.leafIndex).toString() !== leaf.commitment) throw rootMismatch();
  }

  return {
    tree,
    activeLeaves,
  };
}

/**
 * Rebuilds the public membership tree from durable rows and resolves the one
 * deliberate crash window: a deposit can be chain-confirmed after its local
 * leaf has been staged but before it is activated. Any other divergence is a
 * fail-closed startup error, never a silently different public snapshot.
 */
export async function reconstructMembershipTreeFromStore(
  store: GatewayStore,
  chainRoot: string,
): Promise<MerkleTree> {
  const leaves = await store.listMembershipLeaves();
  const state = await store.getMembershipTreeState();
  const { tree: activeTree } = await buildActiveTree(leaves, state);

  const pending = leaves.filter((leaf) => leaf.status === 'pending');
  if (pending.length === 0) {
    if (chainRoot !== activeTree.root().toString()) throw rootMismatch();
    return activeTree;
  }
  if (pending.length !== 1) throw rootMismatch();

  const staged = pending[0]!;
  if (activeTree.getLeaf(staged.leafIndex) !== 0n) throw rootMismatch();
  const candidateTree = activeTree.clone();
  const candidateRoot = await candidateTree.setLeaf(staged.leafIndex, BigInt(staged.commitment));
  if (candidateRoot.toString() !== staged.candidateRoot) throw rootMismatch();

  if (chainRoot === candidateRoot.toString()) {
    await store.activateMembershipLeaf(
      staged.leafIndex,
      staged.candidateRoot,
      candidateTree.getLayers().map((layer) => layer.map(String)),
    );
    return candidateTree;
  }
  if (chainRoot === activeTree.root().toString()) {
    await store.discardPendingMembershipLeaf(staged.leafIndex);
    return activeTree;
  }
  throw rootMismatch();
}

/**
 * One-time migration aid for deployments that predate durable leaf storage.
 * Layers are required after a removal because zero branches retain their
 * pre-removal hashes; leaves alone would silently canonicalize that tree.
 */
export async function bootstrapMembershipTreeFromSnapshot(
  store: GatewayStore,
  snapshot: { leaves: readonly string[]; layers: readonly (readonly string[])[] },
  chainRoot: string,
): Promise<MerkleTree> {
  const tree = await MerkleTree.fromLayers(snapshot.layers);
  if (snapshot.leaves.length !== tree.getLeaves().length) throw rootMismatch();
  for (let index = 0; index < snapshot.leaves.length; index++) {
    if (BigInt(snapshot.leaves[index]!) !== tree.getLeaf(index)) throw rootMismatch();
  }
  if (tree.root().toString() !== chainRoot) throw rootMismatch();
  await store.bootstrapMembershipTree(
    tree.getLeaves()
      .map((commitment, leafIndex) => ({ leafIndex, commitment: commitment.toString() }))
      .filter((leaf) => leaf.commitment !== '0'),
    {
      root: tree.root().toString(),
      layers: tree.getLayers().map((layer) => layer.map(String)),
    },
  );
  return tree;
}

/**
 * Backwards-compatible bootstrap for additive-only legacy roots. New
 * deployments should provide full `MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT` data.
 */
export async function bootstrapMembershipTreeFromLeaves(
  store: GatewayStore,
  leaves: readonly string[],
  chainRoot: string,
): Promise<MerkleTree> {
  const canonical = await MerkleTree.fromLeaves(leaves);
  return bootstrapMembershipTreeFromSnapshot(store, {
    leaves: canonical.getLeaves().map(String),
    layers: canonical.getLayers().map((layer) => layer.map(String)),
  }, chainRoot);
}
