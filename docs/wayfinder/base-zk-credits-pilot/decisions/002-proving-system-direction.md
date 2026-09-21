# Decision: choose the first production proving-system direction

Status: decided  
Decision date: 2026-09-20

## Decision

Do not run a ceremony or deploy the current circuit. First correct the proof
statement, move to a pinned Circom 2 toolchain, freeze and test the public-signal
ABI, generate the real Solidity verifier integration, and obtain independent
cryptographic review.

If those gates pass, retain BN254 Groth16 for the first production version.
Run a public, circuit-specific phase-2 ceremony only after the circuit source,
compiler, R1CS hash, public-signal order, verification key, verifier adapter,
and deployment manifest are frozen.

## Why

Groth16 gives small proofs and a simple EVM verification path, and the product
already targets this stack. Moving to Noir/Barretenberg would be a full-stack
rewrite and would not remove trusted-setup assumptions: its KZG system uses a
universal structured reference string. Its current production-maturity signal
does not justify the migration for this pilot.

## Revisit when

Reconsider Noir/Barretenberg only if circuit iteration speed becomes a measured
constraint and a benchmarked, audited toolchain offers a material benefit that
outweighs migration and verifier risk.

