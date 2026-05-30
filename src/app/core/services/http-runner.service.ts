import { Injectable, inject } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
  HttpResponse,
} from '@angular/common/http';
import { Observable, catchError, map, of, switchMap, timeout } from 'rxjs';
import { KeyValueParam, RequestConfig } from '../models/test-config.model';
import { SingleCallResult } from '../models/test-result.model';
import { KeycloakAuthService } from './keycloak-auth.service';

export interface SingleCallDetail extends SingleCallResult {
  responseHeaders?: Record<string, string>;
  responseBodyPreview?: string;
}

@Injectable({ providedIn: 'root' })
export class HttpRunnerService {
  private readonly http = inject(HttpClient);
  private readonly keycloak = inject(KeycloakAuthService);

  /**
   * Performs ONE real HTTP call to the target API.
   * If OAuth2 password flow is configured, a fresh Keycloak token is fetched first;
   * its latency is NOT counted in durationMs.
   */
  executeOne(
    config: RequestConfig,
    vuId: number,
    iterationId: number,
  ): Observable<SingleCallDetail> {
    const token$: Observable<string | null> =
      config.auth.type === 'oauth2-password'
        ? this.keycloak.fetchToken(config.auth)
        : of(null);

    return token$.pipe(
      switchMap((token) => {
        const t0 = performance.now(); // start AFTER the token is obtained
        // observe:'response' => a single HttpResponse is emitted (no intermediate
        // Sent/Progress events), so the fetch backend is not torn down early.
        return this.request(config, token).pipe(
          timeout(config.timeoutMs),
          map((response: HttpResponse<unknown>) =>
            this.toResult(response, t0, vuId, iterationId),
          ),
          catchError((err: unknown) =>
            of(this.toErrorResult(err, t0, vuId, iterationId)),
          ),
        );
      }),
      // Token acquisition failure
      catchError((tokenErr: unknown) =>
        of(<SingleCallDetail>{
          timestamp: Date.now(),
          durationMs: 0,
          statusCode: 0,
          isError: true,
          responseBodySize: 0,
          vuId,
          iterationId,
          errorDetail: `AUTH_ERROR: ${this.messageOf(tokenErr)}`,
        }),
      ),
    );
  }

  private toResult(
    response: HttpResponse<unknown>,
    t0: number,
    vuId: number,
    iterationId: number,
  ): SingleCallDetail {
    const headers: Record<string, string> = {};
    response.headers.keys().forEach((k) => {
      headers[k] = response.headers.get(k) ?? '';
    });
    return {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - t0),
      statusCode: response.status,
      isError: response.status >= 400,
      responseBodySize: this.measureSize(response),
      vuId,
      iterationId,
      responseHeaders: headers,
      responseBodyPreview: this.bodyPreview(response.body),
    };
  }

  private toErrorResult(
    err: unknown,
    t0: number,
    vuId: number,
    iterationId: number,
  ): SingleCallDetail {
    let statusCode = 0;
    let detail = this.messageOf(err);
    if (err instanceof HttpErrorResponse) {
      statusCode = err.status ?? 0;
      // status 0 means CORS/network failure
      detail =
        statusCode === 0
          ? `NETWORK_OR_CORS_ERROR: ${err.message}`
          : this.bodyPreview(err.error) ?? err.message;
    } else if (this.messageOf(err).toLowerCase().includes('timeout')) {
      detail = 'TIMEOUT';
    }
    return {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - t0),
      statusCode,
      isError: true,
      responseBodySize: 0,
      vuId,
      iterationId,
      errorDetail: detail,
    };
  }

  /** Builds and fires the real request, emitting a single HttpResponse. */
  private request(
    config: RequestConfig,
    token: string | null,
  ): Observable<HttpResponse<string>> {
    const url = this.resolveUrl(config);
    const params = this.buildQueryParams(config.queryParams);
    const headers = this.buildHeaders(config, token);
    const body = this.buildBody(config);

    return this.http.request(config.verb, url, {
      body,
      headers,
      params,
      observe: 'response',
      responseType: 'text', // text lets us measure raw body size reliably
    });
  }

  private resolveUrl(config: RequestConfig): string {
    let url = config.url.trim();
    for (const p of config.pathParams) {
      if (!p.enabled || !p.key) continue;
      const enc = encodeURIComponent(p.value);
      url = url
        .replace(new RegExp(`:${this.escapeRegex(p.key)}(?=/|$|\\?)`, 'g'), enc)
        .replace(new RegExp(`\\{\\{\\s*${this.escapeRegex(p.key)}\\s*\\}\\}`, 'g'), enc);
    }
    return url;
  }

  private buildQueryParams(rows: KeyValueParam[]): HttpParams {
    let params = new HttpParams();
    for (const r of rows) {
      if (r.enabled && r.key) {
        params = params.append(r.key, r.value);
      }
    }
    return params;
  }

  private buildHeaders(config: RequestConfig, token: string | null): HttpHeaders {
    let headers = new HttpHeaders();
    for (const h of config.headers) {
      if (h.enabled && h.key) {
        headers = headers.append(h.key, h.value);
      }
    }
    // Body content-type handling (skip for FormData: the browser sets the boundary).
    if (config.bodyType === 'json' && !headers.has('Content-Type')) {
      headers = headers.set('Content-Type', 'application/json');
    } else if (config.bodyType === 'x-www-form-urlencoded' && !headers.has('Content-Type')) {
      headers = headers.set('Content-Type', 'application/x-www-form-urlencoded');
    } else if (config.bodyType === 'raw' && !headers.has('Content-Type')) {
      headers = headers.set('Content-Type', config.bodyRawContentType);
    }
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  private buildBody(config: RequestConfig): unknown {
    switch (config.bodyType) {
      case 'none':
        return null;
      case 'json':
        return config.bodyJson;
      case 'raw':
        return config.bodyRaw;
      case 'binary':
        return config.bodyBinaryFile;
      case 'x-www-form-urlencoded': {
        let p = new HttpParams();
        for (const f of config.bodyFormFields) {
          if (f.enabled && f.key) p = p.append(f.key, f.value);
        }
        return p.toString();
      }
      case 'form-data': {
        const fd = new FormData();
        for (const f of config.bodyFormFields) {
          if (!f.enabled || !f.key) continue;
          if (f.isFile && f.file) {
            fd.append(f.key, f.file, f.file.name);
          } else {
            fd.append(f.key, f.value);
          }
        }
        return fd;
      }
      default:
        return null;
    }
  }

  private measureSize(response: HttpResponse<unknown>): number {
    const cl = response.headers.get('Content-Length');
    if (cl) {
      const n = Number(cl);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    const body = response.body;
    if (body == null) return 0;
    if (typeof body === 'string') return new TextEncoder().encode(body).length;
    try {
      return new TextEncoder().encode(JSON.stringify(body)).length;
    } catch {
      return 0;
    }
  }

  private bodyPreview(body: unknown): string | undefined {
    if (body == null) return undefined;
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
  }

  private messageOf(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
