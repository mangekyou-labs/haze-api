#!/usr/bin/env bash
#
# Behavioural tests for the shared wizard guardrails.
#
# The guardrails are the only thing standing between a founder env and an
# operator secret, so each boundary gets a positive and a negative case rather
# than only a syntax check:
#
#   - placeholder and example values are refused;
#   - a value of the wrong shape is refused;
#   - a tracked, unignored, or world-readable secret file is refused;
#   - each script plane refuses the other plane's variables;
#   - an artifact that still carries a secret is refused; and
#   - the checks are idempotent, so a re-run converges.
#
# Usage: bash scripts/guardrails.test.sh    (exit 0 = all passed)
#
# SPDX-License-Identifier: AGPL-3.0-or-later

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/launch-guardrails.sh
source "$SCRIPT_DIR/launch-guardrails.sh"

PASSED=0
FAILED=0

# Silence the guardrails' own reporting; the tests assert on exit status.
warn() { :; }
note() { :; }

pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; }

# expect_ok "name" command... asserts success.
expect_ok() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name (expected success)"; fi
}

# expect_fail "name" command... asserts failure.
expect_fail() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$name (expected failure)"; else pass "$name"; fi
}

SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT

echo "value shape"

for placeholder in '' '0x...' '...' 'REPLACE-WITH-A-RANDOM-SERVER-TOKEN' 'replace-with-a-random-server-token' \
                   'change-me' 'your-token-here' 'use-a-local-password' '<your-rpc-url>' '0x0000000000000000000000000000000000000000'; do
  expect_fail "refuses placeholder '$placeholder'" gw_reject_placeholders "$placeholder" "VALUE"
done

expect_ok "accepts a real value" gw_reject_placeholders 'a-real-value-2f9c' VALUE

expect_ok   "accepts a 20-byte address"   gw_require_address '0x036CbD53842c5426634e7929541eC2318f3dCF7e' ADDR
expect_fail "refuses a 19-byte address"   gw_require_address '0x36CbD53842c5426634e7929541eC2318f3dCF7e' ADDR
expect_fail "refuses an all-zero address" gw_require_address '0x0000000000000000000000000000000000000000' ADDR
expect_fail "refuses a non-hex address"   gw_require_address '0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' ADDR

expect_fail "refuses a 31-byte key"  gw_require_private_key "0x$(printf 'a%.0s' {1..62})" KEY
expect_ok   "accepts a 32-byte key"  gw_require_private_key "0x$(printf 'a%.0s' {1..64})" KEY

expect_ok   "accepts a decimal block" gw_require_block '47096600' BLOCK
expect_fail "refuses a hex block"     gw_require_block '0x2ce8d4' BLOCK
expect_fail "refuses an empty block"  gw_require_block '' BLOCK

expect_fail "refuses a short token"   gw_require_secret 'too-short' TOKEN
expect_ok   "accepts a 43-char token" gw_require_secret "$(printf 'k%.0s' {1..43})" TOKEN

expect_ok   "accepts an https url"    gw_require_https_url 'https://zk-credits-gateway.onrender.com' URL
expect_fail "refuses an http url"     gw_require_https_url 'http://localhost:3001' URL

expect_ok   "accepts sha256"          gw_require_sha256 "$(printf 'a%.0s' {1..64})" DIGEST
expect_fail "refuses a short digest"  gw_require_sha256 'abc123' DIGEST

expect_ok   "accepts a pinned semver" gw_require_semver '0.2.0' VERSION
expect_fail "refuses a range"         gw_require_semver '^0.2.0' VERSION

expect_ok   "accepts a direct Neon url" gw_require_direct_postgres 'postgresql://u:p@ep-cool.ap-southeast-1.aws.neon.tech/zk_credits?sslmode=require' DSN
expect_fail "refuses the pooled host"   gw_require_direct_postgres 'postgresql://u:p@ep-cool-pooler.ap-southeast-1.aws.neon.tech/zk_credits?sslmode=require' DSN
expect_fail "refuses a missing sslmode" gw_require_direct_postgres 'postgresql://u:p@ep-cool.ap-southeast-1.aws.neon.tech/zk_credits' DSN
expect_fail "refuses a non-postgres url" gw_require_direct_postgres 'mysql://u:p@host/db?sslmode=require' DSN

echo "variable planes"

if grep -Eq '^[[:space:]]+PILOT_RELEASE_REVIEWED([[:space:]]|$)' "$SCRIPT_DIR/launch-wizard.sh"; then
  pass "launch wizard owns the release review gate"
else
  fail "launch wizard owns the release review gate"
fi

# Run these in a scrubbed environment so an ambient variable in the developer's
# shell cannot decide the outcome.
CLEAN_ENV=(env -i PATH="$PATH" HOME="$HOME" bash -c)

expect_fail "launch rejects an operator credential path" \
  env -i PATH="$PATH" HOME="$HOME" ZK_CREDITS_CREDENTIAL_PATH=/tmp/c.zkcred \
  bash -c 'source "$1"; gw_refuse_operator_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"
expect_fail "launch rejects an operator artifact dir" \
  env -i PATH="$PATH" HOME="$HOME" ZK_CREDITS_ARTIFACT_DIR=/tmp/bundle \
  bash -c 'source "$1"; gw_refuse_operator_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"
expect_ok "launch accepts a clean shell" \
  "${CLEAN_ENV[@]}" 'source "$1"; gw_refuse_operator_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"

expect_fail "operator rejects a sponsor key" \
  env -i PATH="$PATH" HOME="$HOME" BASE_SPONSOR_PRIVATE_KEY=0xdead \
  bash -c 'source "$1"; gw_refuse_deployer_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"
expect_fail "operator rejects a database url" \
  env -i PATH="$PATH" HOME="$HOME" DATABASE_URL=postgres://x \
  bash -c 'source "$1"; gw_refuse_deployer_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"
expect_fail "operator rejects an admin token" \
  env -i PATH="$PATH" HOME="$HOME" BILLING_INTERNAL_TOKEN=x \
  bash -c 'source "$1"; gw_refuse_deployer_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"
expect_fail "operator rejects a provider key" \
  env -i PATH="$PATH" HOME="$HOME" OPENROUTER_API_KEY=x \
  bash -c 'source "$1"; gw_refuse_deployer_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"
expect_ok "operator accepts a clean shell" \
  "${CLEAN_ENV[@]}" 'source "$1"; gw_refuse_deployer_vars' _ "$SCRIPT_DIR/launch-guardrails.sh"

echo "file boundaries"

ALLOWED=(BASE_RPC_URL DATABASE_URL)

printf 'BASE_RPC_URL=https://rpc.test\nDATABASE_URL=postgres://x\n' > "$SANDBOX/clean.env"
expect_ok "accepts only owned keys" gw_refuse_stray_keys "$SANDBOX/clean.env" "${ALLOWED[@]}"

printf 'BASE_RPC_URL=https://rpc.test\nZK_CREDITS_CREDENTIAL_PASSWORD=hunter2\n' > "$SANDBOX/leaky.env"
expect_fail "refuses a stray operator key" gw_refuse_stray_keys "$SANDBOX/leaky.env" "${ALLOWED[@]}"

printf 'BASE_RPC_URL=https://rpc.test\nMY_PERSONAL_NOTE=hello\n' > "$SANDBOX/personal.env"
expect_fail "refuses a stray personal key" gw_refuse_stray_keys "$SANDBOX/personal.env" "${ALLOWED[@]}"

expect_ok "accepts a missing file" gw_refuse_stray_keys "$SANDBOX/absent.env" "${ALLOWED[@]}"

REPO="$SANDBOX/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
printf '.env\n.env.*.local\n' > "$REPO/.gitignore"
printf 'x\n' > "$REPO/tracked.env"
git -C "$REPO" add .gitignore tracked.env
git -C "$REPO" -c user.email=t@t -c user.name=t commit -qm init

expect_fail "refuses a tracked env file"  bash -c 'cd "$1" && source "$2" && gw_require_ignored tracked.env' _ "$REPO" "$SCRIPT_DIR/launch-guardrails.sh"
expect_fail "refuses an unignored file"   bash -c 'cd "$1" && source "$2" && gw_require_ignored notes.txt' _ "$REPO" "$SCRIPT_DIR/launch-guardrails.sh"
expect_ok   "accepts an ignored env file" bash -c 'cd "$1" && source "$2" && gw_require_ignored .env.launch.local' _ "$REPO" "$SCRIPT_DIR/launch-guardrails.sh"

# `gw_require_private_mode` forces 600, so a permissive file converges.
printf 'SECRET=abc\n' > "$SANDBOX/mode.env"
chmod 644 "$SANDBOX/mode.env"
expect_ok "forces mode 600 on a permissive file" gw_require_private_mode "$SANDBOX/mode.env"
mode=$(stat -f '%Lp' "$SANDBOX/mode.env" 2>/dev/null || stat -c '%a' "$SANDBOX/mode.env")
if [[ "$mode" == "600" ]]; then pass "the file is 600 afterwards"; else fail "mode is $mode, expected 600"; fi
expect_ok "is idempotent on a re-run" gw_require_private_mode "$SANDBOX/mode.env"

echo "secret scanning"

printf '{"exchange":{"exchangeSuccesses":1}}\n' > "$SANDBOX/clean.json"
expect_ok "accepts a redacted bundle" gw_scan_for_secrets "$SANDBOX/clean.json"

printf '{"key":"0x%s"}\n' "$(printf 'a%.0s' {1..64})" > "$SANDBOX/key.json"
expect_fail "refuses a private key" gw_scan_for_secrets "$SANDBOX/key.json"

printf '{"dsn":"postgresql://u:hunter2@host/db"}\n' > "$SANDBOX/dsn.json"
expect_fail "refuses a credentialed connection string" gw_scan_for_secrets "$SANDBOX/dsn.json"

printf '{"provider":"sk-or-v1-abcdefghijklmnop"}\n' > "$SANDBOX/provider.json"
expect_fail "refuses a provider key" gw_scan_for_secrets "$SANDBOX/provider.json"

printf '{"token":"gho_abcdefghijklmnopqrstuvwx"}\n' > "$SANDBOX/gh.json"
expect_fail "refuses a GitHub token" gw_scan_for_secrets "$SANDBOX/gh.json"

printf '{"operator":"someone@example.com"}\n' > "$SANDBOX/email.json"
expect_fail "refuses an email address" gw_scan_for_secrets "$SANDBOX/email.json"

printf '{"credentialSecret":"abc"}\n' > "$SANDBOX/field.json"
expect_fail "refuses a secret-bearing field name" gw_scan_for_secrets "$SANDBOX/field.json"

# The real bundle shape the operator wizard writes must survive the scan. It is
# written out in full, including the attestations, because the field-name rule
# below matches `credentialStayedLocal` unless that key is exempted.
printf '{"kind":"zk-credits.operator-activation-evidence","schemaVersion":2,"slot":"A","participantType":"coding_agent","integrationMode":"openai_compatible_sidecar","versions":{"sidecar":"0.2.0","adapter":"0.1.0","shared":"0.1.0","artifactRelease":"private-credit-spend-bn254-dev-sepolia-v1"},"activatedAt":"2026-09-21T04:00:00.000Z","onboardingDurationMs":1800000,"counters":{"beforeWarmup":{"exchange":{"challengesReceived":0,"failures":0,"failuresByCategory":{"transport_failed":0}},"proving":{"attempts":0,"hotProveSamples":0,"p50HotProveMs":null}},"afterWarmup":{"exchange":{"challengesReceived":1,"failures":0},"proving":{"attempts":1,"hotProveSamples":0}},"afterHotExchange":{"exchange":{"challengesReceived":2,"failures":0},"proving":{"attempts":2,"hotProveSamples":1,"p95HotProveMs":1900}}},"assistanceCount":0,"attestations":{"ranAgentLocally":true,"credentialStayedLocal":true,"noManualRecovery":true,"distinctOperatorOwnership":true}}\n' > "$SANDBOX/real.json"
expect_ok "accepts the wizard's own bundle shape" gw_scan_for_secrets "$SANDBOX/real.json"

# The exemption is exactly one key: any other credential-named field is refused.
printf '{"attestations":{"credentialSecret":"abc"}}\n' > "$SANDBOX/credential-key.json"
expect_fail "still refuses a differently named credential field" gw_scan_for_secrets "$SANDBOX/credential-key.json"

printf '{"attestations":{"credential":"abc"}}\n' > "$SANDBOX/bare-credential-key.json"
expect_fail "still refuses a bare credential field" gw_scan_for_secrets "$SANDBOX/bare-credential-key.json"

echo
printf '%s passed, %s failed\n' "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
