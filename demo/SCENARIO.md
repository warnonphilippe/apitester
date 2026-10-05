# Scénario de démo — test de charge d'un service de conversion

Démontrer l'apitester sur un cas réaliste : **10 utilisateurs virtuels envoient en parallèle un document RTF, pendant 30 s, à un service de conversion** — la ressource `POST /test-convert` du [serveur de test](../server/README.md) — puis lire et interpréter les résultats.

Le serveur de test simule la conversion (par exemple RTF → PDF) : il renvoie le document reçu après un délai tiré au hasard à chaque appel.

| Part | Comportement simulé |
|---|---|
| 75 % | document renvoyé en 0,9–1,1 s |
| 10 % | document renvoyé en 1,5–3 s |
| 5 % | document renvoyé lentement, en 4,5–5,5 s |
| 5 % | erreur HTTP 500, 502 ou 503 en 100–300 ms |
| 5 % | HTTP 200 en ~1 s, mais **seulement la moitié du document** |

## Prérequis

```bash
./start.sh        # apitester sur http://localhost:4200, serveur de test sur http://localhost:8888
```

## Déroulé

### 1. La requête

| Action | Valeur |
|---|---|
| Verbe (liste à gauche de l'URL) | `POST` |
| URL de la requête | `http://localhost:8888/test-convert` |

### 2. Le document à convertir

1. Onglet **Body**.
2. Type **form-data** : le corps est envoyé en `multipart/form-data`, le format d'un formulaire d'upload (le navigateur fixe lui-même le *boundary*).
3. **+ Ajouter une ligne**, puis :
   - clé : `file` — le nom du champ attendu par le serveur ;
   - type (liste en fin de ligne) : **Fichier** au lieu de *Texte* ;
   - bouton de sélection : choisir le document sur le disque. Son nom et sa taille s'affichent dans la ligne.

Le même document est envoyé à chaque appel. La démo filmée utilise `rapport-annuel.rtf`, un rapport annuel factice d'environ 250 Ko (titres, paragraphes, tableaux), lisible dans TextEdit ou Word.

### 3. Les paramètres du test de charge

| Champ | Valeur | Rôle |
|---|---|---|
| Virtual Users | `10` | nombre d'utilisateurs virtuels qui enchaînent les appels en parallèle |
| Durée (s) | `30` | durée du test |
| Mode de montée | `Fixe` | les 10 VUs démarrent ensemble (*Ramp-up* et *Paliers* : montée progressive) |
| Think time (ms) | `0` | aucune pause entre deux appels d'un même VU |
| Seuil incohérence taille (%) | `5` | voir ci-dessous |

**Seuil d'incohérence de taille** — la taille de référence est la médiane des 5 premières réponses correctes. Toute réponse correcte (HTTP 2xx) dont la taille s'en écarte de plus de 5 % est signalée comme incohérente. C'est ce qui repère les documents renvoyés tronqués, que le code HTTP 200 ne trahit pas.

> **Bon à savoir** — le navigateur n'ouvre que **6 connexions simultanées vers un même serveur HTTP/1.1**. Avec 10 VUs, 4 appels attendent leur tour : ce temps d'attente est inclus dans les durées mesurées, qui sont donc plus longues que le délai du serveur. Ce n'est pas le cas des API servies en HTTP/2, comme la plupart des API HTTPS.

### 4. Exécution et suivi en temps réel

1. **▶ Lancer le test**. La barre de progression affiche le temps écoulé et le nombre de VUs actifs.
2. Le **graphe** est rafraîchi chaque seconde ; **chaque point représente les appels terminés pendant cette seconde**, pas un cumul. Par défaut : requêtes/min (bleu), erreurs/min (rouge), temps moyen (vert), P95 (jaune).
3. Les compteurs d'une seconde sont extrapolés à la minute : **Erreurs/min = 60, c'est 1 erreur dans la seconde** ; 120 = 2 erreurs.
4. Les cases au-dessus du graphe activent ou désactivent chaque courbe. La démo ajoute **P99**, **Max** et **Taille moyenne (o)**.
5. Après 30 s, le test attend la fin des appels en cours, puis affiche **Terminé**.

### 5. Lire le graphe : corrélations entre courbes

En survolant le graphe, une infobulle donne toutes les valeurs d'une seconde. La démo pointe trois secondes choisies dans les données réelles du test filmé.

**① Temps de réponse haut ↔ débit bas (corrélation inverse).** Quand le P95 et le temps moyen montent, les requêtes/min baissent au même moment. Chaque VU attend sa réponse avant d'envoyer le document suivant : occupés par des conversions lentes (~5 s), les VUs terminent moins d'appels.

**② P95, P99 et Max confondus.** Les courbes jaune, orange et grise se superposent. Une seconde ne compte que quelques réponses (3 à 7 ici) : son P95 et son P99 sont donc simplement la réponse la plus lente de la seconde. Les percentiles des cartes, eux, portent sur tous les appels du test.

**③ Creux de taille moyenne, sans effet sur les temps.** La taille moyenne baisse quand un document tronqué arrive : par exemple, 1 tronqué parmi 3 réponses donne (2 × 253 337 + 126 668) / 3 ≈ 211 114 o, soit −17 %. Le document tronqué arrive en ~1 s comme une réponse normale : il ne fait pas monter les temps. Moins il y a de réponses dans la seconde, plus le creux est profond (1 sur 6 : −8 %).

### 6. Lecture des résultats

| Carte | Ce qu'elle indique |
|---|---|
| Requêtes | nombre total d'appels envoyés |
| Taux d'erreur | part des appels en erreur (4xx/5xx, timeout, erreur réseau) et leur nombre (≈ 5 % attendu) |
| Débit | appels traités par minute |
| Temps réponse | durée moyenne, min et max (les appels lents), mesurées par le navigateur : avec 10 VUs, elles incluent l'attente d'une connexion libre, d'où une moyenne supérieure au délai du serveur |
| Percentiles | P50 : la moitié des appels a duré moins ; P95 / P99 : seuls 5 % / 1 % ont été plus lents |
| Taille réponse | taille de référence, min et max des réponses correctes, nombre d'incohérences (la carte passe en rouge s'il y en a) |

### 7. Détail des erreurs

Onglet **Log erreurs** : pour chaque appel en erreur, l'heure, le VU, le code HTTP (500, 502 ou 503), la durée et le message renvoyé par le serveur (`{"error":"Erreur simulée","status":503}`). **Export CSV (erreurs)** les exporte.

### 8. Incohérences de taille

Onglet **Incohérences taille** : les réponses HTTP 200 dont la taille est suspecte, avec la taille reçue, la taille de référence et l'écart. Ici, l'écart est d'environ **−50 %**, car le serveur a renvoyé la moitié du document. **Export CSV (incohérences)** les exporte.

## Enregistrer la vidéo

La démo est filmée automatiquement par [record-demo.mjs](record-demo.mjs) (Playwright, avec le Google Chrome installé : aucun navigateur à télécharger), légendes à l'écran comprises. Les exemples de l'étape 5 sont calculés à partir des valeurs réelles du test filmé.

```bash
cd demo
npm install --registry https://registry.npmjs.org/
npm run record              # HEADED=1 npm run record pour suivre l'enregistrement à l'écran
```

Fichiers produits dans `demo/output/` (non versionné) :

- `demo-test-convert.webm` — la vidéo (lisible dans Chrome ou VLC) ;
- `demo-test-convert.mp4` — la même en MP4 (QuickTime), si `ffmpeg` est installé (`brew install ffmpeg`) ;
- `etapes/*.png` — une capture par étape clé ;
- `rapport-annuel.rtf` — le document envoyé.

Le script vérifie d'abord que `./start.sh` tourne. À la fin, il affiche un résumé (dont les secondes retenues pour l'étape 5) et échoue si le test filmé ne montre aucune erreur ou aucune incohérence.
