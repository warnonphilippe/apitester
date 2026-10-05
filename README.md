# API Load Tester

Application **Angular 20 + Vite** pour effectuer des **tests de masse / de charge réels** sur une API REST, directement depuis le navigateur.

> ⚠️ **Pas de simulation.** Chaque virtual user émet de vraies requêtes HTTP vers l'API cible et mesure les vraies réponses (status, durée, taille). Aucun mock.

## Fonctionnalités

- **Configuration de requête type Postman** : verbe (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), URL avec variables `:id` / `{{var}}`, query params, path params, headers, body (`json`, `form-data` avec upload de fichiers, `x-www-form-urlencoded`, `raw`, `binary`).
- **Authentification OAuth2 Password Flow (Keycloak)** : un token est obtenu **avant chaque appel** (sans cache) et injecté en `Bearer`. La latence Keycloak est exclue du temps de réponse mesuré.
- **Test de charge** : virtual users en parallèle, durée, montée en charge (`fixed` / `ramp-up` / `step`), think time, rate limiting, arrêt sur seuil d'erreur, max d'itérations.
- **Résultats temps réel** : cartes de stats (débit, percentiles P50/P95/P99, min/moy/max), graphique Chart.js multi-axes avec **courbes activables/désactivables**.
- **Détection d'incohérences de taille** : la taille médiane des 5 premières réponses sert de référence ; toute réponse qui en dévie de plus du seuil (%) est signalée.
- **Exports** : JSON brut, CSV (stats/s, erreurs, incohérences).
- **Sauvegarde / chargement** de la config (`.apitester.json`) + auto-save localStorage.
- **Proxy dynamique « Via proxy »** : appelle n'importe quel serveur, même sans en-têtes CORS, sans rien déclarer à l'avance (voir [CORS](#cors)).
- **Application de bureau** macOS / Windows (Electron) : appels directs vers n'importe quel serveur, sans CORS ni proxy (voir [Application de bureau](#application-de-bureau-electron)).

## Démarrage

```bash
npm install
npm run dev      # serveur de dev sur http://localhost:4200
```

Ou, pour lancer en une commande l'apitester **et** le [serveur echo de test](server/README.md) (http://localhost:8888), Ctrl+C arrêtant les deux :

```bash
./start.sh
```

Build de production :

```bash
npm run build    # sortie dans dist/
npm run preview  # prévisualise le build
```

## Application de bureau (Electron)

L'apitester existe aussi en **application de bureau** pour macOS (Apple Silicon) et Windows (x64). Elle appelle **n'importe quel serveur directement**, sans proxy ni configuration : la fenêtre de l'app n'applique pas CORS.

### Construire

```bash
npm run electron    # build + lance l'app localement (sans packaging)
npm run dist:mac    # release/apitester-<version>-mac-arm64.dmg
npm run dist:win    # release/apitester-<version>-win-x64.exe (installeur)
```

Les deux paquets se construisent depuis un Mac, Windows compris : electron-builder produit l'installeur NSIS sans Wine. Configuration : [`electron-builder.yml`](electron-builder.yml) ; processus principal : [`electron/main.js`](electron/main.js).

### Installer

Les paquets **ne sont pas signés** par un certificat d'éditeur (pas de compte Apple Developer ni de certificat Windows) :

- **macOS** : ouvrir le `.dmg` et glisser l'app dans Applications. Une app téléchargée est mise en quarantaine (« endommagée » ou « développeur non identifié ») ; lever la quarantaine une fois :
  ```bash
  xattr -dr com.apple.quarantine "/Applications/API Load Tester.app"
  ```
- **Windows** : lancer l'installeur (installation par utilisateur, sans droits administrateur). Si SmartScreen affiche « Windows a protégé votre ordinateur » : *Informations complémentaires* → *Exécuter quand même*.

### Appels réseau

- **Pas de CORS** (`webSecurity: false`) : chaque requête, API comme Keycloak, part en direct vers la cible. Pas de preflight, pas de relais, et le temps mesuré est le vrai temps réseau.
- **`Origin` et `Referer` sont retirés** des requêtes sortantes. Sinon la cible recevrait `Origin: app://apitester`, et un backend doté d'une config CORS (Spring…) répondrait 403. Coût mesuré : environ 0,1 ms par requête.
- **La case « Via proxy » n'apparaît pas** : elle n'y sert à rien. Une config importée avec « Via proxy » coché fonctionne telle quelle, en direct.
- **La fenêtre est durcie** pour compenser : pas d'accès Node, sandbox, aucun contenu distant chargé, navigation et ouverture de fenêtres bloquées hors de l'app.

La configuration est conservée entre deux lancements (stockage local de l'app). « Sauvegarder la config » et les exports ouvrent le dialogue natif « Enregistrer sous ».

## Déploiement Docker

Les scripts de déploiement se trouvent dans le répertoire [`deploy/`](deploy/).

### Build et publication sur Docker Hub

```bash
# Dernière version (tag latest)
./deploy/deploy.sh

# Version taguée
./deploy/deploy.sh 1.2.3
```

Cela construit et pousse deux images **multi-arch** (amd64 + arm64) sur Docker Hub :
- `pwarnon/apitester` — frontend Angular servi par nginx
- `pwarnon/apitester-echo` — serveur echo Node.js (port 8888)

### Lancer l'application sur un autre Mac / PC

Copier le fichier [`deploy/apitester.yml`](deploy/apitester.yml) sur la machine cible, puis :

```bash
# Démarrer (télécharge les images automatiquement)
docker compose -f apitester.yml up -d

# Accéder à http://localhost:4200

# Mettre à jour
docker compose -f apitester.yml pull
docker compose -f apitester.yml up -d

# Arrêter
docker compose -f apitester.yml down
```

### Alias de proxy (optionnel)

Pour contourner CORS, la case **« Via proxy »** suffit : aucune configuration (voir [CORS](#cors)). `proxy.config.json` reste disponible pour définir des **alias courts** (`/proxy/users` au lieu de l'URL complète). Ce fichier est lu automatiquement par Vite en développement **et** par nginx dans Docker.

> 🔒 `proxy.config.json` est **ignoré par git** (il contient la configuration propre a chaque poste). Un modèle versionné [`proxy.config.example.json`](proxy.config.example.json) documente le format — copiez-le :
> ```bash
> cp proxy.config.example.json proxy.config.json
> ```

```json
{
  "/proxy": {
    "target": "http://mon-api:8080",
    "secure": false
  },
  "/service-b": {
    "target": "https://autre-service:8443",
    "secure": false
  }
}
```

Chaque clé est un préfixe d'URL ; le préfixe est retiré avant de relayer la requête (ex. `/proxy/users` → `http://mon-api:8080/users`). On peut ajouter autant d'entrées que nécessaire.

#### Sur le poste de développement (source)

Créer le fichier à la racine (`cp proxy.config.example.json proxy.config.json`) et l'adapter. Vite le lit au démarrage de `npm run dev`. Il n'est pas versionné.

#### Sur un poste client (Docker)

Le fichier **n'est pas intégré dans l'image** — il doit être placé **dans le même répertoire qu'`apitester.yml`** :

```
~/apitester/            ← ou n'importe quel dossier
├── apitester.yml
└── proxy.config.json
```

```bash
docker compose -f apitester.yml up -d
```

Le volume `./proxy.config.json:/etc/nginx/proxy.config.json:ro` dans le compose le monte dans le container ; `entrypoint.sh` génère la config nginx au démarrage. Pour prendre en compte une modification du fichier :

```bash
docker compose -f apitester.yml restart apitester
```

> Sans `proxy.config.json`, le container démarre normalement, sans alias ; le proxy dynamique reste disponible.

## CORS

Les appels partent du navigateur : sans en-têtes CORS renvoyés par l'API cible, le navigateur les bloque (`NETWORK_OR_CORS_ERROR`). Deux façons de contourner cela, en dev (`npm run dev`) comme en Docker.

### « Via proxy » — n'importe quel serveur, sans configuration

Cochez **« Via proxy »** à côté de l'URL. L'appel (et la demande de token Keycloak) est alors relayé par l'apitester lui-même :

```
https://api.exemple.com:8443/v1/users?x=1
→ /__proxy/https/api.exemple.com:8443/v1/users?x=1
```

Le navigateur reste sur sa propre origine, donc plus de CORS, et aucune cible n'est à déclarer ni à redémarrer. Le relais est un middleware Vite en dev ([`vite-cors-proxy.ts`](vite-cors-proxy.ts)) et nginx en Docker ([`deploy/entrypoint.sh`](deploy/entrypoint.sh)). Il :

- retire `Origin`, `Referer` et `Cookie` : l'appel ressemble à un appel serveur à serveur ;
- ramène les redirections (`Location`) dans le relais ;
- n'impose pas de certificat TLS valide (comme `"secure": false`) ;
- renvoie un 502 `APITESTER_PROXY_ERROR` si la cible est injoignable.

À savoir :

- **Mesure** : le relais ajoute un saut local au temps mesuré. Il est négligeable avec nginx. Le serveur Vite, mono-processus, peut en revanche saturer avant l'API sous forte charge : préférez l'image Docker pour les gros tirs, ou un appel direct si l'API gère CORS.
- **Docker** : `localhost` / `127.0.0.1` saisis dans l'app désignent le poste hôte (via `host.docker.internal`), et non le container.
- **Sécurité** : le relais exige l'en-tête `X-Apitester-Proxy: 1`, que l'app ajoute. Un site tiers ne peut pas le poser sans preflight CORS, jamais validé. Le relais n'accepte que des appels locaux : vérification de l'adresse en dev, port publié sur `127.0.0.1` dans [`deploy/apitester.yml`](deploy/apitester.yml).

### Alias déclarés dans `proxy.config.json`

Pour une URL courte vers une API récurrente, déclarez un préfixe (voir [Alias de proxy](#alias-de-proxy-optionnel)) :

```json
{ "/proxy": { "target": "http://mon-api:8080", "secure": false } }
```

Puis utilisez `/proxy/...` comme URL dans l'app, sans cocher « Via proxy » : `/proxy/users` est relayé vers `http://mon-api:8080/users`.

## Données & confidentialité

- **Identifiants** — le Client Secret et le mot de passe OAuth2 ne vivent qu'en mémoire, le temps de la session. Ils ne sont écrits ni dans le `localStorage` ni dans la configuration exportée : il faut les ressaisir après un rechargement de la page. Dans les résultats, la valeur des en-têtes `Authorization`, `Cookie` et `X-API-Key` est remplacée par `***`.
- **Exports de résultats** — l'export JSON brut et le CSV des erreurs contiennent des extraits du corps des requêtes envoyées **et des réponses de l'API testée**. Si cette API renvoie des données à caractère personnel, ces fichiers en contiennent : traitez-les comme tels (RGPD) — ne les partagez pas, ne les commitez pas, supprimez-les après analyse.
- **`proxy.config.json`** n'est pas versionné : il contient la configuration propre à chaque poste.

## Structure

```
src/app/
  core/
    models/      # interfaces (RequestConfig, LoadConfig, résultats)
    services/    # keycloak-auth, http-runner, load-test, results-store, config-store
    utils/       # proxy-url (réécriture vers le proxy dynamique), platform (app de bureau ?)
  features/
    request-config/   # formulaire de requête (onglets)
    load-config/      # paramètres du test de charge
    results/          # dashboard + chart-panel
  shared/components/   # kv-table réutilisable
electron/main.js       # app de bureau : fenêtre, schéma app://, CORS désactivé
electron-builder.yml   # packaging .dmg (macOS arm64) et .exe (Windows x64)
vite-cors-proxy.ts     # relais /__proxy/… en dev (pendant nginx : deploy/entrypoint.sh)
```

## Notes techniques

- `provideHttpClient(withFetch())` — backend fetch natif, mesure fiable de la taille via `responseType: 'text'` + `Content-Length`.
- Requêtes émises avec `cache: 'no-store'` (option `fetch` exposée par `HttpClient` depuis Angular 20) : sans cela, Chrome met en file d'attente les GET identiques simultanés (verrou du cache HTTP) et le temps mesuré inclut cette attente.
- Les VUs sont des boucles async sur le thread principal (pas de Web Workers — `HttpClient` n'y est pas disponible).
- Le graphe et les stats sont rafraîchis une fois par seconde (buckets) pour ne pas saturer le DOM.
```
