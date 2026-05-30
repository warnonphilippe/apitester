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

CORS est ouvert : l'app Angular (`http://localhost:4200`) peut appeler `http://localhost:8888/echo` directement, sans proxy.

## Configurer le test dans l'app

1. Verbe : **POST**
2. URL : `http://localhost:8888/echo`
3. Onglet **Body** → **form-data** → une ligne de type **Fichier**, clé `file`, et sélectionner un fichier.
4. La réponse renvoyée a exactement la même taille que le fichier envoyé → utile pour valider la détection d'incohérence de taille (toutes les réponses doivent avoir la même taille).
