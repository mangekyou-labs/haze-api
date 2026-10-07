# Recorded evidence

`manifest.json` binds the authentic mainnet receipt and historical Error(string)
replay recording. `owner-rpc-manifest.json` binds four authentic failed Base
Sepolia transaction/receipt/block recordings from the owner-configured read-only
RPC. The endpoint URL and credentials are excluded. The Sepolia historical replay
in `sepolia-authentic-1.json` returns `RO#7`; it cannot prove original execution
cause. Each recording includes an authentic unavailable debug trace response.

The `sepolia-execution-error.json` name identifies a candidate: its authentic
failed receipt and replay error do **not** establish original out-of-gas execution.
Those original RPC/explorer attempts did not establish contract verification
status. Missing metadata does not prove a contract unverified.

## Original execution recordings

`execution-manifest.json` binds the new read-only Tenderly recordings and their
normalized investigator fixtures. The public transaction API returned original
call traces for two failed Base mainnet transactions; this is transaction tracing,
not an end-of-block `eth_call` simulation. Exact API bytes are retained in
`tenderly-*.raw.json`. The normalized trees rename `call_type` to `type` and nest
the flat `trace_address` paths, preserving every recorded call and byte field.
No absent input, output, error, or provider identifier is invented.

- `authentic-nested-failure.json` uses the existing authentic RPC receipt/block
  and the matching Tenderly transaction trace. The deepest failing call at
  `calls.0.calls.0.calls.0` returns `Error("p address!")`. A parent token transfer
  is visible, but the trace alone does not establish a balance, allowance, or
  policy explanation for its failure.
- `authentic-execution-error.json` binds the Tenderly original root call error
  `out of gas` to separately collected transaction/failed receipt/canonical block
  results from the public Tenderly Base RPC. Full gas consumption alone is not
  the diagnosis evidence.
- `tenderly-unverified-contract.raw.json` explicitly reports
  `type: unverified_contract` for the deepest nested callee. This establishes
  Tenderly's verification status at collection time; it says nothing about all
  other registries or verification status at the time of execution. Standard
  `Error(string)` decoding needs no contract ABI.

Run `node --test examples/base-transaction-investigator/authentic-fixtures.test.mjs`
from the repo root after building the example. The checks verify digests,
chain/transaction/block identity, lossless call normalization, evidence-linked
reports, durable reuse, and absence of real signing/inference. Missing-trace
acceptance retains the authentic unsupported-method recording. Simulated quote
and settlement observations remain doubles even when trace bytes are authentic.

The trace route is described in [Tenderly's documentation](https://docs.tenderly.co/monitoring/web3-actions/tutorials/validators-exits).
Collection used only read-only GET and RPC methods, with no credentials or spend.

Controller fault fixtures use synthetic nested calls and malformed traces;
quoted terms, payment outcomes, provider faults and model responses are doubles.
These checks never substitute for the authentic execution recordings above.
Real signing stays disabled.
