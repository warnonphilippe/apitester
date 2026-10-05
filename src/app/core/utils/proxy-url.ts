/**
 * Proxy dynamique : l'apitester relaie lui-même l'appel vers la cible
 * (middleware Vite en dev, nginx en Docker). La requête du navigateur reste
 * sur la même origine, donc sans contrainte CORS, et aucune cible n'a besoin
 * d'être déclarée à l'avance.
 *
 *   https://api.exemple.com:8443/v1/users?x=1
 *   → /__proxy/https/api.exemple.com:8443/v1/users?x=1
 *
 * Le schéma est un segment de chemin (et non `https://`) car nginx fusionne
 * les doubles slashes.
 */
export const PROXY_PREFIX = '/__proxy';

/**
 * En-tête obligatoire sur toute requête relayée : un site tiers ne peut pas
 * le poser sans preflight CORS, que le relais ne valide jamais. Le relais
 * le retire avant de transmettre à la cible.
 */
export const PROXY_HEADER = 'X-Apitester-Proxy';

/**
 * Réécrit une URL absolue http(s) vers le proxy dynamique. Une URL relative
 * (ex. un alias déclaré dans proxy.config.json) ou d'un autre schéma est
 * renvoyée telle quelle.
 */
export function toProxyUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  return `${PROXY_PREFIX}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`;
}
