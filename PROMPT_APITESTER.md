# Prompt de génération — Application Angular API Load Tester

## Objectif

Génère une application **Angular 17+** (standalone components, signals) avec **Vite.js** comme bundler (via `@analogjs/vite-plugin-angular` ou équivalent), permettant d'effectuer des **tests de charge et de masse** d'une API REST depuis le navigateur.

> **Point critique — pas de simulation :** l'application doit **réellement émettre les requêtes HTTP** vers l'API cible. Chaque virtual user correspond à une chaîne RxJS qui boucle sur de vrais appels `HttpClient`. Les métriques (temps de réponse, taille, status) sont mesurées sur les réponses réseau réelles. Il n'y a aucun mock, aucune donnée simulée, aucune réponse fictive. Si la requête échoue ou que le serveur est injoignable, cela se reflète immédiatement dans les résultats.

L'application est 100 % front-end, sans backend propre : les appels HTTP sont émis directement depuis le navigateur via `HttpClient` Angular, avec `withFetch()` activé (`provideHttpClient(withFetch())`) pour utiliser l'API `fetch` native et bénéficier du streaming des réponses.

---

## Stack technique obligatoire

| Élément | Choix |
|---|---|
| Framework | Angular 17+ (standalone, signals) |
| Bundler | Vite.js (`vite` + plugin Angular) |
| Langage | TypeScript strict |
| Styles | Tailwind CSS |
| Graphiques | Chart.js + `ng2-charts` |
| Icônes | Heroicons (SVG inline) |
| State | Services Angular avec `signal()` / `computed()` |
| HTTP | `HttpClient` Angular |

Pas de NgModules classiques. Tout en standalone components. Utilise `inject()` plutôt que le constructeur pour les dépendances.

---

## Architecture des fichiers

```
src/
  app/
    core/
      services/
        load-test.service.ts       # orchestration des VUs
        http-runner.service.ts     # obtention token + exécution d'un appel HTTP unique
        keycloak-auth.service.ts   # password flow OAuth2 vers Keycloak
        results-store.service.ts   # agrégation des métriques
      models/
        test-config.model.ts       # interfaces TypeScript
        test-result.model.ts
    features/
      request-config/              # formulaire de configuration de la requête
        request-config.component.ts
        params-table/              # table clé/valeur réutilisable
        body-editor/               # éditeur JSON / form-data / raw
        auth-editor/               # configuration authentification
      load-config/                 # formulaire de config du test de charge
        load-config.component.ts
      results/                     # tableau de bord des résultats
        results.component.ts
        chart-panel/
        stats-panel/
        response-size-panel/
    shared/
      components/
        toggle-switch/
        code-editor/
        file-upload/
  main.ts
  app.component.ts (layout shell)
```

---

## Modèles TypeScript (`core/models/`)

### `test-config.model.ts`

```typescript
export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type BodyType = 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw' | 'binary';

export type AuthType = 'none' | 'oauth2-password';

export interface KeyValueParam {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface FileParam {
  key: string;
  file: File;
  enabled: boolean;
}

export interface AuthConfig {
  type: AuthType;
  // oauth2-password (Resource Owner Password Credentials — Keycloak)
  tokenUrl?: string;    // ex: https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  scope?: string;       // optionnel, ex: openid
}

export interface RequestConfig {
  verb: HttpVerb;
  url: string;                        // peut contenir des variables {{var}}
  pathParams: KeyValueParam[];        // variables dans le chemin /users/:id
  queryParams: KeyValueParam[];       // ?key=value
  headers: KeyValueParam[];
  bodyType: BodyType;
  bodyJson: string;                   // JSON brut (string)
  bodyFormFields: KeyValueParam[];    // form-data ou urlencoded
  bodyFiles: FileParam[];             // multipart file(s)
  bodyRaw: string;                    // raw text
  bodyContentType?: string;           // si raw
  auth: AuthConfig;
  followRedirects: boolean;
  timeoutMs: number;                  // timeout par requête en ms
}

export type RampMode = 'fixed' | 'ramp-up' | 'step';

export interface LoadConfig {
  virtualUsers: number;               // nb d'utilisateurs virtuels en parallèle
  durationSeconds: number;            // durée totale du test
  rampMode: RampMode;
  rampUpSeconds?: number;             // durée de la montée en charge
  stepCount?: number;                 // nb de paliers (ramp step)
  thinkTimeMs: number;                // pause entre deux requêtes par VU (ms)
  maxRequestsPerSecond?: number;      // rate limiting global (0 = illimité)
  iterations?: number;                // si défini, arrêt dès X itérations atteintes
  stopOnErrorRate?: number;           // stopper si taux d'erreur > X% (0 = désactivé)
}
```

### `test-result.model.ts`

```typescript
export interface SingleCallResult {
  timestamp: number;          // epoch ms du début de l'appel
  durationMs: number;         // temps de réponse
  statusCode: number;
  isError: boolean;
  responseBodySize: number;   // en octets
  vuId: number;               // identifiant du virtual user
  iterationId: number;
}

export interface TimeSeriesBucket {
  t: number;                  // epoch ms (début de la fenêtre de 1 s)
  requestCount: number;
  errorCount: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgResponseSize: number;    // octets
}

export interface AggregatedStats {
  totalRequests: number;
  totalErrors: number;
  errorRatePct: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughputRpm: number;      // requêtes / minute
  avgResponseSize: number;
  minResponseSize: number;
  maxResponseSize: number;
  responseSizeInconsistencies: number;   // nb de réponses dont la taille dévie > seuil
  responseSizeStdDev: number;
  elapsedSeconds: number;
}
```

---

## Fonctionnalités détaillées

### 1. Formulaire de configuration de la requête (`request-config`)

L'interface est organisée en **onglets** (tabs), comme Postman :

#### Onglet Params
- Tableau de **path params** (variables détectées automatiquement dans l'URL si elles sont de la forme `:param` ou `{{param}}`).
- Tableau de **query params** clé/valeur avec checkbox `enabled` par ligne.
- Bouton `+ Add row` en bas de chaque tableau.
- Les lignes désactivées ne sont pas envoyées.

#### Onglet Headers
- Tableau clé/valeur identique aux query params.
- Pré-rempli avec `Content-Type` et `Accept` selon le bodyType sélectionné (auto-sync).
- Case à cocher pour activer/désactiver chaque header.

#### Onglet Body
Sélecteur de type de body (radio buttons ou dropdown) :

| Type | Comportement |
|---|---|
| `none` | Aucun body |
| `json` | Éditeur JSON avec coloration syntaxique (CodeMirror 6 ou textarea monospace avec validation JSON live) |
| `form-data` | Tableau clé/valeur + possibilité d'attacher un fichier par ligne (toggle text / file) |
| `x-www-form-urlencoded` | Tableau clé/valeur uniquement texte |
| `raw` | Textarea + sélecteur de Content-Type (text/plain, application/xml, application/graphql, etc.) |
| `binary` | Drag & drop d'un fichier unique |

#### Onglet Auth
Sélecteur de type d'auth (deux options uniquement) :

| Type | Description |
|---|---|
| `none` | Aucune authentification |
| `OAuth 2.0 — Password Flow` | Appel Keycloak avant chaque requête pour obtenir un token Bearer |

Lorsque `OAuth 2.0 — Password Flow` est sélectionné, afficher les champs suivants :

| Champ | Type | Description |
|---|---|---|
| Token URL | Input texte | URL complète du endpoint token Keycloak, ex : `https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token` |
| Client ID | Input texte | Identifiant du client Keycloak |
| Client Secret | Input password (toggle show/hide) | Secret du client |
| Username | Input texte | Identifiant de l'utilisateur |
| Password | Input password (toggle show/hide) | Mot de passe de l'utilisateur |
| Scope | Input texte (optionnel) | Ex : `openid`, laisser vide si non requis |

Bouton **"Tester l'authentification"** : effectue un appel unique vers le Token URL et affiche le résultat (succès avec `access_token` tronqué, ou message d'erreur) sans lancer le test de charge.

#### Barre supérieure
- **Dropdown HttpVerb** : GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS (couleurs distinctes par verbe).
- **Champ URL** : input texte large, support de `{{variable}}` mis en évidence.
- **Bouton "Test unique"** : exécute un seul appel et affiche la réponse brute (status, headers, body, taille, durée) dans un panel dédié, sans lancer le test de charge.
- **Timeout par requête** : champ numérique (défaut 30 000 ms).
- **Follow redirects** : toggle.

---

### 2. Formulaire de configuration du test de charge (`load-config`)

Affiché dans un panneau séparé sous la config de la requête :

| Champ | Type | Description |
|---|---|---|
| Virtual Users | Nombre (1–500) | Nombre de VUs en parallèle |
| Durée (s) | Nombre | Durée totale du test |
| Mode de montée en charge | Sélecteur | `fixed` / `ramp-up` / `step` |
| Ramp-up duration (s) | Nombre (si ramp-up ou step) | Durée de la montée |
| Nombre de paliers | Nombre (si step) | Ex : 3 paliers → 1/3 VU → 2/3 VU → VU max |
| Think time (ms) | Nombre | Pause entre deux itérations par VU |
| Max req/s | Nombre (0 = illimité) | Limite globale de débit |
| Stop on error rate | % (0 = désactivé) | Arrêt automatique si taux d'erreur dépasse ce seuil |
| Max iterations | Nombre (0 = illimité) | Arrêt dès que ce nombre total de requêtes est atteint |
| Seuil incohérence taille (%) | Nombre | Déviation de taille de réponse considérée comme incohérente (défaut 5 %) |

Boutons :
- **▶ Lancer le test** : démarre le test de charge.
- **⏹ Arrêter** : arrêt propre (termine les VUs en cours, n'envoie plus de nouvelles requêtes).
- **↺ Réinitialiser** : efface tous les résultats.

---

### 3. Moteur d'exécution (`load-test.service.ts` + `http-runner.service.ts`)

#### Principe fondamental

Le moteur **émet de vraies requêtes HTTP** vers l'URL cible configurée par l'utilisateur. Il n'y a aucune simulation. Chaque itération de chaque virtual user déclenche un appel réseau réel et attend la réponse réelle avant de mesurer les métriques.

#### `keycloak-auth.service.ts` — obtention du Bearer token (Password Flow)

Ce service est responsable d'obtenir un `access_token` valide **avant chaque appel à l'API testée** lorsque `auth.type === 'oauth2-password'`.

```typescript
fetchToken(auth: AuthConfig): Observable<string> {
  const body = new HttpParams()
    .set('grant_type', 'password')
    .set('client_id', auth.clientId!)
    .set('client_secret', auth.clientSecret!)
    .set('username', auth.username!)
    .set('password', auth.password!)
    .set('scope', auth.scope ?? '');

  return this.httpClient.post<{ access_token: string }>(
    auth.tokenUrl!,
    body.toString(),
    { headers: new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }) }
  ).pipe(
    map(response => response.access_token),
    catchError((err: HttpErrorResponse) => {
      throw new Error(`Keycloak token error ${err.status}: ${JSON.stringify(err.error)}`);
    })
  );
}
```

**Règle absolue** : le token Keycloak est obtenu **à chaque itération** de chaque virtual user, juste avant l'appel à l'API testée. Il n'est **pas mis en cache** entre les itérations, afin de refléter le comportement réel d'un client qui s'authentifie à chaque appel (cas de charge réaliste). Si le test de charge dure longtemps, cette stratégie simule aussi la pression sur Keycloak lui-même.

Le temps écoulé pour obtenir le token Keycloak est **exclu** de la mesure de durée de réponse (`durationMs`) — seul le temps de l'appel à l'API cible est mesuré.

#### `http-runner.service.ts` — exécution d'un appel unique

Ce service orchestre l'appel Keycloak (si configuré) puis l'appel réel à l'API :

```typescript
executeOne(config: RequestConfig, vuId: number, iterationId: number): Observable<SingleCallResult> {
  const tokenObs$: Observable<string | null> =
    config.auth.type === 'oauth2-password'
      ? this.keycloakAuth.fetchToken(config.auth)
      : of(null);

  return tokenObs$.pipe(
    switchMap(token => {
      const t0 = performance.now();  // démarrage APRÈS obtention du token
      const req = buildHttpRequest(config, token);  // injecte Bearer si token non null
      return this.httpClient.request(req).pipe(
        map((response: HttpResponse<unknown>) => ({
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - t0),
          statusCode: response.status,
          isError: response.status >= 400,
          responseBodySize: measureSize(response),
          vuId,
          iterationId,
        })),
        catchError((err: HttpErrorResponse | Error) => of({
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - t0),
          statusCode: err instanceof HttpErrorResponse ? (err.status ?? 0) : 0,
          isError: true,
          responseBodySize: 0,
          vuId,
          iterationId,
        }))
      );
    }),
    catchError(tokenErr => of({   // erreur lors de l'obtention du token Keycloak
      timestamp: Date.now(),
      durationMs: 0,
      statusCode: 0,
      isError: true,
      errorDetail: `AUTH_ERROR: ${tokenErr.message}`,
      responseBodySize: 0,
      vuId,
      iterationId,
    }))
  );
}
```

Détail de `buildHttpRequest(config, token)` :
- Résout les **path params** (`/users/:id` → `/users/42`) en remplaçant les placeholders dans l'URL.
- Insère les **query params** activés dans l'URL via `HttpParams`.
- Ajoute tous les **headers** activés.
- Si `token` est non null, ajoute `Authorization: Bearer <token>` dans les headers (écrase tout header `Authorization` existant).
- Construit le **body** selon `bodyType` :
  - `json` → `JSON.parse(bodyJson)` (Content-Type `application/json`).
  - `form-data` → `FormData` avec champs texte et fichiers (`File` objects du formulaire).
  - `x-www-form-urlencoded` → `HttpParams` sérialisé en string.
  - `raw` → string brut avec le Content-Type explicite.
  - `binary` → `Blob` ou `File` directement.
  - `none` → pas de body.
- Utilise `observe: 'response'` pour accéder au status HTTP, headers et body complets.
- Applique le **timeout** via `timeout(config.timeoutMs)` RxJS (`TimeoutError` capturée et comptée comme erreur).

Mesure de la taille de réponse (`measureSize`) :
1. Lire `Content-Length` dans les headers de réponse → si présent et > 0, utiliser cette valeur.
2. Sinon, si le body est une `string`, prendre `new TextEncoder().encode(body).length`.
3. Sinon, si le body est un objet, prendre `new TextEncoder().encode(JSON.stringify(body)).length`.
4. Toujours en octets, jamais en caractères.

#### `load-test.service.ts` — orchestration des VUs

- Utilise **RxJS** : `interval` pour l'horloge du test, `merge` pour paralléliser les VUs.
- Chaque VU est une boucle **récursive RxJS** (expand + delay) :
  - émet un appel réel via `http-runner.service.ts`
  - attend `thinkTimeMs` ms
  - recommence — jusqu'à ce que le signal d'arrêt soit émis ou la durée écoulée.
- En mode `ramp-up` : les VUs sont ajoutés un à un (ou par groupe) à intervalle régulier sur `rampUpSeconds` secondes.
- En mode `step` : on ajoute des paliers de `Math.ceil(virtualUsers / stepCount)` VUs à intervalles égaux.
- Chaque `SingleCallResult` reçu est poussé dans un `Subject<SingleCallResult>` central partagé avec `results-store.service.ts`.
- Le **rate limiting** (`maxRequestsPerSecond`) est implémenté via un `BehaviorSubject` comptant les émissions dans la fenêtre courante d'1 s, avec `delayWhen` si le quota est atteint.
- **Arrêt sur seuil d'erreur** : un `computed()` sur le store vérifie le taux d'erreur en continu ; si `errorRatePct > stopOnErrorRate`, on émet le signal d'arrêt.

#### `results-store.service.ts` — agrégation en temps réel

- Souscrit au `Subject<SingleCallResult>` du moteur.
- Agrège dans des **buckets de 1 seconde** (`TimeSeriesBucket`) : compte, somme des durées, min, max, tri pour percentiles.
- Les percentiles (P50, P95, P99) sont calculés par tri du tableau de durées dans le bucket courant.
- **Détection des incohérences de taille** : après les 5 premières réponses réussies (status < 400), calcule la taille médiane comme référence. Toute réponse ultérieure dont la taille dévie de plus du seuil configuré (%) est marquée `isInconsistentSize: true` et ajoutée au tableau des incohérences.
- Les signaux `currentStats: Signal<AggregatedStats>` et `buckets: Signal<TimeSeriesBucket[]>` sont mis à jour à chaque nouveau bucket (1 fois/seconde) pour limiter les re-renders.

---

### 4. Tableau de bord des résultats (`results`)

#### Panel stats globales (toujours visible)
Affiche en temps réel, sous forme de cartes :

- Total requêtes envoyées
- Taux d'erreur (%)
- Débit (req/min)
- Temps de réponse : min / moy / max / P50 / P95 / P99
- Taille de réponse : min / moy / max / écart-type
- Nombre d'incohérences de taille détectées (badge rouge si > 0)
- Temps écoulé / durée totale (barre de progression)

#### Panel graphique temps réel

**Chart.js line chart** avec l'axe X = temps (secondes depuis le début du test).

Courbes disponibles (chacune avec une case à cocher pour afficher/masquer) :

| Courbe | Couleur suggérée | Unité Y |
|---|---|---|
| Requêtes envoyées / min | Bleu | req/min |
| Erreurs / min | Rouge | erreurs/min |
| Taux d'erreur (%) | Orange | % |
| Temps de réponse moyen | Vert | ms |
| Temps de réponse P50 | Vert clair | ms |
| Temps de réponse P95 | Jaune | ms |
| Temps de réponse P99 | Orange foncé | ms |
| Temps de réponse min | Gris clair | ms |
| Temps de réponse max | Gris foncé | ms |
| Taille de réponse moyenne | Violet | octets |
| Virtual users actifs | Cyan | nb |

Les courbes dont l'unité Y diffère (ms vs req/min vs %) utilisent des **axes Y multiples** (Chart.js `yAxisID`). Les cases à cocher sont présentées comme une légende interactive au-dessus du graphique, avec la couleur de la courbe correspondante.

#### Panel incohérences de taille de réponse

Tableau listant chaque réponse dont la taille est jugée incohérente :

| Colonne | Description |
|---|---|
| # | Numéro de la requête |
| VU | ID du virtual user |
| Timestamp | Heure exacte |
| Status | Code HTTP |
| Taille reçue | En octets |
| Taille référence | Médiane de référence |
| Écart | En octets et en % |

Exportable en CSV.

#### Panel log des erreurs

Tableau en temps réel des appels en erreur (status ≥ 400 ou timeout) :

| Colonne | Description |
|---|---|
| Timestamp | Heure |
| VU | ID |
| Status | Code HTTP ou `TIMEOUT` / `NETWORK_ERROR` |
| Durée | ms |
| Message | Extrait du body d'erreur (100 premiers caractères) |

Limité aux 500 dernières erreurs pour ne pas saturer le DOM. Exportable en CSV.

---

### 5. Export des résultats

Boutons dans le panneau résultats :
- **Export JSON** : toutes les `SingleCallResult[]` brutes.
- **Export CSV (statistiques)** : les `TimeSeriesBucket[]` agrégés par seconde.
- **Export CSV (erreurs)** : le log des erreurs.
- **Export CSV (incohérences)** : le tableau des tailles incohérentes.

---

### 6. Sauvegarde / chargement de la configuration

- Bouton **"Sauvegarder la config"** : sérialise `RequestConfig` + `LoadConfig` en JSON et propose le téléchargement d'un fichier `.apitester.json`.
- Bouton **"Charger une config"** : input file qui relit un `.apitester.json` et réhydrate le formulaire. Les fichiers binaires (body binary, form-data files) ne sont **pas** sérialisables : afficher un avertissement et vider ces champs.
- **LocalStorage** : auto-sauvegarde de la dernière configuration à chaque modification (debounce 1 s), rechargée automatiquement à l'ouverture de l'application.

---

### 7. Gestion CORS

Afficher un bandeau d'avertissement si la requête test unique échoue avec une erreur réseau (non CORS détectable directement, mais signaler à l'utilisateur que cela peut être dû à CORS et proposer des solutions : proxy dev Vite, extension navigateur).

---

## Contraintes d'implémentation

1. **Les appels HTTP sont réels et obligatoires.** Il n'existe aucune couche de mock, aucun stub, aucune donnée synthétique. Chaque virtual user envoie de vraies requêtes réseau vers l'URL configurée par l'utilisateur et attend les vraies réponses. Les métriques proviennent exclusivement des réponses réseau effectives. Tout écart à cette règle invalide l'application.
2. **`observe: 'response'`** est obligatoire sur tous les appels `HttpClient` afin d'accéder au status HTTP, aux headers et au body complet. Ne jamais utiliser `observe: 'body'` seul.
3. **`performance.now()`** est utilisé (pas `Date.now()`) pour mesurer les durées de réponse avec une précision sub-milliseconde. `Date.now()` n'est utilisé que pour horodater les événements dans `SingleCallResult.timestamp`.
4. **Aucun appel réel depuis un Web Worker** : les appels HTTP utilisent `HttpClient` dans le thread principal, via des souscriptions RxJS par VU. Ne pas utiliser de Web Workers.
5. **Pas de backend** : l'application est un SPA statique, sans serveur Node.js propre. `provideHttpClient(withFetch())` est configuré dans `app.config.ts`.
6. **Performances DOM** : les graphiques ne sont mis à jour qu'une fois par seconde (bucket de 1 s). Le log d'erreurs est tronqué à 500 lignes. Les signaux Angular ne sont pas mis à jour à chaque appel HTTP individuel.
7. **Typage strict** : `strict: true` dans `tsconfig.json`. Pas de `any`. Les réponses HTTP sont typées `HttpResponse<unknown>` et narrowées explicitement.
8. **Validation du formulaire** : Reactive Forms Angular avec validators. Le bouton "Lancer le test" est désactivé si le formulaire est invalide.
9. **Responsive** : l'application doit être utilisable sur un écran de bureau 1280 px minimum. Pas besoin d'optimisation mobile.
10. **Accessibilité** : labels ARIA sur les champs, navigation clavier fonctionnelle.
11. **Environnements** : `environment.ts` / `environment.prod.ts` avec `apiBaseUrl` (pour proxy Vite éventuel).

---

## Configuration Vite (`vite.config.ts`)

```typescript
// Inclure un proxy de développement configurable
server: {
  proxy: {
    '/proxy': {
      target: process.env['VITE_PROXY_TARGET'] ?? 'http://localhost:8080',
      rewrite: (path) => path.replace(/^\/proxy/, ''),
      changeOrigin: true,
    }
  }
}
```

---

## UX et layout général

```
┌──────────────────────────────────────────────────────────────────┐
│  API Load Tester                                     [Save] [Load]│
├──────────────────────────────────────────────────────────────────┤
│ [GET▼] [  URL field                              ] [Test] [▶ Run] │
├──────────┬───────────────────────────────────────────────────────┤
│ Params   │                                                        │
│ Headers  │   Tab content area (params / headers / body / auth)   │
│ Body     │                                                        │
│ Auth     │                                                        │
├──────────┴───────────────────────────────────────────────────────┤
│ Load config: VUs [__] Duration [__]s Mode [ramp-up▼] [▶ Start]  │
├──────────────────────────────────────────────────────────────────┤
│ RESULTS                                                           │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌────────────┐ ┌─────────────────────┐ │
│ │ Req │ │ Err%│ │req/m│ │ Avg / P95  │ │  Size avg / anomaly │ │
│ └─────┘ └─────┘ └─────┘ └────────────┘ └─────────────────────┘ │
│ [☑ req/min] [☑ errors] [☑ avg ms] [☐ P95] [☐ max] ...          │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │   Chart.js line chart (real-time, multi-axis)              │   │
│ └────────────────────────────────────────────────────────────┘   │
│ [Tab: Stats] [Tab: Size anomalies] [Tab: Error log]              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Instructions de génération

1. Génère l'intégralité des fichiers source listés dans l'architecture.
2. Commence par les modèles (`core/models/`), puis les services, puis les composants.
3. Chaque composant doit être standalone avec ses imports explicites.
4. Fournis le `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`.
5. Fournis un `README.md` avec les instructions `npm install` et `npm run dev`.
6. Ne laisse aucun `TODO` ou `// implement later` dans le code généré : tout doit être fonctionnel.
