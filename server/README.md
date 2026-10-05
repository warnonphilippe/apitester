# Echo server (test)

Petit serveur Express qui reçoit un fichier en `multipart/form-data` et le renvoie tel quel.
Sert à tester l'upload multipart et la cohérence de taille de réponse de l'API Load Tester.

## Démarrage

```bash
cd server
npm install
npm start          # http://localhost:8888  (npm run dev pour le rechargement auto)
```

## Endpoints

| Méthode | URL | Description |
|---|---|---|
| `POST` | `/echo` | Reçoit un fichier multipart (champ `file`) et le renvoie à l'identique (mêmes Content-Type, taille et nom). Nom de champ paramétrable via `?field=<nom>`. |
| `GET` | `/health` | `{ "status": "ok" }` |
| tous | `/test` | Réponse à profil aléatoire, pour illustrer les résultats d'un test de charge : **80 %** en 0,9–1,1 s, **10 %** en 1,5–3 s, **5 %** lentes en 4,5–5,5 s (HTTP 200, `{ "status": "ok", "method": "GET" }`) et **5 %** d'erreurs rapides en 100–300 ms (HTTP 500, 502 ou 503, `{ "error": "Erreur simulée", "status": 503 }`). Le profil tiré et le délai sont dans les en-têtes `X-Test-Profile` et `X-Test-Delay-Ms`. Les réponses 200 ont une taille constante (pour un verbe donné) : pas de fausse incohérence de taille. Proportions modifiables dans `TEST_PROFILES` ([server.js](server.js)). |
| `POST` | `/test-convert` | Simule un service de conversion : reçoit un fichier multipart (champ `file`, comme `/echo`) et le renvoie après un délai à profil aléatoire : **75 %** en 0,9–1,1 s, **10 %** en 1,5–3 s, **5 %** lentes en 4,5–5,5 s, **5 %** d'erreurs rapides en 100–300 ms (HTTP 500, 502 ou 503) et **5 %** en 0,9–1,1 s avec seulement **la première moitié du fichier** (pour illustrer la détection d'incohérence de taille). Mêmes en-têtes `X-Test-*` que `/test`. Proportions modifiables dans `TEST_CONVERT_PROFILES`. |

CORS est ouvert : l'app Angular (`http://localhost:4200`) peut appeler `http://localhost:8888/echo` directement, sans proxy.

## Configurer le test dans l'app

1. Verbe : **POST**
2. URL : `http://localhost:8888/echo`
3. Onglet **Body** → **form-data** → une ligne de type **Fichier**, clé `file`, et sélectionner un fichier.
4. La réponse renvoyée a exactement la même taille que le fichier envoyé → utile pour valider la détection d'incohérence de taille (toutes les réponses doivent avoir la même taille).
