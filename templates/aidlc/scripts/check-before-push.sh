#!/usr/bin/env bash
set -euo pipefail
# Block plaintext secrets before they leave the machine.
if git diff --cached -U0 | grep -nE 'ntn_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{36}'; then
  echo "❌ Potential secret in staged changes — aborting." >&2; exit 1
fi
echo "✅ pre-push checks passed"
