import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { ResultsStoreService } from '../../core/services/results-store.service';
import { TimeSeriesBucket } from '../../core/models/test-result.model';

Chart.register(...registerables);

interface SeriesDef {
  key: string;
  label: string;
  color: string;
  axis: 'yMs' | 'yCount' | 'yPct' | 'yBytes';
  value: (b: TimeSeriesBucket) => number;
}

const SERIES: SeriesDef[] = [
  { key: 'reqPerMin', label: 'Requêtes/min', color: '#3b82f6', axis: 'yCount', value: (b) => b.requestCount * 60 },
  { key: 'errPerMin', label: 'Erreurs/min', color: '#ef4444', axis: 'yCount', value: (b) => b.errorCount * 60 },
  { key: 'errorRate', label: "Taux d'erreur (%)", color: '#f97316', axis: 'yPct', value: (b) => b.errorRatePct },
  { key: 'avg', label: 'Temps moyen (ms)', color: '#22c55e', axis: 'yMs', value: (b) => b.avgDurationMs },
  { key: 'p50', label: 'P50 (ms)', color: '#86efac', axis: 'yMs', value: (b) => b.p50Ms },
  { key: 'p95', label: 'P95 (ms)', color: '#eab308', axis: 'yMs', value: (b) => b.p95Ms },
  { key: 'p99', label: 'P99 (ms)', color: '#d97706', axis: 'yMs', value: (b) => b.p99Ms },
  { key: 'min', label: 'Min (ms)', color: '#cbd5e1', axis: 'yMs', value: (b) => b.minDurationMs },
  { key: 'max', label: 'Max (ms)', color: '#64748b', axis: 'yMs', value: (b) => b.maxDurationMs },
  { key: 'avgSize', label: 'Taille moyenne (o)', color: '#a855f7', axis: 'yBytes', value: (b) => b.avgResponseSize },
  { key: 'vus', label: 'VUs actifs', color: '#06b6d4', axis: 'yCount', value: (b) => b.activeVus },
];

const DEFAULT_VISIBLE = new Set(['reqPerMin', 'errPerMin', 'avg', 'p95']);

@Component({
  selector: 'app-chart-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-slate-900 rounded-lg border border-slate-700 p-4">
      <div class="flex flex-wrap gap-x-4 gap-y-1 mb-3">
        @for (s of series; track s.key) {
          <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              [checked]="visible().has(s.key)"
              (change)="toggle(s.key)"
              class="accent-blue-500"
            />
            <span class="inline-block w-3 h-3 rounded-sm" [style.background]="s.color"></span>
            {{ s.label }}
          </label>
        }
      </div>
      <div class="relative h-80">
        <canvas #canvas></canvas>
      </div>
    </div>
  `,
})
export class ChartPanelComponent implements AfterViewInit, OnDestroy {
  private readonly store = inject(ResultsStoreService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly series = SERIES;
  readonly visible = signal<Set<string>>(new Set(DEFAULT_VISIBLE));

  private chart: Chart | null = null;

  constructor() {
    // Redraw whenever buckets or visibility change.
    effect(() => {
      const buckets = this.store.buckets();
      this.visible();
      if (this.chart) this.updateChart(buckets);
    });
  }

  ngAfterViewInit(): void {
    this.chart = new Chart(this.canvasRef().nativeElement, this.baseConfig());
    this.updateChart(this.store.buckets());
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  toggle(key: string): void {
    this.visible.update((set) => {
      const next = new Set(set);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  private updateChart(buckets: TimeSeriesBucket[]): void {
    if (!this.chart) return;
    const labels = buckets.map((b) => b.secondOffset);
    const vis = this.visible();
    this.chart.data.labels = labels;
    this.chart.data.datasets = SERIES.filter((s) => vis.has(s.key)).map((s) => ({
      label: s.label,
      data: buckets.map((b) => Math.round(s.value(b) * 100) / 100),
      borderColor: s.color,
      backgroundColor: s.color,
      yAxisID: s.axis,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.25,
    }));
    this.chart.update('none');
  }

  private baseConfig(): ChartConfiguration<'line'> {
    const grid = { color: 'rgba(148,163,184,0.1)' };
    const ticks = { color: '#94a3b8' };
    return {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
        },
        scales: {
          x: {
            title: { display: true, text: 'Temps (s)', color: '#94a3b8' },
            grid,
            ticks,
          },
          yMs: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'ms', color: '#22c55e' },
            grid,
            ticks,
          },
          yCount: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'req·min / VUs', color: '#3b82f6' },
            grid: { drawOnChartArea: false },
            ticks,
          },
          yPct: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: '%', color: '#f97316' },
            grid: { drawOnChartArea: false },
            ticks,
            min: 0,
            max: 100,
          },
          yBytes: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'octets', color: '#a855f7' },
            grid: { drawOnChartArea: false },
            ticks,
          },
        },
      },
    };
  }
}
