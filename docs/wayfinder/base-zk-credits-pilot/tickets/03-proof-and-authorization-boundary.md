# Freeze the pilot proof and authorization boundary

Type: grilling  
Status: resolved  
Assignee: grok  
Claimed: 2026-09-20  
Resolved: 2026-09-20  
Blocked by: none

## Question

What exact statement authorizes one request, which values are public and
private, how is freshness enforced, and what evidence is sufficient to accept
the corrected construction for a paid Sepolia pilot?

## Recommended answer

Specialize the paper's fixed-cost construction rather than inventing a new
share equation:

- `a = H(secret, slot, domain)` remains private;
- `nullifier = H(a)` is public;
- `x = H(canonical request message)` is public;
- `share = secret + a * x` is public;
- membership path, secret, slot, tier, and expiry remain private unless a
  specific policy requires disclosure; and
- public signals have one versioned canonical order shared by circuit,
  TypeScript, gateway, verifier adapter, fixtures, and manifest.

Bind authorization to a server challenge or enforce both maximum future skew
and maximum age. Separate the short-lived spend-authorization policy from the
historical evidence policy needed for duplicate-nullifier recovery. Avoid
letting a user-selected timestamp extend bundle life.

Use Circom 2 plus BN254 Groth16 for the pilot direction, but do not create
production proving keys yet.

## Decision evidence required

- A written security statement and threat model reviewed by an independent
  cryptographer.
- R1CS inspection showing the intended private/public counts.
- Negative tests for witness disclosure, stale proof use, cross-domain replay,
  reordered public signals, malformed field encodings, and historical roots.
- An end-to-end generated proof verified by the actual Solidity verifier and
  adapter on Base Sepolia.
- A two-transcript recovery test proving that one valid transcript reveals
  nothing useful while duplicate use with different messages enables the
  intended recovery and slashing path.

## Downstream consequences

This decision unlocks artifact generation, proof benchmarks, verifier gas
benchmarks, replay retention policy, prover topology, and a later ceremony
plan.

## Answer

A spend proof authorizes one claim of one credit if and only if it shows
membership of a private leaf `Poseidon(commitment, tier_id, expiry)` in a
known depth-20 Merkle root; `commitment = Poseidon(secret)`; `slot < 250`
for the single funded pilot tier; `timestamp < expiry` where `timestamp` is
the gateway-issued `issuedAt`; matching deployment domain; and the restored
share equation with hidden slot blinding.

Any unused slot in `[0, 250)` is allowed. Uniqueness is the nullifier.

### Algebra

- `slotBlinding = Poseidon(secret, slot, domain)` — private
- `nullifier = Poseidon(slotBlinding)` — public
- `requestSignal` — public; existing canonical hash-to-field
- `share = secret + slotBlinding * requestSignal` — public

One transcript does not reveal `secret` or slot blinding. Two transcripts
with the same nullifier and different request signals recover
`slotBlinding = (share1 - share2) / (x1 - x2)`, then
`secret = share1 - slotBlinding * x1`, then require
`Poseidon(slotBlinding) == nullifier` and
`Poseidon(secret) == commitment`.

The current equation `share = secret * requestSignal + nullifier` is
rejected. On-chain recovery that treats `(share1 - share2) / (x1 - x2)` as
the secret must change.

Private: secret, slot blinding, slot, tier, expiry, Merkle path and
directions. Public: root, timestamp, domain, request signal, nullifier,
share.

### Public ABI

Exactly six public outputs, in this order, shared by circuit, TypeScript,
gateway, verifier adapter, fixtures, and manifest:

`[root, timestamp, domain, requestSignal, nullifier, share]`

48 private inputs. Circom 2 with an explicit `pragma` and a `main`
declaration that does not also mark the four challenge values public.
Verifiers use `fullProve` public signals as-is. Leaf shape stays
`Poseidon(commitment, tier_id, expiry)`. The 5000/25000/75000 allowance
table is not compiled into the pilot circuit. Additional SKUs are a new
tier row and a new freeze.

Circuit rejects `secret == 0`, `slotBlinding == 0`, and
`requestSignal == 0`. The gateway also rejects a zero request signal.

### Spend authorization

402 `extra.issuedAt` is unix seconds. Public `timestamp` must equal it.
`issuedAt` must lie in `[now - 300s, now + 5s]`, using `maxTimeoutSeconds`
from [Choose the pilot x402 interoperability posture](02-x402-interoperability.md).
The request signal must match this HTTP request. Same nullifier and signal
coalesces; a different signal is conflict evidence and fail-closed. The
client does not choose the timestamp. Cached 402s die when `issuedAt`
leaves the window.

This amends that ticket's 402 `extra` with `issuedAt`. Bundle identity is
still not named in the challenge.

### Slash evidence

No live 402 and no 300-second window. On-chain keeps known root, domain,
`timestamp <= block.timestamp`, `timestamp < expiry`, two valid proofs,
same nullifier, different signals, restored recovery, and both Poseidon
checks. Encrypted first-transcript evidence is retained until bundle
expiry plus the seven-day challenge window, then deleted. The 24-hour
exact-retry replay ciphertext is not slash evidence. A reporter may submit
any two valid conflicting transcripts, including ones the live gateway
never served.

### Paid-traffic gate

Before onboarding paid partners or claiming unlinkability:

- written security statement and threat model reviewed by an independent
  cryptographer, covering this statement and the implemented artifacts;
- R1CS inspection of 6 public / 48 private;
- negative tests for witness disclosure, stale spend proofs, post-expiry
  spend, cross-domain replay, reordered public signals, malformed field
  encodings, historical roots, zero request signal, and zero slot
  blinding;
- an end-to-end generated proof verified by the real Solidity verifier and
  adapter on Base Sepolia;
- a two-transcript recovery test: one share is harmless; duplicate use
  with a different request signal recovers and slashes.

Development proving keys are allowed on Sepolia. No production ceremony.
Circom 2 plus BN254 Groth16 remains the proving direction from
[Choose the first production proving-system direction](../decisions/002-proving-system-direction.md).

Tree depth 20, historical roots, and permissionless `slashBundle` are
carried forward from the current design.

## Comments

### Round 1 (2026-09-20)

User accepted all recommended answers:

1. Restore the paper construction with domain-separated slot blinding:
   `a = Poseidon(secret, slot, domain)` private, `nullifier = Poseidon(a)`
   public, `x` the existing request signal, `share = secret + a * x` public.
2. Keep secret, slot blinding, slot, tier, expiry, and Merkle path private.
   Public set remains root, timestamp, domain, request signal, nullifier,
   share.
3. Any unused slot strictly below the in-circuit allowance; uniqueness is the
   nullifier.
4. The ticket's cryptographic evidence list is the paid-traffic and
   unlinkability-claim gate, including independent review of the written
   statement and implemented artifacts. Development proving keys on Sepolia
   only; no production ceremony.

### Round 2 (2026-09-20)

User accepted all recommended answers:

5. Spend freshness is a gateway-issued `issuedAt` in the 402 `extra`. The
   public timestamp must equal that value; the circuit proves `timestamp <
   expiry`. Spend path rejects `issuedAt` outside `[now - 300s, now + 5s]`.
   The client does not choose the timestamp. This amends the x402 extra
   from ticket 2; slash policy is separate.
6. Public ABI is exactly six outputs in order `[root, timestamp, domain,
   requestSignal, nullifier, share]`. 48 private inputs; Circom 2 pragma;
   `fullProve` public signals used as-is. Poseidon arities and recovery
   equation frozen as recommended.
7. Circuit and gateway reject `requestSignal == 0`; circuit rejects slot
   blinding `== 0` and `secret == 0`.

### Round 3 (2026-09-20)

User accepted all recommended answers:

8. Spend authorization requires `timestamp == extra.issuedAt` inside a
   300s/5s window. Slash evidence does not. On-chain keeps known root,
   domain, `timestamp <= block.timestamp`, `timestamp < expiry`. Recovery
   uses the restored algebra plus both Poseidon checks. Encrypted first
   transcript is kept until expiry + 7 days. Exact-retry replay stays 24h
   and is not slash evidence.
9. Pilot circuit has one funded tier whose in-circuit allowance is 250.
   Leaf shape remains `Poseidon(commitment, tier_id, expiry)`. The
   5000/25000/75000 table is not compiled into the pilot circuit.

