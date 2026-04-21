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
if ! TARBALL=$(
  pnpm pack --json --pack-destination /tmp 2>/dev/null \
    | node -e '
const { readFileSync } = require("node:fs");
const input = readFileSync(0, "utf8").trim();

if (!input) {
  process.exit(1);
}

const selectFilename = (value) => {
  if (!value || typeof value !== "object") {
    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const fromArray = selectFilename(item);
      if (fromArray) {
        return fromArray;
      }
    }
    return "";
  }

  return typeof value.filename === "string" ? value.filename : "";
};

let tarballPath = "";

try {
  tarballPath = selectFilename(JSON.parse(input));
} catch {
  // Fallback for NDJSON or mixed output where only some lines are JSON.
  const lines = input.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      tarballPath = selectFilename(JSON.parse(line));
    } catch {
      continue;
    }
    if (tarballPath) {
      break;
    }
  }
}

if (!tarballPath) {
  process.exit(1);
}

process.stdout.write(tarballPath);
'
); then
  TARBALL=""
fi
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
  "GOVERNANCE.md"
  "SECURITY.md"
  "THREAT_MODEL.md"
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

# --- Runtime smokes ------------------------------------------------------
echo "  ✓ Running packed CLI help smoke"
if ! node "$PACK_ROOT/dist/cli.js" --help >/dev/null; then
  echo "FAIL: packed CLI help smoke failed"
  exit 1
fi

echo "  ✓ Running packed ESM import smoke"
if ! node --input-type=module -e '
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.argv[1]).href);
if (typeof mod.createWorkspaceServer !== "function") {
  throw new Error("ESM import failed");
}
' "$PACK_ROOT/dist/index.js"; then
  echo "FAIL: packed ESM import smoke failed"
  exit 1
fi

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
