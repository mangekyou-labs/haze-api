-- 0008: durable active-membership tree (M5.0).
--
-- This state is intentionally separate from gateway.accepted_calls. The tree
-- needs commitments and leaf positions to construct public Merkle snapshots,
-- while the anonymous call path must never obtain a commitment join.

CREATE TABLE IF NOT EXISTS gateway.membership_tree_leaves (
    leaf_index     integer PRIMARY KEY CHECK (leaf_index >= 0 AND leaf_index < 8),
    commitment     text NOT NULL UNIQUE,
    status         text NOT NULL CHECK (status IN ('pending', 'active', 'removed')),
    candidate_root text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gateway.membership_tree_state (
    tree_name  text PRIMARY KEY CHECK (tree_name = 'active_membership'),
    root       text NOT NULL,
    version    bigint NOT NULL CHECK (version >= 0),
    layers     jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_membership_tree_leaves_status
    ON gateway.membership_tree_leaves (status, leaf_index);

-- Deposits are serialized at the gateway. Retaining at most one pending row
-- makes crash recovery unambiguous even if multiple gateway processes share
-- the same database.
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_tree_single_pending
    ON gateway.membership_tree_leaves (status)
    WHERE status = 'pending';
