import { Injectable, inject, signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { LoadConfig, RequestConfig } from '../models/test-config.model';
import { TestStatus } from '../models/test-result.model';
import { HttpRunnerService } from './http-runner.service';
import { ResultsStoreService } from './results-store.service';

/**
 * Orchestrates virtual users that fire REAL HTTP calls in a loop.
 * Pure main-thread RxJS/async — no Web Workers, no simulation.
 */
@Injectable({ providedIn: 'root' })
export class LoadTestService {
  private readonly runner = inject(HttpRunnerService);
  private readonly store = inject(ResultsStoreService);

  readonly status = signal<TestStatus>('idle');
  readonly elapsedSeconds = signal<number>(0);
  readonly activeVus = signal<number>(0);
  readonly totalDuration = signal<number>(0);

  private stopped = false;
  private startMs = 0;
  private iterationCounter = 0;
  private requestsThisSecond = 0;
  private currentSecondKey = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private vuPromises: Promise<void>[] = [];

  async start(request: RequestConfig, load: LoadConfig): Promise<void> {
    if (this.status() === 'running') return;

    this.stopped = false;
    this.startMs = Date.now();
    this.iterationCounter = 0;
    this.requestsThisSecond = 0;
    this.currentSecondKey = 0;
    this.vuPromises = [];

    this.store.reset(this.startMs, load.sizeInconsistencyThresholdPct);
    this.totalDuration.set(load.durationSeconds);
    this.elapsedSeconds.set(0);
    this.activeVus.set(0);
    this.status.set('running');

    // 1s clock: commit buckets, refresh elapsed, evaluate stop conditions.
    this.tickHandle = setInterval(() => this.onTick(load), 1000);

    // Launch virtual users according to the ramp strategy.
    this.scheduleVus(request, load);
  }

  stop(): void {
    if (this.status() !== 'running') return;
    this.status.set('stopping');
    this.stopped = true;
  }

  reset(): void {
    if (this.status() === 'running') return;
    this.store.reset(Date.now(), 5);
    this.elapsedSeconds.set(0);
    this.activeVus.set(0);
    this.totalDuration.set(0);
    this.status.set('idle');
  }

  private scheduleVus(request: RequestConfig, load: LoadConfig): void {
    const total = Math.max(1, load.virtualUsers);

    if (load.rampMode === 'fixed') {
      for (let i = 0; i < total; i++) this.spawnVu(i, request, load);
      this.activeVus.set(total);
      this.store.setActiveVus(total);
      return;
    }

    if (load.rampMode === 'ramp-up') {
      const rampMs = Math.max(0, load.rampUpSeconds) * 1000;
      const intervalMs = total > 1 ? rampMs / total : 0;
      for (let i = 0; i < total; i++) {
        const delay = Math.round(i * intervalMs);
        setTimeout(() => {
          if (this.stopped) return;
          this.spawnVu(i, request, load);
          const n = this.activeVus() + 1;
          this.activeVus.set(n);
          this.store.setActiveVus(n);
        }, delay);
      }
      return;
    }

    // step
    const steps = Math.max(1, load.stepCount);
    const rampMs = Math.max(0, load.rampUpSeconds) * 1000;
    const perStep = Math.ceil(total / steps);
    const stepInterval = steps > 1 ? rampMs / (steps - 1 || 1) : 0;
    let spawned = 0;
    for (let s = 0; s < steps; s++) {
      const target = Math.min(total, perStep * (s + 1));
      const delay = Math.round(s * stepInterval);
      const startIdx = spawned;
      const endIdx = target;
      spawned = target;
      setTimeout(() => {
        if (this.stopped) return;
        for (let i = startIdx; i < endIdx; i++) this.spawnVu(i, request, load);
        this.activeVus.set(endIdx);
        this.store.setActiveVus(endIdx);
      }, delay);
    }
  }

  private spawnVu(vuId: number, request: RequestConfig, load: LoadConfig): void {
    this.vuPromises.push(this.runVuLoop(vuId, request, load));
  }

  private async runVuLoop(
    vuId: number,
    request: RequestConfig,
    load: LoadConfig,
  ): Promise<void> {
    while (!this.shouldStop(load)) {
      await this.rateLimitGate(load);
      if (this.shouldStop(load)) break;

      const iterationId = this.iterationCounter++;
      try {
        const result = await lastValueFrom(
          this.runner.executeOne(request, vuId, iterationId),
        );
        this.store.add(result);
      } catch {
        // executeOne never throws (errors are mapped), but guard anyway.
      }

      if (load.thinkTimeMs > 0 && !this.shouldStop(load)) {
        await this.sleep(load.thinkTimeMs);
      }
    }
  }

  private shouldStop(load: LoadConfig): boolean {
    if (this.stopped) return true;
    const elapsed = (Date.now() - this.startMs) / 1000;
    if (elapsed >= load.durationSeconds) return true;
    if (load.maxIterations > 0 && this.iterationCounter >= load.maxIterations) {
      return true;
    }
    if (
      load.stopOnErrorRate > 0 &&
      this.store.totalRequestCount >= 20 &&
      this.store.currentErrorRatePct > load.stopOnErrorRate
    ) {
      return true;
    }
    return false;
  }

  /** Throttles to maxRequestsPerSecond across all VUs (0 = unlimited). */
  private async rateLimitGate(load: LoadConfig): Promise<void> {
    if (load.maxRequestsPerSecond <= 0) return;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const sec = Math.floor((Date.now() - this.startMs) / 1000);
      if (sec !== this.currentSecondKey) {
        this.currentSecondKey = sec;
        this.requestsThisSecond = 0;
      }
      if (this.requestsThisSecond < load.maxRequestsPerSecond) {
        this.requestsThisSecond++;
        return;
      }
      if (this.shouldStop(load)) return;
      await this.sleep(10);
    }
  }

  private async onTick(load: LoadConfig): Promise<void> {
    const elapsed = (Date.now() - this.startMs) / 1000;
    this.elapsedSeconds.set(Math.min(elapsed, load.durationSeconds));
    this.store.commitBucket();

    if (this.shouldStop(load) && this.status() === 'running') {
      this.stopped = true;
      this.status.set('stopping');
    }

    if (this.stopped) {
      await this.finishWhenDrained();
    }
  }

  private async finishWhenDrained(): Promise<void> {
    if (this.status() === 'finished') return;
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    await Promise.allSettled(this.vuPromises);
    this.activeVus.set(0);
    this.store.setActiveVus(0);
    this.store.finalize();
    this.status.set('finished');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
