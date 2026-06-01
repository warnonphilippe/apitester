import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';
import { AuthConfig } from '../models/test-config.model';

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface CacheEntry {
  token: string;
  /** Epoch ms à partir duquel le token doit être renouvelé (expiration - marge). */
  expiresAt: number;
}

/**
 * OAuth2 Resource Owner Password Credentials flow against Keycloak.
 *
 * Le token est mis en cache et réutilisé tant qu'il est valide, afin de ne pas
 * marteler Keycloak sous charge (sinon la protection brute-force / quick-login-check
 * renvoie des `invalid_grant` intermittents bien que les identifiants soient corrects).
 *
 * Deux protections :
 *  - réutilisation du token jusqu'à `expires_in` moins une marge de sécurité ;
 *  - déduplication des requêtes concurrentes : si N VUs demandent un token en même
 *    temps alors que le cache est vide/expiré, UNE seule requête part vers Keycloak,
 *    les autres partagent son résultat.
 */
@Injectable({ providedIn: 'root' })
export class KeycloakAuthService {
  private readonly http = inject(HttpClient);

  /** Renouvelle le token cette durée AVANT son expiration réelle. */
  private readonly RENEW_SKEW_MS = 10_000;
  /** Durée de vie supposée si Keycloak n'envoie pas `expires_in`. */
  private readonly DEFAULT_TTL_SECONDS = 60;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Observable<string>>();

  fetchToken(auth: AuthConfig): Observable<string> {
    const key = this.cacheKey(auth);

    // 1) Token encore valide en cache → réutilisation immédiate, aucun appel réseau.
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return of(cached.token);
    }

    // 2) Une requête est déjà en vol pour cette config → on s'y rattache (anti-stampede).
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    // 3) Sinon on lance UNE requête, partagée par tous les abonnés concurrents.
    const request$ = this.requestToken(auth).pipe(
      tap((res) => {
        const ttlSeconds = res.expires_in ?? this.DEFAULT_TTL_SECONDS;
        const expiresAt = Date.now() + Math.max(0, ttlSeconds * 1000 - this.RENEW_SKEW_MS);
        this.cache.set(key, { token: res.access_token, expiresAt });
      }),
      map((res) => res.access_token),
      finalize(() => this.inFlight.delete(key)),
      shareReplay(1),
    );
    this.inFlight.set(key, request$);
    return request$;
  }

  /** Vide le cache (utile entre deux campagnes de test). */
  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  private requestToken(auth: AuthConfig): Observable<TokenResponse> {
    let body = new HttpParams()
      .set('grant_type', 'password')
      .set('client_id', auth.clientId ?? '')
      .set('username', auth.username ?? '')
      .set('password', auth.password ?? '');

    if (auth.clientSecret) {
      body = body.set('client_secret', auth.clientSecret);
    }
    if (auth.scope) {
      body = body.set('scope', auth.scope);
    }

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    return this.http
      .post<TokenResponse>(auth.tokenUrl ?? '', body.toString(), { headers })
      .pipe(
        map((res) => {
          if (!res?.access_token) {
            throw new Error('Keycloak response did not contain access_token');
          }
          return res;
        }),
        catchError((err: HttpErrorResponse) => {
          const detail =
            err.error && typeof err.error === 'object'
              ? JSON.stringify(err.error)
              : (err.error ?? err.message);
          return throwError(
            () => new Error(`Keycloak token error ${err.status}: ${detail}`),
          );
        }),
      );
  }

  /** Clé de cache : une config d'auth distincte = un token distinct. */
  private cacheKey(auth: AuthConfig): string {
    return [
      auth.tokenUrl ?? '',
      auth.clientId ?? '',
      auth.username ?? '',
      auth.scope ?? '',
    ].join('|');
  }
}
