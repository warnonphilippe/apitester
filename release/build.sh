#!/usr/bin/env bash
# Construit l'app de bureau macOS (Apple Silicon) :
#   release/apitester-<version>-mac-arm64.dmg
# Usage : ./release/build.sh   (depuis n'importe quel dossier)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "✗ Le .dmg ne se construit que sur macOS." >&2
  exit 1
fi

# Dépendances absentes ou plus anciennes que package-lock.json → npm ci.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "→ npm ci"
  npm ci
fi

npm run dist:mac

VERSION="$(node -p "require('./package.json').version")"
echo
echo "✓ $(ls -lh "release/apitester-${VERSION}-mac-arm64.dmg" | awk '{print $5, $NF}')"
