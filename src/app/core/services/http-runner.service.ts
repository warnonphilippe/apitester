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
    response: HttpResponse<ArrayBuffer>,
    t0: number,
    vuId: number,
    iterationId: number,
  ): SingleCallDetail {
    const headers: Record<string, string> = {};
    response.headers.keys().forEach((k) => {
      headers[k] = response.headers.get(k) ?? '';
    });
    const contentType = response.headers.get('Content-Type') ?? '';
    return {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - t0),
      statusCode: response.status,
      isError: response.status >= 400,
      responseBodySize: this.measureSize(response.body, response.headers),
      vuId,
      iterationId,
      responseHeaders: headers,
      responseBodyPreview: this.bodyPreview(response.body, contentType),
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
    let size = 0;
    if (err instanceof HttpErrorResponse) {
      statusCode = err.status ?? 0;
      const errBody = err.error instanceof ArrayBuffer ? err.error : null;
      size = this.measureSize(errBody, err.headers);
      const contentType = err.headers.get('Content-Type') ?? '';
      // status 0 means CORS/network failure
      detail =
        statusCode === 0
          ? `NETWORK_OR_CORS_ERROR: ${err.message}`
          : this.bodyPreview(errBody, contentType) ?? err.message;
    } else if (this.messageOf(err).toLowerCase().includes('timeout')) {
      detail = 'TIMEOUT';
    }
    return {
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - t0),
      statusCode,
      isError: true,
      responseBodySize: size,
      vuId,
      iterationId,
      errorDetail: detail,
    };
  }

  /** Builds and fires the real request, emitting a single HttpResponse. */
  private request(
    config: RequestConfig,
    token: string | null,
  ): Observable<HttpResponse<ArrayBuffer>> {
    const url = this.resolveUrl(config);
    const params = this.buildQueryParams(config.queryParams);
    const headers = this.buildHeaders(config, token);
    const body = this.buildBody(config);

    return this.http.request(config.verb, url, {
      body,
      headers,
      params,
      observe: 'response',
      // arraybuffer => exact byte count for ANY payload (PDF, image, zip, JSON…).
      // Text is decoded only for the human-readable preview.
      responseType: 'arraybuffer',
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

  private measureSize(body: ArrayBuffer | null, headers: HttpHeaders): number {
    // Exact decompressed byte length — works for binary (PDF, image…) and text.
    if (body) return body.byteLength;
    // No body materialized (e.g. HEAD): fall back to Content-Length if present.
    const cl = headers.get('Content-Length');
    if (cl) {
      const n = Number(cl);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    return 0;
  }

  private readonly TEXTUAL = /(text\/|json|xml|javascript|x-www-form-urlencoded|csv|html|graphql)/i;

  private bodyPreview(body: ArrayBuffer | null, contentType: string): string | undefined {
    if (!body || body.byteLength === 0) return undefined;
    const isText = !contentType || this.TEXTUAL.test(contentType);
    if (!isText) {
      const type = contentType.split(';')[0].trim() || 'application/octet-stream';
      return `[contenu binaire : ${body.byteLength} octets · ${type}]`;
    }
    // decode only the first slice for preview
    const slice = body.byteLength > 4000 ? body.slice(0, 4000) : body;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    return body.byteLength > 4000 ? text + '…' : text;
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
