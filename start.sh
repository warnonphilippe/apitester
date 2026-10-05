#!/usr/bin/env bash
# Démarre en local le serveur echo de test (http://localhost:8888)
# et l'apitester (http://localhost:4200). Ctrl+C arrête les deux.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ECHO_PORT=8888
APP_PORT=4200

install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    echo "→ npm install dans $1"
    (cd "$1" && npm install)
  fi
}

check_port_free() {
  if lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ Le port $1 ($2) est déjà utilisé. Arrêtez le processus concerné puis relancez." >&2
    exit 1
  fi
}

install_if_needed "$ROOT"
install_if_needed "$ROOT/server"
check_port_free "$ECHO_PORT" "serveur echo"
check_port_free "$APP_PORT" "apitester"

if [ ! -f "$ROOT/proxy.config.json" ]; then
  echo "ℹ proxy.config.json absent : démarrage sans proxy (modèle : proxy.config.example.json)."
fi

# Serveur echo en arrière-plan. `exec node` (et non `npm start`) pour que
# SERVER_PID soit bien le process node et que l'arrêt soit fiable.
(cd "$ROOT/server" && PORT="$ECHO_PORT" exec node server.js) &
SERVER_PID=$!

cleanup() {
  trap - INT TERM EXIT
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Attend que le serveur echo réponde avant de lancer le front (5 s max).
for _ in $(seq 1 25); do
  curl -sf "http://localhost:$ECHO_PORT/health" >/dev/null 2>&1 && break
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ Le serveur echo s'est arrêté au démarrage." >&2
    exit 1
  fi
  sleep 0.2
done

cd "$ROOT"
npm run dev
