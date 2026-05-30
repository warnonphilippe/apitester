export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_VERBS: HttpVerb[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export type BodyType = 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw' | 'binary';

export type AuthType = 'none' | 'oauth2-password';

export interface KeyValueParam {
  key: string;
  value: string;
  enabled: boolean;
  /** For form-data only: a row can hold a file instead of a text value. */
  isFile?: boolean;
  file?: File | null;
  description?: string;
}

/**
 * OAuth2 Resource Owner Password Credentials flow (Keycloak).
 * A fresh token is requested before EVERY single API call (no caching).
 */
export interface AuthConfig {
  type: AuthType;
  tokenUrl?: string; // e.g. https://kc/realms/r/protocol/openid-connect/token
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  scope?: string;
}

export interface RequestConfig {
  verb: HttpVerb;
  url: string; // may contain :pathParam or {{var}} placeholders
  pathParams: KeyValueParam[];
  queryParams: KeyValueParam[];
  headers: KeyValueParam[];
  bodyType: BodyType;
  bodyJson: string;
  bodyFormFields: KeyValueParam[]; // form-data or x-www-form-urlencoded
  bodyRaw: string;
  bodyRawContentType: string;
  bodyBinaryFile: File | null;
  auth: AuthConfig;
  timeoutMs: number;
}

export type RampMode = 'fixed' | 'ramp-up' | 'step';

export interface LoadConfig {
  virtualUsers: number;
  durationSeconds: number;
  rampMode: RampMode;
  rampUpSeconds: number;
  stepCount: number;
  thinkTimeMs: number;
  maxRequestsPerSecond: number; // 0 = unlimited
  maxIterations: number; // 0 = unlimited
  stopOnErrorRate: number; // % , 0 = disabled
  sizeInconsistencyThresholdPct: number; // deviation from reference median considered an anomaly
  minResponseSize: number; // bytes; a response smaller than this is flagged as an error (0 = disabled)
}

export function defaultRequestConfig(): RequestConfig {
  return {
    verb: 'GET',
    url: '',
    pathParams: [],
    queryParams: [],
    headers: [
      { key: 'Accept', value: 'application/json', enabled: true },
    ],
    bodyType: 'none',
    bodyJson: '{\n  \n}',
    bodyFormFields: [],
    bodyRaw: '',
    bodyRawContentType: 'text/plain',
    bodyBinaryFile: null,
    auth: { type: 'none' },
    timeoutMs: 30000,
  };
}

export function defaultLoadConfig(): LoadConfig {
  return {
    virtualUsers: 10,
    durationSeconds: 30,
    rampMode: 'fixed',
    rampUpSeconds: 5,
    stepCount: 3,
    thinkTimeMs: 0,
    maxRequestsPerSecond: 0,
    maxIterations: 0,
    stopOnErrorRate: 0,
    sizeInconsistencyThresholdPct: 5,
    minResponseSize: 0,
  };
}
