import http, { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Plugin } from 'vite';

/**
 * Proxy dynamique de l'apitester, côté Vite (dev et preview).
 *
 *   /__proxy/https/api.exemple.com:8443/v1/users?x=1
 *   → https://api.exemple.com:8443/v1/users?x=1
 *
 * Aucune cible à déclarer : le navigateur reste sur sa propre origine (pas de
 * CORS) et c'est ce serveur qui appelle la cible. Le pendant Docker est le
 * `location /__proxy/` généré par deploy/entrypoint.sh — garder les deux alignés.
 */
const PREFIX = '/__proxy';

/** Obligatoire : un site tiers ne peut pas le poser sans preflight CORS, jamais validé ici. */
const GUARD_HEADER = 'x-apitester-proxy';

/** Propres à une connexion (RFC 9110 §7.6.1) : jamais relayés. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Retirés vers la cible pour que l'appel ressemble à un appel serveur à serveur :
 * sans Origin, un backend ne le rejette pas en « Invalid CORS request » ; les
 * cookies sont ceux de localhost, pas ceux de la cible.
 */
const STRIPPED_REQUEST = new Set(['host', 'origin', 'referer', 'cookie', GUARD_HEADER]);

/** <http|https>/<hôte[:port]>/<chemin et query> — le chemin commence toujours par « / ». */
const TARGET_RE = /^\/(https?)\/([^/?#@]+)(\/[^#]*)$/;

// Keep-alive : sous charge, pas de nouvelle connexion (ni poignée de main TLS) par appel.
// Certificats non vérifiés, comme le `secure: false` de proxy.config.json.
const AGENTS = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
};

export function corsProxy(): Plugin {
  return {
    name: 'apitester-cors-proxy',
    configureServer(server) {
      server.middlewares.use(PREFIX, relay);
    },
    configurePreviewServer(server) {
      server.middlewares.use(PREFIX, relay);
    },
  };
}

/** Monté sur PREFIX : connect a déjà retiré « /__proxy » de req.url. */
function relay(req: IncomingMessage, res: ServerResponse): void {
  // Vite écoute sur le réseau (host: true) : le relais, lui, reste local.
  if (!isLoopback(req.socket.remoteAddress)) {
    return fail(res, 403, 'relais réservé aux appels locaux');
  }
  if (req.headers[GUARD_HEADER] !== '1') {
    return fail(res, 403, 'en-tête X-Apitester-Proxy: 1 requis');
  }

  const match = TARGET_RE.exec(req.url ?? '');
  let target: URL | null = null;
  try {
    if (match) target = new URL(`${match[1]}://${match[2]}${match[3]}`);
  } catch {
    // hôte invalide → 400 ci-dessous
  }
  if (!target) {
    return fail(res, 400, 'cible invalide, attendu /__proxy/<http|https>/<hôte[:port]>/<chemin>');
  }

  const headers: OutgoingHttpHeaders = { host: target.host };
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name) && !STRIPPED_REQUEST.has(name)) {
      headers[name] = value;
    }
  }

  const transport = target.protocol === 'https:' ? https : http;
  const proxyReq = transport.request(target, {
    method: req.method,
    headers,
    agent: AGENTS[target.protocol as keyof typeof AGENTS],
  });

  proxyReq.on('response', (proxyRes) => {
    const out: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name) && name !== 'set-cookie') {
        out[name] = value;
      }
    }
    // Sinon fetch suivrait la redirection en direct… et retomberait sur CORS.
    if (typeof out['location'] === 'string') {
      out['location'] = proxiedLocation(out['location'], target);
    }
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, out);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err: Error & { code?: string }) => {
    fail(res, 502, [err.code, err.message].filter(Boolean).join(' '));
  });

  // Requête abandonnée par le navigateur (timeout, arrêt du test) : libère la connexion.
  res.on('close', () => {
    if (!res.writableFinished) proxyReq.destroy();
  });

  req.pipe(proxyReq); // uploads relayés en flux, sans mise en mémoire
}

/** Location absolue ou relative → URL équivalente via le relais. */
function proxiedLocation(location: string, base: URL): string {
  let u: URL;
  try {
    u = new URL(location, base);
  } catch {
    return location;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return location;
  return `${PREFIX}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}${u.hash}`;
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}

function fail(res: ServerResponse, status: number, detail: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'APITESTER_PROXY_ERROR', detail }));
}
