include "lib/mimcsponge.circom";
include "lib/mux1.circom";

template DepositMembership(nLevels) {
    signal private input secret_k;
    signal private input merkle_path_elements[nLevels];
    signal private input merkle_path_indices[nLevels];

    signal output root;
    signal output commitment;

    component committer = MiMCSponge(1, 220, 1);
    committer.ins[0] <== secret_k;
    committer.k <== 0;
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
}

component main = DepositMembership(3);
