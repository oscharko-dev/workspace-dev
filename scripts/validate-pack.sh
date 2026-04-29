#!/usr/bin/env bash
# =============================================================================
# validate-pack.sh — Pre-publish artefact validation for workspace-dev
#
# Runs `pnpm pack`, unpacks the tarball, and enforces:
#   ✓ Required files are present (dist/, README.md, LICENSE, package.json)
#   ✗ Forbidden patterns are absent (src/, .env*, *.test.*, node_modules/)
#
# Exit code 0 = pack is clean.  Non-zero = violation found.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PKG_DIR"
exec node scripts/build-profile.mjs --verify "$@"
