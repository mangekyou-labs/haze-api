#!/usr/bin/env bash
#
# Shared secret-boundary guardrails for the two pilot wizards.
#
#   scripts/launch-wizard.sh     founder infrastructure (this repository)
#   scripts/operator-wizard.sh   operator activation (the operator's machine)
#
# Both wizards capture secrets, so the boundary between the two planes is
# enforced in one place instead of being re-derived per script:
#
#   - launch scripts reject operator variables, and operator scripts reject
#     deployer, sponsor, database, admin-token, and provider variables;
#   - neither writes into a tracked or unignored file, or one that is not 0600;
#   - every captured value is checked for a template placeholder and for its
#     expected shape; and
#   - a redacted artifact is scanned for anything that still looks secret.
#
# This file has no side effects: it only defines functions. Source it, then
# call it. It reports through `warn`/`note` when the calling wizard defines
# them, and through stderr otherwise, so it stays testable on its own.
#
# SPDX-License-Identifier: AGPL-3.0-or-later

# _gw_report "message" prints through the wizard's `warn` when available.
_gw_report() {
  if declare -F warn >/dev/null 2>&1; then
    warn "$1"
  else
    printf '\n  ! %s\n' "$1" >&2
  fi
}

# ── Variable planes ───────────────────────────────────────────────────────

# Operator-owned material. It belongs in `.env.operator.local` on the
# operator's machine and must never reach the founder launch env.
GW_OPERATOR_VARS=(
  ZK_CREDITS_CREDENTIAL_PATH
  ZK_CREDITS_CREDENTIAL_PASSWORD
  ZK_CREDITS_ARTIFACT_DIR
  ZK_CREDITS_WITNESS_PATH
  ZK_CREDITS_HOME
  ZK_CREDITS_GATEWAY_URL
  ZK_CREDITS_SIDECAR_PORT
  ZK_CREDITS_OPERATOR_SLOT
  ZK_CREDITS_OPERATOR_SECRET
)

# Founder-owned infrastructure material, including deployer and sponsor keys,
# the database, the admin tokens, and the upstream provider credential. None
# of it may appear on an operator machine.
GW_DEPLOYER_VARS=(
  BASE_DEPLOYER_PASSWORD_FILE
  BASE_SPONSOR_PRIVATE_KEY
  BASE_SPONSOR_ADDRESS
  BASE_POSEIDON_T2_ADDRESS
  BASE_POSEIDON_T3_ADDRESS
  BASE_POSEIDON_T4_ADDRESS
  BASE_TREASURY_ADDRESS
  BASE_REFUND_VAULT
  BASE_SPEND_VERIFIER_ADDRESS
  BASE_BOND_ADDRESS
  BASE_BOND_DEPLOYMENT_BLOCK
  BASE_PRIVATE_CREDIT_BOND_ADDRESS
  BASE_DEPLOYMENT_BLOCK
  BASE_CONFIRMATIONS
  DATABASE_URL
  BILLING_INTERNAL_TOKEN
  FACILITATOR_SERVICE_TOKEN
  CLAIM_STORE_OPERATOR_TOKEN
  OPENROUTER_API_KEY
  NEXTAUTH_SECRET
  GITHUB_CLIENT_SECRET
  NEXTAUTH_URL
  PUBLIC_GATEWAY_URL
  SENTRY_DSN
)

# gw_refuse_env_vars NAME... fails when any NAME is already set in the shell.
gw_refuse_env_vars() {
  local name
  for name in "$@"; do
    if [[ -n "${!name:-}" ]]; then
      _gw_report "$name is set in this shell; it belongs to the other plane"
      return 1
    fi
  done
  return 0
}

# gw_refuse_operator_vars is used by the founder launch wizard.
gw_refuse_operator_vars() { gw_refuse_env_vars "${GW_OPERATOR_VARS[@]}"; }

# gw_refuse_deployer_vars is used by the operator wizard.
gw_refuse_deployer_vars() { gw_refuse_env_vars "${GW_DEPLOYER_VARS[@]}"; }

# gw_refuse_stray_keys FILE ALLOWED_KEY... refuses a key the wizard does not own,
# so an operator or personal value cannot ride along in a captured env file.
gw_refuse_stray_keys() {
  local file="$1"; shift
  [[ -f "$file" ]] || return 0
  local allowed key
  allowed=$(printf '%s\n' "$@")
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    if ! grep -qxF "$key" <<<"$allowed"; then
      _gw_report "$file contains the unowned key $key; remove it before continuing"
      return 1
    fi
  done < <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*' "$file" 2>/dev/null || true)
  return 0
}

# ── Value shape ───────────────────────────────────────────────────────────

# Template and example literals that must never be captured as a real value.
#
# Matching is literal and case-insensitive rather than a single alternation
# regex: bash 3.2 word-splits an unquoted variable on the right of `=~`, which
# silently truncates a pattern that contains a space (as `[-_ ]` does).
GW_PLACEHOLDER_LITERALS=(
  '0x...' '...' '-' 'todo' 'tbd' 'change-me' 'change_me'
  'replace-with-a-random-server-token' 'replace-with-a-server-token'
  'use-a-local-password' 'use-a-local-secret'
)

# Example prefixes: a value that still reads like the .env.example template.
GW_PLACEHOLDER_PREFIXES=(
  'replace-with' 'replace_with' 'change-me' 'change_me'
  'your-' 'your_' 'use-a-local' 'paste-'
)

# gw_reject_placeholders VALUE LABEL refuses an empty, template, or example value.
gw_reject_placeholders() {
  local value="$1" label="$2" lower literal prefix
  if [[ -z "$value" ]]; then
    _gw_report "$label is empty; a real value is required"
    return 1
  fi
  lower=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')
  for literal in "${GW_PLACEHOLDER_LITERALS[@]}"; do
    if [[ "$lower" == "$literal" ]]; then
      _gw_report "$label is still a placeholder ('$value')"
      return 1
    fi
  done
  for prefix in "${GW_PLACEHOLDER_PREFIXES[@]}"; do
    if [[ "$lower" == "$prefix"* ]]; then
      _gw_report "$label still reads like the example template ('$value')"
      return 1
    fi
  done
  if [[ "$value" == *'...'* || "$value" == *'0x0000000000000000000000000000000000000000'* ]]; then
    _gw_report "$label still contains a template placeholder"
    return 1
  fi
  if [[ "$value" == '<'*'>' ]]; then
    _gw_report "$label is an unfilled <placeholder>"
    return 1
  fi
  if [[ "$lower" =~ ^x+$ ]]; then
    _gw_report "$label is a row of x's"
    return 1
  fi
  return 0
}

# gw_require_match VALUE PATTERN LABEL enforces a shape on a real value.
gw_require_match() {
  local value="$1" pattern="$2" label="$3"
  gw_reject_placeholders "$value" "$label" || return 1
  if [[ ! "$value" =~ $pattern ]]; then
    _gw_report "$label does not have the expected shape"
    return 1
  fi
  return 0
}

gw_require_address()     { gw_require_match "$1" '^0x[0-9a-fA-F]{40}$' "$2"; }
gw_require_private_key() { gw_require_match "$1" '^0x[0-9a-fA-F]{64}$' "$2"; }
gw_require_password_file() {
  local value="$1" label="$2" mode
  gw_reject_placeholders "$value" "$label" || return 1
  if [[ "$value" != /* ]]; then
    _gw_report "$label must be an absolute path"
    return 1
  fi
  if [[ -L "$value" || ! -f "$value" ]]; then
    _gw_report "$label must be a regular, non-symlinked file"
    return 1
  fi
  mode=$(stat -f '%Lp' "$value" 2>/dev/null || stat -c '%a' "$value" 2>/dev/null || echo '')
  if [[ "$mode" != "600" ]]; then
    _gw_report "$label has mode ${mode:-unknown}; it requires 600"
    return 1
  fi
  return 0
}
gw_require_block()       { gw_require_match "$1" '^[0-9]+$' "$2"; }
gw_require_secret()      { gw_require_match "$1" '^.{32,}$' "$2"; }
gw_require_https_url()   { gw_require_match "$1" '^https://[^[:space:]]+$' "$2"; }
gw_require_sha256()      { gw_require_match "$1" '^[0-9a-f]{64}$' "$2"; }
gw_require_semver()      { gw_require_match "$1" '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' "$2"; }

# gw_require_direct_postgres VALUE LABEL requires a Neon-style direct TLS URL and
# refuses the pooled host, which cannot hold the claim store's own transactions.
gw_require_direct_postgres() {
  local value="$1" label="$2"
  gw_require_match "$value" '^postgres(ql)?://[^[:space:]]+$' "$label" || return 1
  if [[ "$value" == *'-pooler'* ]]; then
    _gw_report "$label is the pooled host; use the direct connection string"
    return 1
  fi
  if [[ "$value" != *'sslmode='* ]]; then
    _gw_report "$label must carry sslmode=require"
    return 1
  fi
  return 0
}

# ── File boundaries ───────────────────────────────────────────────────────

# gw_require_ignored PATH refuses a tracked file, and one git does not ignore.
gw_require_ignored() {
  local path="$1"
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    _gw_report "$path is tracked by git; refusing to write secrets into it"
    return 1
  fi
  if ! git check-ignore -q "$path"; then
    _gw_report "$path is not git-ignored; add it to .gitignore first"
    return 1
  fi
  return 0
}

# gw_require_private_mode PATH forces mode 600 and refuses anything looser.
gw_require_private_mode() {
  local path="$1" mode
  touch "$path"
  chmod 600 "$path"
  mode=$(stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null || echo '')
  if [[ -n "$mode" && "$mode" != "600" ]]; then
    _gw_report "$path has mode $mode; a secret file requires 600"
    return 1
  fi
  return 0
}

# gw_scan_for_secrets FILE... refuses an artifact that still carries a secret.
# It looks for the shapes a leaked value takes: a private key, a raw token, a
# connection string with credentials, an email, or a GitHub login field.
gw_scan_for_secrets() {
  local file
  for file in "$@"; do
    [[ -f "$file" ]] || continue
    if grep -nE '0x[0-9a-fA-F]{64}|postgres(ql)?://[^[:space:]]*:[^[:space:]]*@|sk-or-v1-[A-Za-z0-9]|gh[opsu]_[A-Za-z0-9]{20,}|-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----' "$file" >/dev/null 2>&1; then
      _gw_report "$file still contains something that looks like a secret"
      return 1
    fi
    if grep -nE '"[A-Za-z_]*([Pp]assword|[Ss]ecret|[Pp]rivate[Kk]ey|[Tt]oken|[Cc]redential)[A-Za-z_]*"[[:space:]]*:' "$file" >/dev/null 2>&1; then
      # A key that names a secret implies a value that carries one. The single
      # exception is the evidence schema's own `credentialStayedLocal`
      # attestation, which asserts where the credential stayed and carries no
      # credential, so re-check the reported keys against the fixed key set.
      local offending
      offending=$(grep -oE '"[A-Za-z_]*([Pp]assword|[Ss]ecret|[Pp]rivate[Kk]ey|[Tt]oken|[Cc]redential)[A-Za-z_]*"[[:space:]]*:' "$file" \
        | tr -d '":[:space:]' \
        | grep -vxE 'credentialStayedLocal' \
        | head -n1 || true)
      if [[ -n "$offending" ]]; then
        _gw_report "$file names a secret-bearing field ($offending)"
        return 1
      fi
    fi
    if grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$file" >/dev/null 2>&1; then
      _gw_report "$file contains an email address"
      return 1
    fi
  done
  return 0
}
