import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { ResultsStoreService } from '../../core/services/results-store.service';
import { LoadTestService } from '../../core/services/load-test.service';
import { ChartPanelComponent } from './chart-panel.component';
import { SingleCallResult, TimeSeriesBucket } from '../../core/models/test-result.model';

type ResultTab = 'stats' | 'anomalies' | 'errors';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [DecimalPipe, DatePipe, ChartPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-slate-300">Résultats</h2>

      <!-- stat cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div class="text-xs text-slate-400">Requêtes</div>
          <div class="text-2xl font-bold">{{ stats().totalRequests | number }}</div>
        </div>
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div class="text-xs text-slate-400">Taux d'erreur</div>
          <div class="text-2xl font-bold" [class.text-red-400]="stats().errorRatePct > 0">
            {{ stats().errorRatePct | number: '1.0-1' }}%
          </div>
          <div class="text-xs text-slate-500">{{ stats().totalErrors }} erreurs</div>
        </div>
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div class="text-xs text-slate-400">Débit</div>
          <div class="text-2xl font-bold">{{ stats().throughputRpm | number: '1.0-0' }}</div>
          <div class="text-xs text-slate-500">req/min</div>
        </div>
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div class="text-xs text-slate-400">Temps réponse (ms)</div>
          <div class="text-sm font-bold">moy {{ stats().avgDurationMs | number: '1.0-0' }}</div>
          <div class="text-xs text-slate-400">
            min {{ stats().minDurationMs | number: '1.0-0' }} · max {{ stats().maxDurationMs | number: '1.0-0' }}
          </div>
        </div>
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div class="text-xs text-slate-400">Percentiles (ms)</div>
          <div class="text-xs text-slate-300">P50 {{ stats().p50Ms | number: '1.0-0' }}</div>
          <div class="text-xs text-slate-300">P95 {{ stats().p95Ms | number: '1.0-0' }}</div>
          <div class="text-xs text-slate-300">P99 {{ stats().p99Ms | number: '1.0-0' }}</div>
        </div>
        <div
          class="bg-slate-900 border rounded-lg p-3"
          [class.border-red-500]="store.hasAnomalies()"
          [class.border-slate-700]="!store.hasAnomalies()"
        >
          <div class="text-xs text-slate-400">Taille réponse</div>
          <div class="text-sm font-bold">réf {{ stats().referenceSize | number }} o</div>
          <div class="text-xs text-slate-400">
            min {{ stats().minResponseSize | number }} · max {{ stats().maxResponseSize | number }}
          </div>
          <div class="text-xs" [class.text-red-400]="store.hasAnomalies()">
            {{ stats().responseSizeInconsistencies }} incohérence(s)
          </div>
        </div>
      </div>

      <app-chart-panel />

      <!-- export buttons -->
      <div class="flex flex-wrap gap-2 text-sm">
        <button type="button" (click)="exportRawJson()" class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600">
          Export JSON (brut)
        </button>
        <button type="button" (click)="exportBucketsCsv()" class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600">
          Export CSV (stats/s)
        </button>
        <button type="button" (click)="exportErrorsCsv()" class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600">
          Export CSV (erreurs)
        </button>
        <button type="button" (click)="exportAnomaliesCsv()" class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600">
          Export CSV (incohérences)
        </button>
      </div>

      <!-- tabs -->
      <div class="flex border-b border-slate-700 text-sm">
        <button type="button" (click)="tab.set('stats')"
          [class]="tabClass('stats')">Stats détaillées</button>
        <button type="button" (click)="tab.set('anomalies')"
          [class]="tabClass('anomalies')">
          Incohérences taille
          @if (store.hasAnomalies()) { <span class="ml-1 text-red-400">({{ anomalies().length }})</span> }
        </button>
        <button type="button" (click)="tab.set('errors')"
          [class]="tabClass('errors')">
          Log erreurs
          @if (errors().length) { <span class="ml-1 text-red-400">({{ errors().length }})</span> }
        </button>
      </div>

      @if (tab() === 'stats') {
        <div class="bg-slate-900 border border-slate-700 rounded-lg overflow-auto max-h-96">
          <table class="w-full text-xs">
            <thead class="bg-slate-800 text-slate-400 sticky top-0">
              <tr>
                <th class="p-2 text-left">t (s)</th>
                <th class="p-2 text-right">Req</th>
                <th class="p-2 text-right">Err</th>
                <th class="p-2 text-right">Err%</th>
                <th class="p-2 text-right">Moy</th>
                <th class="p-2 text-right">P50</th>
                <th class="p-2 text-right">P95</th>
                <th class="p-2 text-right">P99</th>
                <th class="p-2 text-right">Min</th>
                <th class="p-2 text-right">Max</th>
                <th class="p-2 text-right">Taille moy</th>
                <th class="p-2 text-right">VUs</th>
              </tr>
            </thead>
            <tbody>
              @for (b of buckets(); track b.t) {
                <tr class="border-t border-slate-800">
                  <td class="p-2">{{ b.secondOffset }}</td>
                  <td class="p-2 text-right">{{ b.requestCount }}</td>
                  <td class="p-2 text-right" [class.text-red-400]="b.errorCount > 0">{{ b.errorCount }}</td>
                  <td class="p-2 text-right">{{ b.errorRatePct | number: '1.0-1' }}</td>
                  <td class="p-2 text-right">{{ b.avgDurationMs | number: '1.0-0' }}</td>
                  <td class="p-2 text-right">{{ b.p50Ms | number: '1.0-0' }}</td>
                  <td class="p-2 text-right">{{ b.p95Ms | number: '1.0-0' }}</td>
                  <td class="p-2 text-right">{{ b.p99Ms | number: '1.0-0' }}</td>
                  <td class="p-2 text-right">{{ b.minDurationMs | number: '1.0-0' }}</td>
                  <td class="p-2 text-right">{{ b.maxDurationMs | number: '1.0-0' }}</td>
                  <td class="p-2 text-right">{{ b.avgResponseSize | number: '1.0-0' }}</td>
                  <td class="p-2 text-right">{{ b.activeVus }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (tab() === 'anomalies') {
        <div class="bg-slate-900 border border-slate-700 rounded-lg overflow-auto max-h-96">
          <table class="w-full text-xs">
            <thead class="bg-slate-800 text-slate-400 sticky top-0">
              <tr>
                <th class="p-2 text-left">#</th>
                <th class="p-2 text-left">VU</th>
                <th class="p-2 text-left">Heure</th>
                <th class="p-2 text-right">Status</th>
                <th class="p-2 text-right">Taille reçue</th>
                <th class="p-2 text-right">Référence</th>
                <th class="p-2 text-right">Écart</th>
              </tr>
            </thead>
            <tbody>
              @for (a of anomalies(); track a.iterationId) {
                <tr class="border-t border-slate-800">
                  <td class="p-2">{{ a.iterationId }}</td>
                  <td class="p-2">{{ a.vuId }}</td>
                  <td class="p-2">{{ a.timestamp | date: 'HH:mm:ss.SSS' }}</td>
                  <td class="p-2 text-right">{{ a.statusCode }}</td>
                  <td class="p-2 text-right">{{ a.responseBodySize | number }}</td>
                  <td class="p-2 text-right">{{ a.referenceSize | number }}</td>
                  <td class="p-2 text-right text-red-400">{{ deviation(a) }}</td>
                </tr>
              }
              @if (anomalies().length === 0) {
                <tr><td colspan="7" class="p-3 text-center text-slate-500">Aucune incohérence détectée</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (tab() === 'errors') {
        <div class="bg-slate-900 border border-slate-700 rounded-lg overflow-auto max-h-96">
          <table class="w-full text-xs">
            <thead class="bg-slate-800 text-slate-400 sticky top-0">
              <tr>
                <th class="p-2 text-left">Heure</th>
                <th class="p-2 text-left">VU</th>
                <th class="p-2 text-right">Status</th>
                <th class="p-2 text-right">Durée</th>
                <th class="p-2 text-left">Message</th>
              </tr>
            </thead>
            <tbody>
              @for (e of errors(); track e.iterationId) {
                <tr class="border-t border-slate-800">
                  <td class="p-2">{{ e.timestamp | date: 'HH:mm:ss.SSS' }}</td>
                  <td class="p-2">{{ e.vuId }}</td>
                  <td class="p-2 text-right text-red-400">{{ e.statusCode || 'ERR' }}</td>
                  <td class="p-2 text-right">{{ e.durationMs }}</td>
                  <td class="p-2 text-slate-400 truncate max-w-md">{{ e.errorDetail }}</td>
                </tr>
              }
              @if (errors().length === 0) {
                <tr><td colspan="5" class="p-3 text-center text-slate-500">Aucune erreur</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class ResultsComponent {
  readonly store = inject(ResultsStoreService);
  private readonly loadTest = inject(LoadTestService);

  readonly stats = this.store.stats;
  readonly buckets = this.store.buckets;
  readonly errors = this.store.errors;
  readonly anomalies = this.store.anomalies;
  readonly tab = signal<ResultTab>('stats');

  tabClass(t: ResultTab): string {
    return (
      'px-4 py-2 border-b-2 ' +
      (this.tab() === t
        ? 'border-blue-500 text-blue-400'
        : 'border-transparent text-slate-400 hover:text-slate-200')
    );
  }

  deviation(a: SingleCallResult): string {
    const ref = a.referenceSize ?? 0;
    if (!ref) return '—';
    const diff = a.responseBodySize - ref;
    const pct = (diff / ref) * 100;
    return `${diff > 0 ? '+' : ''}${diff} o (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`;
  }

  exportRawJson(): void {
    this.download(
      new Blob([JSON.stringify(this.store.rawResults, null, 2)], { type: 'application/json' }),
      'results-raw.json',
    );
  }

  exportBucketsCsv(): void {
    const header =
      't_s,requests,errors,error_pct,avg_ms,p50,p95,p99,min_ms,max_ms,avg_size_bytes,active_vus';
    const rows = this.buckets().map((b: TimeSeriesBucket) =>
      [
        b.secondOffset,
        b.requestCount,
        b.errorCount,
        b.errorRatePct.toFixed(2),
        b.avgDurationMs.toFixed(1),
        b.p50Ms,
        b.p95Ms,
        b.p99Ms,
        b.minDurationMs,
        b.maxDurationMs,
        b.avgResponseSize.toFixed(0),
        b.activeVus,
      ].join(','),
    );
    this.downloadCsv([header, ...rows], 'results-stats.csv');
  }

  exportErrorsCsv(): void {
    const header = 'timestamp,vu,iteration,status,duration_ms,detail';
    const rows = this.errors().map((e) =>
      [
        new Date(e.timestamp).toISOString(),
        e.vuId,
        e.iterationId,
        e.statusCode,
        e.durationMs,
        this.csvSafe(e.errorDetail ?? ''),
      ].join(','),
    );
    this.downloadCsv([header, ...rows], 'results-errors.csv');
  }

  exportAnomaliesCsv(): void {
    const header = 'iteration,vu,timestamp,status,received_size,reference_size,deviation_pct';
    const rows = this.anomalies().map((a) => {
      const ref = a.referenceSize ?? 0;
      const pct = ref ? (((a.responseBodySize - ref) / ref) * 100).toFixed(2) : '';
      return [
        a.iterationId,
        a.vuId,
        new Date(a.timestamp).toISOString(),
        a.statusCode,
        a.responseBodySize,
        ref,
        pct,
      ].join(',');
    });
    this.downloadCsv([header, ...rows], 'results-anomalies.csv');
  }

  private csvSafe(s: string): string {
    return `"${s.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
  }

  private downloadCsv(lines: string[], name: string): void {
    this.download(new Blob([lines.join('\n')], { type: 'text/csv' }), name);
  }

  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
}
