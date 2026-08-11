# Codex Companion for ZK Credits

**Date:** 2026-08-11
**Status:** Approved in conversation
**Scope:** Package the existing proof-aware sidecar as a one-time Codex setup and one-command coding-agent experience.

## Goal

A Codex CLI user installs ZK Credits, completes one private identity setup, and
then starts a proof-backed coding session with one command:

```sh
zk-credits setup codex
zk-credits codex
```

The user never manually starts the sidecar, exports an API key, edits Codex
TOML, or handles a Render credential. Every Codex Responses request still
receives a fresh local ZK proof and follows the existing Render gateway path.

## Product approaches considered

1. **Companion CLI and background sidecar (chosen).** Extend the existing
   package with setup, command-backed local authentication, automatic sidecar
   startup, status, and a Codex launcher. This preserves local proof custody
   and fits Codex CLI users without introducing a second application runtime.
2. **Signed desktop/tray application.** This can eventually provide graphical
   onboarding and OS login startup, but signing, updates, platform packaging,
   and browser-to-app identity transfer are larger release concerns. It is a
   distribution follow-up after the CLI flow is stable.
3. **Hosted API-key mode.** This removes the local process but requires hosted
   custody or a stable user credential, weakening the product's deposit-to-call
   unlinkability. It is not part of the privacy-preserving launch.

A Codex plugin or MCP server is not used: those facilities add tools but do not
own the model request transport. The supported Codex custom model-provider
configuration is the integration boundary.

## User experience

### One-time setup

`zk-credits setup codex`:

1. Reuses the imported OS-keychain identity or prompts for the 24-word recovery
   phrase on a non-echoing terminal when no identity exists.
2. Writes an isolated `zk-credits.config.toml` beside the user's Codex config.
   It does not rewrite or replace the user's normal `config.toml`.
3. Configures the ZK Credits loopback URL, Responses wire API, a tested default
   OpenRouter model, and Codex command-backed bearer authentication.
4. Starts the sidecar in the background and waits until its loopback health
   endpoint is ready.
5. Prints the single normal launch command: `zk-credits codex`.

The setup command may accept a model override, but model discovery, package
publishing, graphical funding, and automatic credit purchase are separate
distribution/onboarding work.

### Daily use

`zk-credits codex [codex arguments...]` ensures the sidecar is healthy and then
executes `codex --profile zk-credits` with the original arguments. Codex obtains
its bearer by running `zk-credits token`; the user does not run `eval`, copy a
token, or keep a second terminal open.

`zk-credits status` reports only local, non-secret state: identity configured,
Codex profile installed, and sidecar running/stopped. It never prints the local
bearer, mnemonic, `secret_k`, commitment, or ticket contents.

Existing `import-mnemonic`, `serve`, and `env` commands remain available for
development and backwards compatibility.

## Components

### Codex profile writer

The writer resolves Codex home from `CODEX_HOME` when present, otherwise
`~/.codex`, and atomically writes `zk-credits.config.toml` with owner-only file
permissions. The provider uses:

```toml
model = "openai/gpt-4o-mini"
model_provider = "zk_credits"

[model_providers.zk_credits]
name = "ZK Credits"
base_url = "http://127.0.0.1:3210/v1"
wire_api = "responses"

[model_providers.zk_credits.auth]
command = "zk-credits"
args = ["token"]
refresh_interval_ms = 0
```

Command-backed authentication avoids persisting the loopback bearer in Codex
configuration or shell startup files. Only the ZK Credits-owned profile file is
updated; setup never overwrites unrelated user settings.

### Background lifecycle

The package adds a small lifecycle module that:

- checks `GET /health` on the configured loopback origin;
- starts the current `zk-credits serve` executable as a detached child when the
  health check fails;
- directs detached output to a permission-restricted sidecar log;
- waits with a bounded timeout for health and token availability; and
- treats a non-ZK process occupying the port as an actionable startup failure.

The server writes its random token only after it successfully binds the port,
preventing a losing concurrent startup from replacing the active token. The
existing signal handlers continue to provide graceful foreground shutdown.

### Command-backed token

`zk-credits token` ensures the background server is healthy and prints exactly
one line containing the active local bearer. This command is intended for
Codex's provider authentication subprocess. It prints no status or startup log
to stdout and never forwards the token to Render.

### Codex launcher

The launcher verifies that setup has created the profile, ensures the sidecar
is ready, and starts the `codex` executable with the ZK Credits profile. It
inherits terminal input/output and returns Codex's exit code. A missing Codex
binary or profile produces a short remediation message.

## Security and privacy

- The Render API key is an operator deployment credential and is never read by
  the companion CLI.
- The local bearer remains random, mode `0600`, loopback-only, and absent from
  Codex TOML. Codex retrieves it through the command-backed auth process.
- The mnemonic remains non-echoing and is reduced to `secret_k` before OS
  keychain persistence.
- Setup never edits shell startup files, replaces the Codex executable, or
  silently makes ZK Credits the provider for unrelated Codex profiles.
- Detached logs must not contain the mnemonic, `secret_k`, local bearer, proof,
  prompt body, or full upstream response.
- Local lifecycle automation does not change the gateway's proof, replay,
  settlement, or membership-tree rules.

## Error handling

- No identity: interactive setup prompts securely; non-interactive setup fails
  with the existing import guidance.
- No funded membership or exhausted tickets: Codex receives the existing
  proof/gateway error; setup does not claim that configuration creates credits.
- Port conflict or startup timeout: report the loopback URL and log path without
  printing secrets.
- Missing Codex executable: leave the sidecar/profile intact and explain how to
  install Codex.
- Existing ZK Credits profile: rewrite it atomically to the current managed
  format. Unrelated Codex files remain untouched.

## Validation

- TDD unit tests cover profile rendering/path resolution, atomic restrictive
  writes, exact token-only output, status redaction, launch arguments, and
  setup behavior with existing or newly imported identity.
- Lifecycle tests cover healthy reuse, detached startup, bounded readiness,
  concurrent port ownership, and useful failure output.
- Sidecar integration tests cover the loopback health endpoint and verify that
  authentication remains required for paid OpenAI routes.
- A package dry run must include the new companion modules and the existing
  pinned circuit artifacts.
- A local end-to-end dry run uses a fake Codex executable to prove that one
  setup creates the profile, starts/reuses the server, obtains the bearer via
  command-backed auth, and preserves Codex arguments without exposing secrets.
- A funded live Codex request remains the final acceptance test when a test
  identity with available tickets is supplied; tests must not persist or print
  its recovery phrase.

## Deferred distribution work

- Publish signed npm/Homebrew/GitHub release artifacts.
- Add a signed desktop/tray shell and OS-login startup after the CLI lifecycle
  is stable.
- Connect web funding onboarding to the companion without copying a mnemonic.
- Add provider/model discovery and balance display when the gateway exposes a
  privacy-safe source for those values.
