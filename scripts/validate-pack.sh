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
  "PIPELINE.md"
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
  "template/react-mui-app/package.json"
  "template/react-mui-app/pnpm-lock.yaml"
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

ASSET_DIR="$PACK_ROOT/dist/ui/assets"
if [[ ! -d "$ASSET_DIR" ]]; then
  echo "FAIL: dist/ui/assets directory missing from pack"
  exit 1
fi

JS_ASSET_COUNT=$(find "$ASSET_DIR" -type f -name "*.js" | wc -l | tr -d ' ')
CSS_ASSET_COUNT=$(find "$ASSET_DIR" -type f -name "*.css" | wc -l | tr -d ' ')

if [[ "$JS_ASSET_COUNT" -lt 1 ]]; then
  echo "FAIL: dist/ui/assets does not contain any JavaScript bundles"
  exit 1
fi

if [[ "$CSS_ASSET_COUNT" -lt 1 ]]; then
  echo "FAIL: dist/ui/assets does not contain any CSS bundles"
  exit 1
fi

echo "  ✓ UI bundle assets present (js=$JS_ASSET_COUNT, css=$CSS_ASSET_COUNT)"

# --- Forbidden paths/patterns ----------------------------------------------
FORBIDDEN_ROOT_PATHS=(
  "src"
  "ui-src"
  "node_modules"
  "scripts"
  "tsconfig.json"
  ".npmignore"
  ".env"
)

FORBIDDEN_FILE_GLOBS=(
  "*.test.ts"
  "*.test.js"
  ".env.*"
)

VIOLATIONS=()

for rel_path in "${FORBIDDEN_ROOT_PATHS[@]}"; do
  if [[ -e "$PACK_ROOT/$rel_path" ]]; then
    VIOLATIONS+=("$PACK_ROOT/$rel_path")
  fi
done

for glob in "${FORBIDDEN_FILE_GLOBS[@]}"; do
  while IFS= read -r match; do
    [[ -n "$match" ]] && VIOLATIONS+=("$match")
  done < <(find "$PACK_ROOT" -type f -name "$glob" 2>/dev/null | head -20)
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
