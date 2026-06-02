#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
DOCKER_USER="pwarnon"
IMAGE_MAIN="${DOCKER_USER}/apitester"
IMAGE_ECHO="${DOCKER_USER}/apitester-echo"
PLATFORM="linux/amd64,linux/arm64"   # multi-arch : Intel + Apple Silicon

# Le tag peut être passé en argument : ./deploy.sh 1.2.3
TAG="${1:-latest}"
# ──────────────────────────────────────────────────────────────────────────────

# Ce script doit être lancé depuis la racine du projet
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "──────────────────────────────────────────"
echo " API Tester — build & push Docker Hub"
echo " Tag        : ${TAG}"
echo " Plateforme : ${PLATFORM}"
echo "──────────────────────────────────────────"

# Vérifie que Docker est connecté
if ! docker info > /dev/null 2>&1; then
  echo "❌  Docker n'est pas lancé. Démarre Docker Desktop et réessaie."
  exit 1
fi

if ! docker buildx inspect apitester-builder > /dev/null 2>&1; then
  echo "→ Création du buildx builder multi-arch…"
  docker buildx create --name apitester-builder --use
else
  docker buildx use apitester-builder
fi

# ── Image principale (Angular + nginx) ────────────────────────────────────────
echo ""
echo "→ Build & push  ${IMAGE_MAIN}:${TAG}"
docker buildx build \
  --platform "${PLATFORM}" \
  --file deploy/Dockerfile \
  --tag "${IMAGE_MAIN}:${TAG}" \
  --push \
  .

if [ "${TAG}" != "latest" ]; then
  echo "→ Tag  ${IMAGE_MAIN}:latest"
  docker buildx build \
    --platform "${PLATFORM}" \
    --file deploy/Dockerfile \
    --tag "${IMAGE_MAIN}:latest" \
    --push \
    .
fi

# ── Image echo server (Node.js) ────────────────────────────────────────────────
echo ""
echo "→ Build & push  ${IMAGE_ECHO}:${TAG}"
docker buildx build \
  --platform "${PLATFORM}" \
  --file deploy/Dockerfile.echo \
  --tag "${IMAGE_ECHO}:${TAG}" \
  --push \
  .

if [ "${TAG}" != "latest" ]; then
  echo "→ Tag  ${IMAGE_ECHO}:latest"
  docker buildx build \
    --platform "${PLATFORM}" \
    --file deploy/Dockerfile.echo \
    --tag "${IMAGE_ECHO}:latest" \
    --push \
    .
fi

echo ""
echo "✅  Images publiées sur Docker Hub :"
echo "   • ${IMAGE_MAIN}:${TAG}"
echo "   • ${IMAGE_ECHO}:${TAG}"
echo ""
echo "   Commande pour déployer :"
echo "   docker compose -f deploy/apitester.yml up -d"
