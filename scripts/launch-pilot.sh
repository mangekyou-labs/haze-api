#!/usr/bin/env bash
#
# The single entrypoint for the B22 pilot launch.
#
#   scripts/launch-pilot.sh --check      read-only preflight
#   scripts/launch-pilot.sh --status     read-only local and remote reconciliation
#   scripts/launch-pilot.sh              start or resume from the last checkpoint
#
# The shell layer does three things and nothing else: it refuses an environment
# from the wrong plane, it hands the protected founder env file to the Node
# state machine, and it keeps the exit code. Everything about ordering,
# checkpoints, and reconciliation lives in `ts/launch/cli.ts`, where it is
# covered by tests.
#
# There is deliberately no unattended confirmation flag, and no flag anywhere
# that deletes a provider resource.
#
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
LAUNCH_ENV="${ZK_CREDITS_LAUNCH_ENV:-$REPO_ROOT/.env.launch.local}"

# shellcheck source=scripts/launch-guardrails.sh
source "$SCRIPT_DIR/launch-guardrails.sh"

cd "$REPO_ROOT"

# The founder launch never runs on an operator machine, so an operator variable
# in this shell means the planes have been mixed up.
if ! gw_refuse_operator_vars; then
  printf '\n  ! unset those operator variables and re-run\n' >&2
  exit 1
fi

# Secrets are read from the file by the state machine; they are never exported
# into this shell, so nothing can leak one through the environment or a
# child process listing.
export ZK_CREDITS_LAUNCH_ENV="$LAUNCH_ENV"

if [[ -f "$LAUNCH_ENV" ]] && ! gw_require_private_mode "$LAUNCH_ENV" >/dev/null 2>&1; then
  printf '\n  ! %s must be mode 600\n' "$LAUNCH_ENV" >&2
  exit 1
fi

cd "$REPO_ROOT/ts"
exec npx tsx launch-pilot.ts "$@"
