# zk-credits 0.2.11

Status: prepared locally; not published.

- Add `doctor` to report sidecar health, authenticated PID, setup, RPC source, and log location without credential access.
- Add authenticated `stop` with graceful shutdown.
- Preserve the port-conflict error when `x402-agent` is started alongside `serve`.
- Add setup and RPC recovery guidance to errors and `--help`.
- Shorten the package README and product copy.

Validation: package build and 114 sidecar tests passed. Web production build,
typecheck, 45 unit tests, and four landing/onboarding browser tests passed.
Web lint passed with existing warnings.
