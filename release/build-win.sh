#!/usr/bin/env bash
# Construit l'installeur Windows x64 depuis macOS (ou Linux), sans Wine :
#   release/apitester-<version>-win-x64.exe
# Usage : ./release/build-win.sh   (depuis n'importe quel dossier)
# Sur un PC Windows, lancer directement : npm run dist:win
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Dépendances absentes ou plus anciennes que package-lock.json → npm ci.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "→ npm ci"
  npm ci
fi

npm run dist:win

VERSION="$(node -p "require('./package.json').version")"
echo
echo "✓ $(ls -lh "release/apitester-${VERSION}-win-x64.exe" | awk '{print $5, $NF}')"
echo "  Installeur non signé : SmartScreen demandera « Exécuter quand même » (voir README)."
