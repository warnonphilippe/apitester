import express from 'express';
import cors from 'cors';
import multer from 'multer';

const app = express();
const PORT = process.env.PORT ?? 8888;

// CORS ouvert : permet à l'app Angular (http://localhost:4200) d'appeler
// ce serveur directement depuis le navigateur, sans proxy.
// Les en-têtes ci-dessous sont aussi exposés pour que le front puisse les lire.
app.use(
  cors({
    origin: true,
    exposedHeaders: [
      'Content-Disposition',
      'Content-Length',
      'X-Original-Filename',
      'X-Test-Profile',
      'X-Test-Delay-Ms',
    ],
  }),
);

// Fichiers gardés en mémoire (pas d'écriture disque) — adapté à un echo.
// limits.fileSize à 50 Mo, ajustable.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Lit un upload multipart/form-data puis appelle onFile(file) avec le fichier
 * du champ demandé (?field=<nom>, défaut "file"), sinon le premier fichier reçu.
 * Répond 400 si la requête ne contient aucun fichier.
 */
function receiveFile(req, res, next, onFile) {
  const field = typeof req.query.field === 'string' ? req.query.field : 'file';
  // upload.any() accepte n'importe quel nom de champ.
  upload.any()(req, res, (err) => {
    if (err) return next(err);

    const files = req.files ?? [];
    if (files.length === 0) {
      return res.status(400).json({
        error: 'Aucun fichier reçu. Envoyez un multipart/form-data avec un champ fichier.',
        hint: `Champ attendu: "${field}" (ou ?field=<nom>).`,
      });
    }
    onFile(files.find((f) => f.fieldname === field) ?? files[0]);
  });
}

/** Renvoie buffer avec le Content-Type et le nom du fichier reçu. */
function sendFile(res, file, buffer) {
  res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-Original-Filename', encodeURIComponent(file.originalname));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(file.originalname)}"`,
  );
  res.status(200).send(buffer);
}

// Santé
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * POST /echo
 * Reçoit un fichier multipart/form-data (champ "file" par défaut) et le
 * renvoie tel quel, avec le même Content-Type et le même nom de fichier.
 *
 * Le nom du champ est paramétrable via ?field=monChamp (défaut: "file").
 */
app.post('/echo', (req, res, next) => {
  receiveFile(req, res, next, (file) => sendFile(res, file, file.buffer));
});

// Profils de réponse de /test et /test-convert, tirés au hasard à chaque appel
// selon leur part (pct, total = 100). Délai tiré uniformément dans [minMs, maxMs].
const TEST_PROFILES = [
  { name: 'normal', pct: 80, minMs: 900, maxMs: 1100 },
  { name: 'intermediate', pct: 10, minMs: 1500, maxMs: 3000 },
  { name: 'slow', pct: 5, minMs: 4500, maxMs: 5500 },
  { name: 'error', pct: 5, minMs: 100, maxMs: 300, statuses: [500, 502, 503] },
];

const TEST_CONVERT_PROFILES = [
  { name: 'normal', pct: 75, minMs: 900, maxMs: 1100 },
  { name: 'intermediate', pct: 10, minMs: 1500, maxMs: 3000 },
  { name: 'slow', pct: 5, minMs: 4500, maxMs: 5500 },
  { name: 'error', pct: 5, minMs: 100, maxMs: 300, statuses: [500, 502, 503] },
  { name: 'truncated', pct: 5, minMs: 900, maxMs: 1100, truncate: true },
];

const randomBetween = (min, max) => min + Math.round(Math.random() * (max - min));

function pickProfile(profiles) {
  let draw = Math.random() * 100;
  for (const profile of profiles) {
    draw -= profile.pct;
    if (draw < 0) return profile;
  }
  return profiles[0];
}

/**
 * Tire un profil, attend son délai puis répond : erreur simulée pour un profil
 * à statuses, sinon onSuccess(profile). Le profil tiré et le délai sont
 * renvoyés dans les en-têtes X-Test-Profile et X-Test-Delay-Ms.
 */
function respondWithRandomProfile(profiles, res, onSuccess) {
  const profile = pickProfile(profiles);
  const delayMs = randomBetween(profile.minMs, profile.maxMs);
  setTimeout(() => {
    res.setHeader('X-Test-Profile', profile.name);
    res.setHeader('X-Test-Delay-Ms', delayMs);
    if (profile.statuses) {
      const status = profile.statuses[Math.floor(Math.random() * profile.statuses.length)];
      return res.status(status).json({ error: 'Erreur simulée', status });
    }
    onSuccess(profile);
  }, delayMs);
}

/**
 * ALL /test
 * Réponse à comportement partiellement aléatoire, quel que soit le verbe HTTP
 * (le corps de la requête éventuel est ignoré) :
 *   - 80 % normal       : 200 en 0,9 à 1,1 s
 *   - 10 % intermediate : 200 en 1,5 à 3 s
 *   -  5 % slow         : 200 en 4,5 à 5,5 s
 *   -  5 % error        : 500, 502 ou 503 en 100 à 300 ms
 *
 * Le profil et le délai sont dans les en-têtes, pas dans le corps : une
 * réponse 200 garde ainsi une taille constante et ne déclenche pas la
 * détection d'incohérence de taille.
 */
app.all('/test', (req, res) => {
  respondWithRandomProfile(TEST_PROFILES, res, () => {
    res.json({ status: 'ok', method: req.method });
  });
});

/**
 * POST /test-convert
 * Simule un service de conversion : reçoit un fichier multipart (comme /echo)
 * et le renvoie après un délai partiellement aléatoire :
 *   - 75 % normal       : fichier complet en 0,9 à 1,1 s
 *   - 10 % intermediate : fichier complet en 1,5 à 3 s
 *   -  5 % slow         : fichier complet en 4,5 à 5,5 s
 *   -  5 % error        : 500, 502 ou 503 en 100 à 300 ms
 *   -  5 % truncated    : première moitié du fichier en 0,9 à 1,1 s, pour
 *                         illustrer la détection d'incohérence de taille
 *
 * L'upload est lu entièrement avant de répondre, même en cas d'erreur, pour
 * éviter une coupure de connexion côté navigateur.
 */
app.post('/test-convert', (req, res, next) => {
  receiveFile(req, res, next, (file) => {
    respondWithRandomProfile(TEST_CONVERT_PROFILES, res, (profile) => {
      const buffer = profile.truncate
        ? file.buffer.subarray(0, Math.floor(file.size / 2))
        : file.buffer;
      sendFile(res, file, buffer);
    });
  });
});

// Gestion d'erreurs (taille dépassée, etc.)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Echo server à l'écoute sur http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/echo           (multipart, champ "file")`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  ALL  http://localhost:${PORT}/test           (80 % ~1 s, 10 % 1,5-3 s, 5 % ~5 s, 5 % erreurs)`);
  console.log(`  POST http://localhost:${PORT}/test-convert   (multipart ; 75 % ~1 s, 10 % 1,5-3 s, 5 % ~5 s, 5 % erreurs, 5 % taille /2)`);
});
