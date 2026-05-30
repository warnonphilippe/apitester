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

## CORS

Les appels partent du navigateur : l'API cible doit renvoyer les en-têtes CORS, sinon utilisez le proxy de dev Vite. Pointez votre URL sur `/proxy/...` et définissez la cible :

```bash
VITE_PROXY_TARGET=http://mon-api:8080 npm run dev
```

`/proxy/users` est alors relayé vers `http://mon-api:8080/users`.

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
