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
  const field = typeof req.query.field === 'string' ? req.query.field : 'file';
  // upload.any() accepte n'importe quel nom de champ ; on retient le premier
  // fichier correspondant au champ demandé, sinon le tout premier fichier reçu.
  upload.any()(req, res, (err) => {
    if (err) return next(err);

    const files = req.files ?? [];
    if (files.length === 0) {
      return res.status(400).json({
        error: 'Aucun fichier reçu. Envoyez un multipart/form-data avec un champ fichier.',
        hint: `Champ attendu: "${field}" (ou ?field=<nom>).`,
      });
    }

    const file = files.find((f) => f.fieldname === field) ?? files[0];

    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Length', file.size);
    res.setHeader('X-Original-Filename', encodeURIComponent(file.originalname));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalname)}"`,
    );
    res.status(200).send(file.buffer);
  });
});

// Profils de réponse de /test, tirés au hasard à chaque appel selon leur part
// (pct, total = 100). Délai tiré uniformément dans [minMs, maxMs].
const TEST_PROFILES = [
  { name: 'normal', pct: 80, minMs: 900, maxMs: 1100 },
  { name: 'intermediate', pct: 10, minMs: 1500, maxMs: 3000 },
  { name: 'slow', pct: 5, minMs: 4500, maxMs: 5500 },
  { name: 'error', pct: 5, minMs: 100, maxMs: 300, statuses: [500, 502, 503] },
];

const randomBetween = (min, max) => min + Math.round(Math.random() * (max - min));

function pickTestProfile() {
  let draw = Math.random() * 100;
  for (const profile of TEST_PROFILES) {
    draw -= profile.pct;
    if (draw < 0) return profile;
  }
  return TEST_PROFILES[0];
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
 * Le profil tiré et le délai sont renvoyés dans les en-têtes X-Test-Profile et
 * X-Test-Delay-Ms, pas dans le corps : une réponse 200 garde ainsi une taille
 * constante et ne déclenche pas la détection d'incohérence de taille.
 */
app.all('/test', (req, res) => {
  const profile = pickTestProfile();
  const delayMs = randomBetween(profile.minMs, profile.maxMs);
  setTimeout(() => {
    res.setHeader('X-Test-Profile', profile.name);
    res.setHeader('X-Test-Delay-Ms', delayMs);
    if (profile.statuses) {
      const status = profile.statuses[Math.floor(Math.random() * profile.statuses.length)];
      return res.status(status).json({ error: 'Erreur simulée', status });
    }
    res.json({ status: 'ok', method: req.method });
  }, delayMs);
});

// Gestion d'erreurs (taille dépassée, etc.)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Echo server à l'écoute sur http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/echo   (multipart, champ "file")`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  ALL  http://localhost:${PORT}/test   (80 % ~1 s, 10 % 1,5-3 s, 5 % ~5 s, 5 % erreurs)`);
});
