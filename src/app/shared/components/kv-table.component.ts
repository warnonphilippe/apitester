import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KeyValueParam } from '../../core/models/test-config.model';

@Component({
  selector: 'app-kv-table',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-slate-700 rounded-md overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-800 text-slate-400">
          <tr>
            <th class="w-10 p-2"></th>
            <th class="text-left p-2 font-medium">Clé</th>
            <th class="text-left p-2 font-medium">Valeur</th>
            @if (allowFiles()) {
              <th class="w-24 p-2 font-medium text-left">Type</th>
            }
            <th class="w-10 p-2"></th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track $index) {
            <tr class="border-t border-slate-700 hover:bg-slate-800/50">
              <td class="p-2 text-center">
                <input
                  type="checkbox"
                  [(ngModel)]="row.enabled"
                  (ngModelChange)="emit()"
                  [attr.aria-label]="'Activer la ligne ' + ($index + 1)"
                  class="accent-blue-500"
                />
              </td>
              <td class="p-1">
                <input
                  type="text"
                  [(ngModel)]="row.key"
                  (ngModelChange)="emit()"
                  [placeholder]="keyPlaceholder()"
                  class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 focus:border-blue-500 outline-none"
                />
              </td>
              <td class="p-1">
                @if (allowFiles() && row.isFile) {
                  <input
                    type="file"
                    (change)="onFile(row, $event)"
                    class="w-full text-xs text-slate-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-blue-600 file:text-white"
                  />
                  @if (row.file) {
                    <span class="text-xs text-slate-400">{{ row.file.name }} ({{ row.file.size }} o)</span>
                  }
                } @else {
                  <input
                    type="text"
                    [(ngModel)]="row.value"
                    (ngModelChange)="emit()"
                    placeholder="valeur"
                    class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 focus:border-blue-500 outline-none"
                  />
                }
              </td>
              @if (allowFiles()) {
                <td class="p-1">
                  <select
                    [(ngModel)]="row.isFile"
                    (ngModelChange)="emit()"
                    class="bg-slate-900 border border-slate-700 rounded px-1 py-1 text-xs"
                  >
                    <option [ngValue]="false">Texte</option>
                    <option [ngValue]="true">Fichier</option>
                  </select>
                </td>
              }
              <td class="p-2 text-center">
                <button
                  type="button"
                  (click)="removeRow($index)"
                  aria-label="Supprimer la ligne"
                  class="text-slate-500 hover:text-red-400 font-bold"
                >
                  ✕
                </button>
              </td>
            </tr>
          }
          @if (rows().length === 0) {
            <tr>
              <td [attr.colspan]="allowFiles() ? 5 : 4" class="p-3 text-center text-slate-500 text-xs">
                Aucune ligne
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <button
      type="button"
      (click)="addRow()"
      class="mt-2 text-sm text-blue-400 hover:text-blue-300"
    >
      + Ajouter une ligne
    </button>
  `,
})
export class KvTableComponent {
  readonly rows = model.required<KeyValueParam[]>();
  readonly allowFiles = input<boolean>(false);
  readonly keyPlaceholder = input<string>('clé');

  addRow(): void {
    this.rows.update((r) => [
      ...r,
      { key: '', value: '', enabled: true, isFile: false, file: null },
    ]);
  }

  removeRow(index: number): void {
    this.rows.update((r) => r.filter((_, i) => i !== index));
  }

  onFile(row: KeyValueParam, event: Event): void {
    const input = event.target as HTMLInputElement;
    row.file = input.files?.[0] ?? null;
    this.emit();
  }

  emit(): void {
    // mutating in place; re-emit a new array reference so signal consumers update
    this.rows.update((r) => [...r]);
  }
}
