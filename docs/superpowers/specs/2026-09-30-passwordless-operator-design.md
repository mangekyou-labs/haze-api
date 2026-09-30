# Passwordless operator onboarding

Approved by the owner in the issue 29 operator session on 2026-09-30.
Canonical requirements: https://github.com/mangekyou-labs/haze-api/issues/29
Parent PRD: https://github.com/mangekyou-labs/haze-api/issues/25

The browser creates a version-3 recovery file containing the locally generated
secret. No password is created. Before download, explain that possession allows
spending credits. Require local re-import and commitment comparison before
funding. Wrap the same file with authoritative funding metadata after funding.
Do not persist version-3 secrets in browser local/session storage. Existing
version-1 and version-2 encrypted exports retain explicit legacy import.

The sidecar imports the activated file into the native OS credential store.
Use macOS Keychain, Windows Credential Manager, or persistent Linux Secret
Service. Missing or inaccessible storage fails clearly; there is no plaintext
runtime fallback. Store entries are scoped to the local ZK Credits home.
Restarts and agent launches read this store without a credential password.
The OS can still request permission to access its store.

A separate owner-only RPC setting works before setup and later. The hidden
local `zk-credits config rpc` prompt validates HTTP(S), connectivity and Base
Sepolia chain ID 84532. Explicit BASE_RPC_URL overrides saved settings. No
endpoint/API key is printed. An existing sidecar keeps its endpoint until
restarted. Website and package explain obtaining an operator-owned endpoint
before setup, with a link to Base's provider directory and public rate limits.

Package the pinned proving archive and verify its digest before extracting;
verify individual artifacts afterwards. Normal acquisition requires no gh
session. Prepare a local tarball for isolated testing; npm publication belongs
to the owner. Published 0.2.8 does not implement this design.

Validation covers secret mismatch, legacy imports, secure-store failure,
RPC failure/wrong chain/precedence, archive tampering and an isolated local
package install. Browser automation must keep secrets and identity out of
logs/evidence. A committed operator-selected task is needed for activation;
automation is technical evidence, not external market validation.

Implementation order: credential format and tests; secure-store adapter and
CLI import/runtime; independent RPC config; packaged acquisition; website and
recovery; build/unit checks; local operator journey and redacted issue evidence.
