# Founder demo and investigator integration

Validated on 2026-10-10 in an isolated checkout of `integrate/issues-35-39`.
This integration combines local main's investigator and recording-guide
commits with the already deployed sandbox rollout, then includes the prepared
0.2.12 sidecar changes, concise README, product screenshot and founder checklist.

## Validation

- Backend TypeScript: passed; 427 tests passed, 43 skipped.
- Sidecar build: passed; 142 tests passed.
- Web TypeScript and production build: passed; 53 tests passed.
- Investigator controller: 144 tests passed; offline acceptance passed.
- Registry `latest`: 0.2.12. The README pins that published version.
- README screenshot exists at `docs/images/zk-credits-codex.png`.

The isolated checkout required public proving artifacts and generated runtime
files before the backend and sidecar suites passed. Its build configuration
contains only the existing release RPC and public treasury address and is
excluded from Git.

The investigator planning map is complete. The founder demo remains open for
recording, review and private funding materials. Offline acceptance skips paid
inference and keeps live execution-data purchasing disabled. This integration
does not establish a new paid rehearsal, recording or grant submission.
