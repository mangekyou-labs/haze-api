# Archived Stellar runtime

This directory preserves the historical Stellar/Soroban gateway, BLS12-381
circuits, evaluation routes, fee sponsor, and migration-era tests. They are not
part of the Base Sepolia product build and must not be imported by active
runtime code.

The active product uses `ts/server.ts`, `ts/zk-prepaid-gateway.ts`, and the
isolated `spend_plane` claim store for Base `zk-prepaid` authorization.
