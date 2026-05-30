import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigStoreService } from '../../core/services/config-store.service';
import { LoadTestService } from '../../core/services/load-test.service';
import { LoadConfig, RampMode } from '../../core/models/test-config.model';

@Component({
  selector: 'app-load-config',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bg-slate-900 rounded-lg border border-slate-700 p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-slate-300">Configuration du test de charge</h2>
        <div class="flex gap-2">
          <button
            type="button"
            (click)="start()"
            [disabled]="!canStart()"
            class="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-semibold"
          >
            ▶ Lancer le test
          </button>
          <button
            type="button"
            (click)="loadTest.stop()"
            [disabled]="status() !== 'running'"
            class="px-4 py-2 rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-sm font-semibold"
          >
            ⏹ Arrêter
          </button>
          <button
            type="button"
            (click)="loadTest.reset()"
            [disabled]="status() === 'running'"
            class="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm font-semibold"
          >
            ↺ Réinitialiser
          </button>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-3 text-sm">
        <label class="block">
          <span class="text-slate-400">Virtual Users</span>
          <input type="number" min="1" max="500" [(ngModel)]="cfg.virtualUsers" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
        </label>
        <label class="block">
          <span class="text-slate-400">Durée (s)</span>
          <input type="number" min="1" [(ngModel)]="cfg.durationSeconds" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
        </label>
        <label class="block">
          <span class="text-slate-400">Mode de montée</span>
          <select [(ngModel)]="cfg.rampMode" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1">
            <option value="fixed">Fixe</option>
            <option value="ramp-up">Ramp-up</option>
            <option value="step">Paliers (step)</option>
          </select>
        </label>
        @if (cfg.rampMode !== 'fixed') {
          <label class="block">
            <span class="text-slate-400">Ramp-up (s)</span>
            <input type="number" min="0" [(ngModel)]="cfg.rampUpSeconds" (ngModelChange)="sync()"
              class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </label>
        }
        @if (cfg.rampMode === 'step') {
          <label class="block">
            <span class="text-slate-400">Nb de paliers</span>
            <input type="number" min="1" [(ngModel)]="cfg.stepCount" (ngModelChange)="sync()"
              class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </label>
        }
        <label class="block">
          <span class="text-slate-400">Think time (ms)</span>
          <input type="number" min="0" [(ngModel)]="cfg.thinkTimeMs" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
        </label>
        <label class="block">
          <span class="text-slate-400">Max req/s (0=∞)</span>
          <input type="number" min="0" [(ngModel)]="cfg.maxRequestsPerSecond" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
        </label>
        <label class="block">
          <span class="text-slate-400">Max itérations (0=∞)</span>
          <input type="number" min="0" [(ngModel)]="cfg.maxIterations" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
        </label>
        <label class="block">
          <span class="text-slate-400">Stop si erreurs > (%)</span>
          <input type="number" min="0" max="100" [(ngModel)]="cfg.stopOnErrorRate" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
        </label>
        <label class="block">
          <span class="text-slate-400">Seuil incohérence taille (%)</span>
          <input type="number" min="0" [(ngModel)]="cfg.sizeInconsistencyThresholdPct" (ngModelChange)="sync()"
            class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
        </label>
      </div>

      @if (status() !== 'idle') {
        <div class="mt-4">
          <div class="flex justify-between text-xs text-slate-400 mb-1">
            <span>
              {{ statusLabel() }} — {{ loadTest.activeVus() }} VUs actifs
            </span>
            <span>{{ loadTest.elapsedSeconds() | number: '1.0-0' }}s / {{ loadTest.totalDuration() }}s</span>
          </div>
          <div class="h-2 bg-slate-800 rounded overflow-hidden">
            <div class="h-full bg-blue-500 transition-all" [style.width.%]="progressPct()"></div>
          </div>
        </div>
      }
    </section>
  `,
})
export class LoadConfigComponent {
  private readonly store = inject(ConfigStoreService);
  readonly loadTest = inject(LoadTestService);

  cfg: LoadConfig = this.store.load();
  readonly status = this.loadTest.status;

  readonly canStart = computed(
    () => this.status() !== 'running' && !!this.store.request().url,
  );

  readonly progressPct = computed(() => {
    const total = this.loadTest.totalDuration();
    return total > 0 ? Math.min(100, (this.loadTest.elapsedSeconds() / total) * 100) : 0;
  });

  sync(): void {
    this.store.load.set({ ...this.cfg });
  }

  statusLabel(): string {
    switch (this.status()) {
      case 'running':
        return 'En cours';
      case 'stopping':
        return 'Arrêt en cours…';
      case 'finished':
        return 'Terminé';
      default:
        return 'Inactif';
    }
  }

  start(): void {
    this.sync();
    void this.loadTest.start(this.store.request(), this.store.load());
  }
}
