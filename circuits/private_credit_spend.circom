// SPDX-License-Identifier: AGPL-3.0-or-later
pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";

template PrivateCreditSpend(depth) {
    // Private witness. The credential never leaves the local proxy.
    // Slot blinding is derived in-circuit so the private-input count stays 48.
    signal input secret;
    signal input tier_id;
    signal input expiry;
    signal input slot;
    signal input merkle_path_elements[depth];
    signal input merkle_path_indices[depth];

    // Gateway challenge values. They are private inputs aliased to public
    // outputs; main must not also mark them public.
    signal input root_in;
    signal input timestamp_in;
    signal input domain_in;
    signal input request_signal_in;

    // Public signals, in the canonical order consumed by the verifier adapter:
    // [root, timestamp, domain, requestSignal, nullifier, share].
    signal output root;
    signal output timestamp;
    signal output domain;
    signal output request_signal;
    signal output nullifier;
    signal output share;

    component secret_zero = IsZero();
    secret_zero.in <== secret;
    secret_zero.out === 0;

    component signal_zero = IsZero();
    signal_zero.in <== request_signal_in;
    signal_zero.out === 0;

    // Pilot compiles one funded tier. Extra SKUs need a new freeze.
    tier_id === 0;

    // Slots are any unused index in [0, 250). Num2Bits(8) rejects slot >= 256.
    component slot_bits = Num2Bits(8);
    slot_bits.in <== slot;
    component slot_bound = LessThan(8);
    slot_bound.in[0] <== slot;
    slot_bound.in[1] <== 250;
    slot_bound.out === 1;

    // Expiry and timestamp are uint64 values in the contract. A proof is
    // valid only while the private bundle is unexpired at its proof timestamp.
    component expiry_bits = Num2Bits(64);
    expiry_bits.in <== expiry;
    component timestamp_bits = Num2Bits(64);
    timestamp_bits.in <== timestamp_in;
    component not_expired = LessThan(64);
    not_expired.in[0] <== timestamp_in;
    not_expired.in[1] <== expiry;
    not_expired.out === 1;

    component commitment_hash = Poseidon(1);
    commitment_hash.inputs[0] <== secret;
    signal commitment;
    commitment <== commitment_hash.out;

    component leaf_hash = Poseidon(3);
    leaf_hash.inputs[0] <== commitment;
    leaf_hash.inputs[1] <== tier_id;
    leaf_hash.inputs[2] <== expiry;

    signal node[depth + 1];
    node[0] <== leaf_hash.out;
    component left_hash[depth];
    component right_hash[depth];
    component direction_mux[depth];
    component direction_bit[depth];
    for (var i = 0; i < depth; i++) {
        direction_bit[i] = Num2Bits(1);
        direction_bit[i].in <== merkle_path_indices[i];

        left_hash[i] = Poseidon(2);
        left_hash[i].inputs[0] <== node[i];
        left_hash[i].inputs[1] <== merkle_path_elements[i];

        right_hash[i] = Poseidon(2);
        right_hash[i].inputs[0] <== merkle_path_elements[i];
        right_hash[i].inputs[1] <== node[i];

        direction_mux[i] = MultiMux1(1);
        direction_mux[i].c[0][0] <== left_hash[i].out;
        direction_mux[i].c[0][1] <== right_hash[i].out;
        direction_mux[i].s <== merkle_path_indices[i];
        node[i + 1] <== direction_mux[i].out[0];
    }

    root <== root_in;
    timestamp <== timestamp_in;
    domain <== domain_in;
    request_signal <== request_signal_in;
    node[depth] === root;

    component slot_blinding_hash = Poseidon(3);
    slot_blinding_hash.inputs[0] <== secret;
    slot_blinding_hash.inputs[1] <== slot;
    slot_blinding_hash.inputs[2] <== domain_in;
    signal slot_blinding;
    slot_blinding <== slot_blinding_hash.out;

    component blinding_zero = IsZero();
    blinding_zero.in <== slot_blinding;
    blinding_zero.out === 0;

    component nullifier_hash = Poseidon(1);
    nullifier_hash.inputs[0] <== slot_blinding;
    nullifier <== nullifier_hash.out;

    share <== secret + slot_blinding * request_signal_in;
}

component main = PrivateCreditSpend(20);
