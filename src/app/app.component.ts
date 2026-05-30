import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ConfigStoreService } from './core/services/config-store.service';
import { RequestConfigComponent } from './features/request-config/request-config.component';
import { LoadConfigComponent } from './features/load-config/load-config.component';
import { ResultsComponent } from './features/results/results.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RequestConfigComponent, LoadConfigComponent, ResultsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen">
      <header class="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-900">
        <div class="flex items-center gap-2">
          <svg class="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 13h2l2 6 4-14 3 9h4" />
          </svg>
          <h1 class="text-lg font-bold">API Load Tester</h1>
          <span class="text-xs text-slate-500">appels HTTP réels · OAuth2 password flow</span>
        </div>
        <div class="flex gap-2 text-sm">
          <button type="button" (click)="store.exportToFile()"
            class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600">Sauvegarder la config</button>
          <label class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 cursor-pointer">
            Charger une config
            <input type="file" accept=".json,application/json" class="hidden" (change)="onLoadConfig($event)" />
          </label>
        </div>
      </header>

      @if (importWarning()) {
        <div class="bg-amber-900/40 border-b border-amber-700 text-amber-200 text-xs px-5 py-2">
          ⚠ {{ importWarning() }}
        </div>
      }

      <main class="max-w-[1400px] mx-auto p-5 space-y-4">
        <app-request-config />
        <app-load-config />
        <app-results />
      </main>
    </div>
  `,
})
export class AppComponent {
  readonly store = inject(ConfigStoreService);
  readonly importWarning = signal<string | null>(null);

  onLoadConfig(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result as string);
        const dropped = this.store.importFromObject(obj);
        this.importWarning.set(
          dropped
            ? 'Config chargée. Les fichiers (binary / form-data) ne sont pas sérialisables et ont été vidés — à re-sélectionner.'
            : 'Config chargée. Rechargez la page si les champs ne se mettent pas à jour.',
        );
      } catch {
        this.importWarning.set('Fichier de configuration invalide.');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }
}
