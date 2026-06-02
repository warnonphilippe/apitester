#!/bin/sh
set -e

# Valeurs par défaut pour les proxies
PROXY_TARGET="${PROXY_TARGET:-http://localhost:8080}"
SECOND_TARGET="${SECOND_TARGET:-http://localhost:8443}"

export PROXY_TARGET SECOND_TARGET

# Substitue uniquement les variables du template (pas les variables nginx comme $uri)
envsubst '${PROXY_TARGET} ${SECOND_TARGET}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
