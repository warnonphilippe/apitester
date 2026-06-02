#!/bin/sh
set -e

# Valeurs par défaut pour les proxies
PROXY_TARGET="${PROXY_TARGET:-http://localhost:8080}"
WINDOC_DEV_TARGET="${WINDOC_DEV_TARGET:-http://localhost:8443}"

export PROXY_TARGET WINDOC_DEV_TARGET

# Substitue uniquement les variables du template (pas les variables nginx comme $uri)
envsubst '${PROXY_TARGET} ${WINDOC_DEV_TARGET}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
