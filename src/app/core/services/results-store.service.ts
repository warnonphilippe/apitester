import { Injectable, computed, signal } from '@angular/core';
import {
  AggregatedStats,
  SingleCallResult,
  TimeSeriesBucket,
  emptyStats,
} from '../models/test-result.model';

const REFERENCE_SAMPLE_COUNT = 5;

/**
 * Aggregates real call results into 1-second buckets and global stats.
 * Buckets are committed once per second to limit re-renders.
 */
@Injectable({ providedIn: 'root' })
export class ResultsStoreService {
  // raw results (kept for export)
  private readonly _raw: SingleCallResult[] = [];
  // committed buckets (signal -> drives the chart)
  private readonly _buckets = signal<TimeSeriesBucket[]>([]);
  private readonly _stats = signal<AggregatedStats>(emptyStats());
  private readonly _errors = signal<SingleCallResult[]>([]);
  private readonly _anomalies = signal<SingleCallResult[]>([]);
  private readonly _activeVus = signal<number>(0);

  readonly buckets = this._buckets.asReadonly();
  readonly stats = this._stats.asReadonly();
  readonly errors = this._errors.asReadonly();
  readonly anomalies = this._anomalies.asReadonly();
  readonly hasAnomalies = computed(() => this._anomalies().length > 0);

  // in-progress (uncommitted) bucket accumulator — flushed every second by onTick()
  // currentBucketIndex = which 1-second slot we're currently filling (-1 = not started)
  private currentBucketIndex = -1;
  private currentDurations: number[] = [];
  private currentErrors = 0;
  private currentSizes: number[] = [];

  // running global accumulators
  private testStartMs = 0;
  private totalRequests = 0;
  private totalErrors = 0;
  private allDurations: number[] = [];
  private sumDuration = 0;
  private minDuration = Number.POSITIVE_INFINITY;
  private maxDuration = 0;
  private sumSize = 0;
  private minSize = Number.POSITIVE_INFINITY;
  private maxSize = 0;
  private sizeSamples: number[] = []; // for reference + stddev
  private referenceSize = 0;
  private anomalyCount = 0;
  private sizeThresholdPct = 5;
  private minResponseSize = 0;
  private errorBuffer: SingleCallResult[] = [];
  private anomalyBuffer: SingleCallResult[] = [];

  reset(testStartMs: number, sizeThresholdPct: number, minResponseSize = 0): void {
    this._raw.length = 0;
    this._buckets.set([]);
    this._stats.set(emptyStats());
    this._errors.set([]);
    this._anomalies.set([]);
    this._activeVus.set(0);

    this.currentBucketIndex = -1;
    this.currentDurations = [];
    this.currentErrors = 0;
    this.currentSizes = [];

    this.testStartMs = testStartMs;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.allDurations = [];
    this.sumDuration = 0;
    this.minDuration = Number.POSITIVE_INFINITY;
    this.maxDuration = 0;
    this.sumSize = 0;
    this.minSize = Number.POSITIVE_INFINITY;
    this.maxSize = 0;
    this.sizeSamples = [];
    this.referenceSize = 0;
    this.anomalyCount = 0;
    this.sizeThresholdPct = sizeThresholdPct;
    this.minResponseSize = minResponseSize;
    this.errorBuffer = [];
    this.anomalyBuffer = [];
  }

  setActiveVus(n: number): void {
    this._activeVus.set(n);
  }

  /** Ingest one real call result. Called on the main thread for every API call.
   *  Never commits a bucket — that is the exclusive responsibility of commitBucket()
   *  called by the 1-second tick in load-test.service, avoiding any double-commit.
   */
  add(r: SingleCallResult): void {
    // Absolute minimum size: a response smaller than the configured minimum
    // is flagged as an error with a clear message.
    if (
      this.minResponseSize > 0 &&
      !r.isError &&
      r.responseBodySize < this.minResponseSize
    ) {
      r.isError = true;
      r.errorDetail = `TAILLE INSUFFISANTE: ${r.responseBodySize} o reçus < minimum ${this.minResponseSize} o`;
    }

    // size anomaly detection on successful responses
    if (!r.isError) {
      if (this.sizeSamples.length < REFERENCE_SAMPLE_COUNT) {
        this.sizeSamples.push(r.responseBodySize);
        if (this.sizeSamples.length === REFERENCE_SAMPLE_COUNT) {
          this.referenceSize = this.median(this.sizeSamples);
        }
      } else if (this.referenceSize > 0) {
        const dev = Math.abs(r.responseBodySize - this.referenceSize);
        const devPct = (dev / this.referenceSize) * 100;
        if (devPct > this.sizeThresholdPct) {
          r.isInconsistentSize = true;
          r.referenceSize = this.referenceSize;
          this.anomalyCount++;
          if (this.anomalyBuffer.length < 1000) this.anomalyBuffer.push(r);
        }
      }
    }

    this._raw.push(r);
    this.totalRequests++;
    this.currentDurations.push(r.durationMs);
    this.allDurations.push(r.durationMs);
    this.sumDuration += r.durationMs;
    this.minDuration = Math.min(this.minDuration, r.durationMs);
    this.maxDuration = Math.max(this.maxDuration, r.durationMs);

    if (r.isError) {
      this.totalErrors++;
      this.currentErrors++;
      if (this.errorBuffer.length < 500) {
        this.errorBuffer.push(r);
      } else {
        this.errorBuffer.shift();
        this.errorBuffer.push(r);
      }
    } else {
      this.currentSizes.push(r.responseBodySize);
      this.sumSize += r.responseBodySize;
      this.minSize = Math.min(this.minSize, r.responseBodySize);
      this.maxSize = Math.max(this.maxSize, r.responseBodySize);
    }
  }

  /** Commit the in-progress bucket and refresh signals.
   *  Called ONLY by the 1-second timer in load-test.service — never from add().
   *  This guarantees exactly one bucket row per elapsed second, no duplicates.
   */
  commitBucket(): void {
    if (this.currentDurations.length === 0 && this.currentErrors === 0) {
      return;
    }
    // Derive the slot index from the current wall clock, not from result timestamps.
    // This means the bucket always maps cleanly to its 1-second tick.
    const slotIndex = Math.floor((Date.now() - this.testStartMs) / 1000);
    if (slotIndex === this.currentBucketIndex) {
      // onTick fired twice in the same second (shouldn't happen, guard anyway).
      return;
    }
    this.currentBucketIndex = slotIndex;

    const sorted = [...this.currentDurations].sort((a, b) => a - b);
    const count = this.currentDurations.length;
    const bucket: TimeSeriesBucket = {
      t: this.testStartMs + slotIndex * 1000,
      secondOffset: slotIndex,
      requestCount: count,
      errorCount: this.currentErrors,
      errorRatePct: count > 0 ? (this.currentErrors / count) * 100 : 0,
      avgDurationMs: count > 0 ? this.sum(this.currentDurations) / count : 0,
      minDurationMs: sorted.length ? sorted[0] : 0,
      maxDurationMs: sorted.length ? sorted[sorted.length - 1] : 0,
      p50Ms: this.percentile(sorted, 50),
      p95Ms: this.percentile(sorted, 95),
      p99Ms: this.percentile(sorted, 99),
      avgResponseSize:
        this.currentSizes.length > 0
          ? this.sum(this.currentSizes) / this.currentSizes.length
          : 0,
      activeVus: this._activeVus(),
    };

    this._buckets.update((b) => [...b, bucket]);
    this.currentDurations = [];
    this.currentErrors = 0;
    this.currentSizes = [];
    this.refreshStats();
  }

  /** Force a final commit + stats refresh at the end of a test. */
  finalize(): void {
    this.commitBucket();
    this.refreshStats();
  }

  private refreshStats(): void {
    const sorted = [...this.allDurations].sort((a, b) => a - b);
    const elapsed = Math.max(
      0.001,
      (Date.now() - this.testStartMs) / 1000,
    );
    const successCount = this.totalRequests - this.totalErrors;
    this._stats.set({
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorRatePct:
        this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0,
      avgDurationMs:
        this.totalRequests > 0 ? this.sumDuration / this.totalRequests : 0,
      minDurationMs: this.minDuration === Number.POSITIVE_INFINITY ? 0 : this.minDuration,
      maxDurationMs: this.maxDuration,
      p50Ms: this.percentile(sorted, 50),
      p95Ms: this.percentile(sorted, 95),
      p99Ms: this.percentile(sorted, 99),
      throughputRpm: (this.totalRequests / elapsed) * 60,
      avgResponseSize: successCount > 0 ? this.sumSize / successCount : 0,
      minResponseSize: this.minSize === Number.POSITIVE_INFINITY ? 0 : this.minSize,
      maxResponseSize: this.maxSize,
      responseSizeInconsistencies: this.anomalyCount,
      responseSizeStdDev: this.stdDev(this.currentSizesAll()),
      referenceSize: this.referenceSize,
      elapsedSeconds: elapsed,
    });
    this._errors.set([...this.errorBuffer]);
    this._anomalies.set([...this.anomalyBuffer]);
  }

  get rawResults(): SingleCallResult[] {
    return this._raw;
  }

  get currentErrorRatePct(): number {
    return this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;
  }

  get totalRequestCount(): number {
    return this.totalRequests;
  }

  // --- helpers ---

  private currentSizesAll(): number[] {
    // sizes of successful responses, recomputed lazily from raw is expensive;
    // approximate stddev over reference samples + collected raw sizes.
    const sizes: number[] = [];
    for (const r of this._raw) {
      if (!r.isError) sizes.push(r.responseBodySize);
    }
    return sizes;
  }

  private sum(arr: number[]): number {
    let s = 0;
    for (const v of arr) s += v;
    return s;
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
  }

  private stdDev(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = this.sum(arr) / arr.length;
    const variance = this.sum(arr.map((v) => (v - mean) ** 2)) / arr.length;
    return Math.sqrt(variance);
  }
}
