include "lib/mimcsponge.circom";
include "lib/mux1.circom";
include "lib/bitify.circom";
include "lib/comparators.circom";

template RlnNullifier(nLevels) {
    signal private input secret_k;
    signal private input ticket_index;
    signal private input request_digest;
    signal private input merkle_path_elements[nLevels];
    signal private input merkle_path_indices[nLevels];

    signal output root;
    signal output nullifier;
    signal output share_x;
    signal output share_y;

    component committer = MiMCSponge(1, 220, 1);
    committer.ins[0] <== secret_k;
    committer.k <== 0;
    signal commitment;
    commitment <== committer.outs[0];

    component l0 = MiMCSponge(2, 220, 1);
    l0.ins[0] <== commitment;
    l0.ins[1] <== merkle_path_elements[0];
    l0.k <== 0;

    component r0 = MiMCSponge(2, 220, 1);
    r0.ins[0] <== merkle_path_elements[0];
    r0.ins[1] <== commitment;
    r0.k <== 0;

    component m0 = MultiMux1(1);
    m0.c[0][0] <== l0.outs[0];
    m0.c[0][1] <== r0.outs[0];
    m0.s <== merkle_path_indices[0];

    component l1 = MiMCSponge(2, 220, 1);
    l1.ins[0] <== m0.out[0];
    l1.ins[1] <== merkle_path_elements[1];
    l1.k <== 0;

    component r1 = MiMCSponge(2, 220, 1);
    r1.ins[0] <== merkle_path_elements[1];
    r1.ins[1] <== m0.out[0];
    r1.k <== 0;

    component m1 = MultiMux1(1);
    m1.c[0][0] <== l1.outs[0];
    m1.c[0][1] <== r1.outs[0];
    m1.s <== merkle_path_indices[1];

    component l2 = MiMCSponge(2, 220, 1);
    l2.ins[0] <== m1.out[0];
    l2.ins[1] <== merkle_path_elements[2];
    l2.k <== 0;

    component r2 = MiMCSponge(2, 220, 1);
    r2.ins[0] <== merkle_path_elements[2];
    r2.ins[1] <== m1.out[0];
    r2.k <== 0;

    component m2 = MultiMux1(1);
    m2.c[0][0] <== l2.outs[0];
    m2.c[0][1] <== r2.outs[0];
    m2.s <== merkle_path_indices[2];

    root <== m2.out[0];

    // Fixed Starter package: exactly 100 private ticket indices. Num2Bits
    // prevents a field element from being used as an arbitrary index, while
    // LessThan enforces the paper's solvency bound (i + 1) * C <= D with
    // D = 100 * C and R = 0.
    component index_bits = Num2Bits(7);
    index_bits.in <== ticket_index;

    component index_bound = LessThan(7);
    index_bound.in[0] <== ticket_index;
    index_bound.in[1] <== 100;
    index_bound.out === 1;

    component slope_hash = MiMCSponge(2, 220, 1);
    slope_hash.ins[0] <== secret_k;
    slope_hash.ins[1] <== ticket_index;
    slope_hash.k <== 0;

    component nullifier_hash = MiMCSponge(1, 220, 1);
    nullifier_hash.ins[0] <== slope_hash.outs[0];
    nullifier_hash.k <== 0;
    nullifier <== nullifier_hash.outs[0];

    // request_digest is already the canonical request hash reduced into Fr;
    // expose exactly that value as the public request point x.
    share_x <== request_digest;

    share_y <== secret_k + slope_hash.outs[0] * share_x;
}

component main = RlnNullifier(3);
