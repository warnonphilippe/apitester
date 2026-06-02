#!/bin/sh
set -e

PROXY_CONFIG="/etc/nginx/proxy.config.json"
NGINX_CONF="/etc/nginx/conf.d/default.conf"

# Base — single-quoted heredoc preserves $uri etc. as literal nginx variables
cat > "$NGINX_CONF" << 'EOF'
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

EOF

# Proxy locations générés dynamiquement depuis proxy.config.json
if [ -f "$PROXY_CONFIG" ]; then
    echo "→ Chargement proxy.config.json"
    jq -r '
      to_entries[] |
      "    location " + .key + "/ {\n" +
      "        proxy_pass " + .value.target + "/;\n" +
      "        proxy_http_version 1.1;\n" +
      "        proxy_set_header Host $proxy_host;\n" +
      "        proxy_set_header X-Real-IP $remote_addr;\n" +
      "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" +
      "        proxy_set_header X-Forwarded-Proto $scheme;\n" +
      "        proxy_ssl_verify " + (if .value.secure == false then "off" else "on" end) + ";\n" +
      "        proxy_read_timeout 300s;\n" +
      "        proxy_send_timeout 300s;\n" +
      "    }\n"
    ' "$PROXY_CONFIG" >> "$NGINX_CONF"
else
    echo "→ Aucun proxy.config.json trouvé, démarrage sans proxy."
fi

echo "}" >> "$NGINX_CONF"

exec nginx -g 'daemon off;'
