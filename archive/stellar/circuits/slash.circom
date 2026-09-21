include "lib/mimcsponge.circom";
include "lib/mux1.circom";

template Slash(nLevels) {
    signal input share1_x;
    signal input share1_y;
    signal input share2_x;
    signal input share2_y;
    signal private input merkle_path_elements[nLevels];
    signal private input merkle_path_indices[nLevels];

    signal output extracted_secret_k;
    signal output computed_commitment;
    signal output computed_nullifier;
    signal output current_root;
    signal output next_root;

    signal numerator;
    numerator <== share1_y - share2_y;

    signal denominator;
    denominator <== share1_x - share2_x;

    signal inv_denominator;
    inv_denominator <-- 1 / denominator;

    denominator * inv_denominator === 1;

    // Recovering the slope directly from two points is enough for the slash
    // statement. Do not hash (k, epoch): indexed tickets use a = H(k, i),
    // and the original index remains private to the spend proofs.
    signal recovered_slope;
    recovered_slope <== numerator * inv_denominator;
    extracted_secret_k <== share1_y - recovered_slope * share1_x;
    share1_y === extracted_secret_k + recovered_slope * share1_x;
    share2_y === extracted_secret_k + recovered_slope * share2_x;

    component commitment_hash = MiMCSponge(1, 220, 1);
    commitment_hash.ins[0] <== extracted_secret_k;
    commitment_hash.k <== 0;
    computed_commitment <== commitment_hash.outs[0];

    component nullifier_hash = MiMCSponge(1, 220, 1);
    nullifier_hash.ins[0] <== recovered_slope;
    nullifier_hash.k <== 0;
    computed_nullifier <== nullifier_hash.outs[0];

    // Bind the recovered commitment to the active membership root and prove
    // the post-removal root obtained by replacing that leaf with zero. The
    // contract accepts the transition atomically and clears historical roots,
    // so a slashed member cannot continue spending against an old root.
    signal current_nodes[nLevels + 1];
    signal next_nodes[nLevels + 1];
    current_nodes[0] <== computed_commitment;
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

component main = Slash(3);
