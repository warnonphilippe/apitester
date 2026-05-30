export interface SingleCallResult {
  timestamp: number; // epoch ms at start of the call
  durationMs: number; // response time of the API call (token fetch excluded)
  statusCode: number; // 0 = network/timeout/auth error
  isError: boolean;
  responseBodySize: number; // bytes
  vuId: number;
  iterationId: number;
  errorDetail?: string; // e.g. AUTH_ERROR / TIMEOUT / message snippet
  isInconsistentSize?: boolean;
  referenceSize?: number;
}

export interface TimeSeriesBucket {
  t: number; // epoch ms at the start of the 1s window
  secondOffset: number; // seconds since test start
  requestCount: number;
  errorCount: number;
  errorRatePct: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgResponseSize: number;
  activeVus: number;
}

export interface AggregatedStats {
  totalRequests: number;
  totalErrors: number;
  errorRatePct: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughputRpm: number; // requests per minute
  avgResponseSize: number;
  minResponseSize: number;
  maxResponseSize: number;
  responseSizeInconsistencies: number;
  responseSizeStdDev: number;
  referenceSize: number;
  elapsedSeconds: number;
}

export function emptyStats(): AggregatedStats {
  return {
    totalRequests: 0,
    totalErrors: 0,
    errorRatePct: 0,
    avgDurationMs: 0,
    minDurationMs: 0,
    maxDurationMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    throughputRpm: 0,
    avgResponseSize: 0,
    minResponseSize: 0,
    maxResponseSize: 0,
    responseSizeInconsistencies: 0,
    responseSizeStdDev: 0,
    referenceSize: 0,
    elapsedSeconds: 0,
  };
}

export type TestStatus = 'idle' | 'running' | 'stopping' | 'finished';
