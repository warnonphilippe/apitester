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
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'X-Original-Filename'],
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

// Gestion d'erreurs (taille dépassée, etc.)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Echo server à l'écoute sur http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/echo   (multipart, champ "file")`);
  console.log(`  GET  http://localhost:${PORT}/health`);
});
