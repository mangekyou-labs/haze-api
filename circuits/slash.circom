include "lib/mimcsponge.circom";

template Slash() {
    signal input share1_x;
    signal input share1_y;
    signal input share2_x;
    signal input share2_y;
    signal input epoch;

    signal output extracted_secret_k;
    signal output computed_commitment;

    signal numerator;
    numerator <== share1_y - share2_y;

    signal denominator;
    denominator <== share1_x - share2_x;

    signal inv_denominator;
    inv_denominator <-- 1 / denominator;

    denominator * inv_denominator === 1;

    extracted_secret_k <== numerator * inv_denominator;

    component b_hash = MiMCSponge(2, 220, 1);
    b_hash.ins[0] <== extracted_secret_k;
    b_hash.ins[1] <== epoch;
    b_hash.k <== 0;

    share1_y === extracted_secret_k * share1_x + b_hash.outs[0];
    share2_y === extracted_secret_k * share2_x + b_hash.outs[0];

    component commitment_hash = MiMCSponge(1, 220, 1);
    commitment_hash.ins[0] <== extracted_secret_k;
    commitment_hash.k <== 0;
    computed_commitment <== commitment_hash.outs[0];
}

component main = Slash();
