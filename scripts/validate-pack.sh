#!/usr/bin/env bash
# =============================================================================
# validate-pack.sh — Pre-publish artefact validation for workspace-dev
#
# Runs `pnpm pack`, unpacks the tarball, and enforces:
#   ✓ Required files are present (dist/, README.md, LICENSE, package.json)
#   ✗ Forbidden patterns are absent (src/, .env*, *.test.*, node_modules/, .mirror-allowlist)
#
# Exit code 0 = pack is clean.  Non-zero = violation found.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Pack validation: workspace-dev ==="

cd "$PKG_DIR"

# --- Pack ----------------------------------------------------------------
TARBALL=$(pnpm pack --pack-destination /tmp 2>/dev/null | tail -1)
if [[ -z "$TARBALL" || ! -f "$TARBALL" ]]; then
  echo "ERROR: pnpm pack produced no tarball."
  exit 1
fi

UNPACK_DIR=$(mktemp -d)
trap 'rm -rf "$UNPACK_DIR" "$TARBALL"' EXIT

tar xzf "$TARBALL" -C "$UNPACK_DIR"

# pnpm/npm packs into a 'package/' subdirectory
PACK_ROOT="$UNPACK_DIR/package"
if [[ ! -d "$PACK_ROOT" ]]; then
  echo "ERROR: tarball does not contain expected 'package/' root."
  exit 1
fi

# --- Required files -------------------------------------------------------
REQUIRED_FILES=(
  "package.json"
  "README.md"
  "LICENSE"
  "SECURITY.md"
  "COMPLIANCE.md"
  "ARCHITECTURE.md"
  "COMPATIBILITY.md"
  "dist/cli.js"
  "dist/index.js"
  "dist/index.cjs"
  "dist/index.d.ts"
  "dist/index.d.cts"
  "dist/contracts/index.js"
  "dist/contracts/index.cjs"
  "dist/contracts/index.d.ts"
  "dist/contracts/index.d.cts"
  "dist/ui/index.html"
  "dist/ui/app.css"
  "dist/ui/app.js"
)

MISSING=()
for req in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$PACK_ROOT/$req" ]]; then
    MISSING+=("$req")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "FAIL: ${#MISSING[@]} required file(s) missing from pack:"
  for m in "${MISSING[@]}"; do
    echo "  ✗ $m"
  done
  exit 1
fi
echo "  ✓ All required files present (${#REQUIRED_FILES[@]} checked)"

# --- Forbidden patterns ----------------------------------------------------
FORBIDDEN_PATTERNS=(
  "src/"
  "ui-src/"
  ".env"
  ".env.*"
  "*.test.ts"
  "*.test.js"
  "node_modules/"
  ".mirror-allowlist"
  "scripts/"
  "tsconfig.json"
  ".npmignore"
)

VIOLATIONS=()
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  # Use find with appropriate matching
  while IFS= read -r match; do
    [[ -n "$match" ]] && VIOLATIONS+=("$match")
  done < <(find "$PACK_ROOT" -path "*/$pattern" -o -name "$pattern" 2>/dev/null | head -20)
done

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo "FAIL: ${#VIOLATIONS[@]} forbidden pattern(s) found in pack:"
  for v in "${VIOLATIONS[@]}"; do
    rel="${v#$PACK_ROOT/}"
    echo "  ✗ $rel"
  done
  exit 1
fi
echo "  ✓ No forbidden patterns found"

# --- Summary ---------------------------------------------------------------
FILE_COUNT=$(find "$PACK_ROOT" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$PACK_ROOT" | cut -f1)
echo ""
echo "=== Pack validation passed ==="
echo "  Files: $FILE_COUNT"
echo "  Size:  $TOTAL_SIZE"
echo "  Tarball: $(basename "$TARBALL")"
