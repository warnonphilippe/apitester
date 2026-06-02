# API Load Tester

Application **Angular 19 + Vite** pour effectuer des **tests de masse / de charge réels** sur une API REST, directement depuis le navigateur.

> ⚠️ **Pas de simulation.** Chaque virtual user émet de vraies requêtes HTTP vers l'API cible et mesure les vraies réponses (status, durée, taille). Aucun mock.

## Fonctionnalités

- **Configuration de requête type Postman** : verbe (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), URL avec variables `:id` / `{{var}}`, query params, path params, headers, body (`json`, `form-data` avec upload de fichiers, `x-www-form-urlencoded`, `raw`, `binary`).
- **Authentification OAuth2 Password Flow (Keycloak)** : un token est obtenu **avant chaque appel** (sans cache) et injecté en `Bearer`. La latence Keycloak est exclue du temps de réponse mesuré.
- **Test de charge** : virtual users en parallèle, durée, montée en charge (`fixed` / `ramp-up` / `step`), think time, rate limiting, arrêt sur seuil d'erreur, max d'itérations.
- **Résultats temps réel** : cartes de stats (débit, percentiles P50/P95/P99, min/moy/max), graphique Chart.js multi-axes avec **courbes activables/désactivables**.
- **Détection d'incohérences de taille** : la taille médiane des 5 premières réponses sert de référence ; toute réponse qui en dévie de plus du seuil (%) est signalée.
- **Exports** : JSON brut, CSV (stats/s, erreurs, incohérences).
- **Sauvegarde / chargement** de la config (`.apitester.json`) + auto-save localStorage.

## Démarrage

```bash
npm install
npm run dev      # serveur de dev sur http://localhost:4200
```

Build de production :

```bash
npm run build    # sortie dans dist/
npm run preview  # prévisualise le build
```

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

### Configuration du proxy

Les routes proxy (contournement CORS) sont définies dans `proxy.config.json` à la racine du projet. Ce fichier est lu automatiquement par Vite en développement **et** par nginx dans Docker.

> 🔒 `proxy.config.json` est **ignoré par git** (il peut contenir des URLs internes/sensibles). Un modèle versionné [`proxy.config.example.json`](proxy.config.example.json) documente le format — copiez-le :
> ```bash
> cp proxy.config.example.json proxy.config.json
> ```

```json
{
  "/proxy": {
    "target": "http://mon-api:8080",
    "secure": false
  },
  "/windoc-dev": {
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

> Sans `proxy.config.json`, le container démarre normalement mais sans aucun proxy configuré.

## CORS

Les appels partent du navigateur : l'API cible doit renvoyer les en-têtes CORS, sinon utilisez le proxy. Éditez [`proxy.config.json`](proxy.config.json) pour pointer vers votre API :

```json
{ "/proxy": { "target": "http://mon-api:8080", "secure": false } }
```

Puis utilisez `/proxy/...` comme URL dans l'app — `/proxy/users` est relayé vers `http://mon-api:8080/users`, aussi bien en dev (`npm run dev`) qu'en Docker.

## Structure

```
src/app/
  core/
    models/      # interfaces (RequestConfig, LoadConfig, résultats)
    services/    # keycloak-auth, http-runner, load-test, results-store, config-store
  features/
    request-config/   # formulaire de requête (onglets)
    load-config/      # paramètres du test de charge
    results/          # dashboard + chart-panel
  shared/components/   # kv-table réutilisable
```

## Notes techniques

- `provideHttpClient(withFetch())` — backend fetch natif, mesure fiable de la taille via `responseType: 'text'` + `Content-Length`.
- Les VUs sont des boucles async sur le thread principal (pas de Web Workers — `HttpClient` n'y est pas disponible).
- Le graphe et les stats sont rafraîchis une fois par seconde (buckets) pour ne pas saturer le DOM.
```
