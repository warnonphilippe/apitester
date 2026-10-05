#!/usr/bin/env bash
# Démarre le serveur de test seul (http://localhost:8888), par exemple pour
# l'app de bureau. Ctrl+C l'arrête.
# Usage : ./server/start.sh            (depuis n'importe quel dossier)
#         PORT=9000 ./server/start.sh  (autre port)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8888}"
cd "$DIR"

# Dépendances absentes ou plus anciennes que package-lock.json → npm ci
# (et non npm install : le lock versionné n'est jamais réécrit).
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "→ npm ci"
  npm ci
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✗ Le port $PORT est déjà utilisé (serveur de test déjà lancé ?)." >&2
  echo "  Arrêtez le processus concerné, ou choisissez un autre port : PORT=9000 $0" >&2
  exit 1
fi

# Au premier plan : le serveur affiche ses URL, Ctrl+C l'arrête.
PORT="$PORT" exec node server.js
