import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { AuthConfig } from '../models/test-config.model';

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * OAuth2 Resource Owner Password Credentials flow against Keycloak.
 *
 * A fresh token is requested before EVERY single API call (no caching),
 * to faithfully reproduce a realistic load both on the API and on Keycloak.
 */
@Injectable({ providedIn: 'root' })
export class KeycloakAuthService {
  private readonly http = inject(HttpClient);

  fetchToken(auth: AuthConfig): Observable<string> {
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
          return res.access_token;
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
}
