include "lib/mimcsponge.circom";
include "lib/mux1.circom";

// Proves that a browser-held secret owns a commitment in the active Merkle
// tree and derives the root obtained by replacing that leaf with zero. The
// three outputs are public so the contract can verify the transition without
// learning secret_k or the private Merkle path.
template MembershipRemoval(nLevels) {
    signal private input secret_k;
    signal private input merkle_path_elements[nLevels];
    signal private input merkle_path_indices[nLevels];

    signal output commitment;
    signal output current_root;
    signal output next_root;

    component commitment_hash = MiMCSponge(1, 220, 1);
    commitment_hash.ins[0] <== secret_k;
    commitment_hash.k <== 0;
    commitment <== commitment_hash.outs[0];

    signal current_nodes[nLevels + 1];
    signal next_nodes[nLevels + 1];
    current_nodes[0] <== commitment;
    next_nodes[0] <== 0;

    component current_left[nLevels];
    component current_right[nLevels];
    component current_mux[nLevels];
    component next_left[nLevels];
    component next_right[nLevels];
    component next_mux[nLevels];

    for (var level = 0; level < nLevels; level++) {
        current_left[level] = MiMCSponge(2, 220, 1);
        current_left[level].ins[0] <== current_nodes[level];
        current_left[level].ins[1] <== merkle_path_elements[level];
        current_left[level].k <== 0;

        current_right[level] = MiMCSponge(2, 220, 1);
        current_right[level].ins[0] <== merkle_path_elements[level];
        current_right[level].ins[1] <== current_nodes[level];
        current_right[level].k <== 0;

        current_mux[level] = MultiMux1(1);
        current_mux[level].c[0][0] <== current_left[level].outs[0];
        current_mux[level].c[0][1] <== current_right[level].outs[0];
        current_mux[level].s <== merkle_path_indices[level];
        current_nodes[level + 1] <== current_mux[level].out[0];

        next_left[level] = MiMCSponge(2, 220, 1);
        next_left[level].ins[0] <== next_nodes[level];
        next_left[level].ins[1] <== merkle_path_elements[level];
        next_left[level].k <== 0;

        next_right[level] = MiMCSponge(2, 220, 1);
        next_right[level].ins[0] <== merkle_path_elements[level];
        next_right[level].ins[1] <== next_nodes[level];
        next_right[level].k <== 0;

        next_mux[level] = MultiMux1(1);
        next_mux[level].c[0][0] <== next_left[level].outs[0];
        next_mux[level].c[0][1] <== next_right[level].outs[0];
        next_mux[level].s <== merkle_path_indices[level];
        next_nodes[level + 1] <== next_mux[level].out[0];
    }

    current_root <== current_nodes[nLevels];
    next_root <== next_nodes[nLevels];
}

component main = MembershipRemoval(3);
