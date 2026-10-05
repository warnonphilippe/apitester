#!/bin/sh
set -e

PROXY_CONFIG="/etc/nginx/proxy.config.json"
NGINX_CONF="/etc/nginx/conf.d/default.conf"

# Proxy dynamique — proxy_pass à variables résout l'hôte à chaque requête et
# exige un resolver : celui du container (127.0.0.11 = DNS embarqué de Docker).
RESOLVER=$(awk '/^nameserver/ { ip = $2; if (ip ~ /:/) ip = "[" ip "]"; print ip; exit }' /etc/resolv.conf 2>/dev/null || true)
RESOLVER=${RESOLVER:-127.0.0.11}

# localhost vu du container = nginx lui-même : on vise le poste hôte à la place.
# Lu dans /etc/hosts (extra_hosts du compose) car le resolver nginx ignore ce
# fichier ; sinon le nom est résolu par DNS (Docker Desktop le fournit).
HOST_GATEWAY=$(awk '{ for (i = 2; i <= NF; i++) if ($i == "host.docker.internal") { ip = $1; if (ip ~ /:/) ip = "[" ip "]"; print ip; exit } }' /etc/hosts 2>/dev/null || true)
HOST_GATEWAY=${HOST_GATEWAY:-host.docker.internal}

# Base — single-quoted heredoc preserves $uri etc. as literal nginx variables
cat > "$NGINX_CONF" << 'EOF'
# Proxy dynamique : /__proxy/<http|https>/<hôte[:port]>/<chemin> → <scheme>://<hôte[:port]>/<chemin>.
# Pendant Docker de vite-cors-proxy.ts — garder les deux alignés.
# Découpage sur $request_uri (brut) : une capture de location serait décodée et
# normalisée (%2F, //…), ce qui altérerait la requête relayée. Le chemin doit
# commencer par « / » : sinon proxy_pass renverrait /__proxy/… tel quel à la cible.
map $request_uri $apx_scheme {
    "~^/__proxy/(?<apx_s>https?)/[^/?#:@]+(:[0-9]+)?/" $apx_s;
    default "";
}
map $request_uri $apx_hostname {
    "~^/__proxy/https?/(?<apx_h>[^/?#:@]+)(:[0-9]+)?/" $apx_h;
    default "";
}
map $request_uri $apx_port {
    "~^/__proxy/https?/[^/?#:@]+(?<apx_p>:[0-9]+)?/" $apx_p;
    default "";
}
map $request_uri $apx_path {
    "~^/__proxy/https?/[^/?#:@]+(:[0-9]+)?(?<apx_r>/.*)$" $apx_r;
    default "";
}
map $apx_hostname $apx_upstream {
    localhost  __HOST_GATEWAY__;
    127.0.0.1  __HOST_GATEWAY__;
    default    $apx_hostname;
}

server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Uploads (form-data, binary) relayés : le défaut nginx (1 Mo) renverrait 413.
    client_max_body_size 200m;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /__proxy/ {
        default_type application/json;

        # Un site tiers ne peut pas poser cet en-tête sans preflight CORS, jamais validé ici.
        if ($http_x_apitester_proxy != "1") {
            return 403 '{"error":"APITESTER_PROXY_ERROR","detail":"en-tete X-Apitester-Proxy: 1 requis"}';
        }
        if ($apx_scheme = "") {
            return 400 '{"error":"APITESTER_PROXY_ERROR","detail":"cible invalide, attendu /__proxy/<http|https>/<hote[:port]>/<chemin>"}';
        }

        resolver __RESOLVER__ valid=30s ipv6=off;
        proxy_pass $apx_scheme://$apx_upstream$apx_port$apx_path;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $apx_hostname$apx_port;
        # Appel « serveur à serveur » : sans Origin, un backend ne le rejette pas
        # en « Invalid CORS request » ; les cookies sont ceux de localhost.
        proxy_set_header Origin "";
        proxy_set_header Referer "";
        proxy_set_header Cookie "";
        proxy_set_header X-Apitester-Proxy "";
        proxy_hide_header Set-Cookie;
        proxy_ssl_server_name on;
        proxy_ssl_name $apx_hostname;
        proxy_ssl_verify off;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        # Redirections ramenées dans le relais, sinon fetch les suivrait en direct
        # (et retomberait sur CORS). « default » est inopérant avec un proxy_pass à variables.
        # absolute_redirect off : sinon nginx préfixe http://localhost (sans le port publié).
        proxy_redirect ~^(https?)://([^/]+)(.*)$ /__proxy/$1/$2$3;
        proxy_redirect ~^(/.*)$ /__proxy/$apx_scheme/$apx_hostname$apx_port$1;
        absolute_redirect off;
        error_page 502 504 = @apx_error;
    }

    location @apx_error {
        default_type application/json;
        return 502 '{"error":"APITESTER_PROXY_ERROR","detail":"cible injoignable ou sans reponse"}';
    }

EOF
sed -i -e "s|__RESOLVER__|$RESOLVER|" -e "s|__HOST_GATEWAY__|$HOST_GATEWAY|g" "$NGINX_CONF"
echo "→ Proxy dynamique /__proxy/ (resolver $RESOLVER, localhost → $HOST_GATEWAY)"

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
    echo "→ Aucun proxy.config.json trouvé : pas d'alias déclaré (le proxy dynamique reste actif)."
fi

echo "}" >> "$NGINX_CONF"

exec nginx -g 'daemon off;'
