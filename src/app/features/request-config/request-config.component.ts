import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { lastValueFrom } from 'rxjs';
import { ConfigStoreService } from '../../core/services/config-store.service';
import { HttpRunnerService, SingleCallDetail } from '../../core/services/http-runner.service';
import { KeycloakAuthService } from '../../core/services/keycloak-auth.service';
import {
  BodyType,
  HTTP_VERBS,
  HttpVerb,
  RequestConfig,
} from '../../core/models/test-config.model';
import { KvTableComponent } from '../../shared/components/kv-table.component';

type Tab = 'params' | 'headers' | 'body' | 'auth';

const VERB_CLASS: Record<HttpVerb, string> = {
  GET: 'text-emerald-400',
  POST: 'text-amber-400',
  PUT: 'text-blue-400',
  PATCH: 'text-violet-400',
  DELETE: 'text-red-400',
  HEAD: 'text-slate-400',
  OPTIONS: 'text-cyan-400',
};

@Component({
  selector: 'app-request-config',
  standalone: true,
  imports: [FormsModule, KvTableComponent, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bg-slate-900 rounded-lg border border-slate-600 border-l-4 border-l-blue-500 shadow-lg shadow-black/30">
      <!-- Top bar -->
      <div class="flex gap-2 p-3 border-b border-slate-700">
        <select
          [(ngModel)]="cfg.verb"
          (ngModelChange)="sync()"
          [class]="'font-bold bg-slate-800 border border-slate-700 rounded px-2 py-2 ' + verbClass()"
          aria-label="Méthode HTTP"
        >
          @for (v of verbs; track v) {
            <option [value]="v">{{ v }}</option>
          }
        </select>
        <input
          type="text"
          [(ngModel)]="cfg.url"
          (ngModelChange)="sync()"
          placeholder="https://api.exemple.com/v1/ressource  (supporte :id et {{ '{{var}}' }})"
          class="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 font-mono text-sm focus:border-blue-500 outline-none"
          aria-label="URL de la requête"
        />
        <button
          type="button"
          (click)="runSingle()"
          [disabled]="!cfg.url || testing()"
          class="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm font-medium"
        >
          {{ testing() ? '…' : 'Test unique' }}
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-slate-700 text-sm">
        @for (t of tabs; track t.id) {
          <button
            type="button"
            (click)="tab.set(t.id)"
            [class]="
              'px-4 py-2 border-b-2 ' +
              (tab() === t.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200')
            "
          >
            {{ t.label }}
            @if (t.count > 0) {
              <span class="ml-1 text-xs text-slate-500">({{ t.count }})</span>
            }
          </button>
        }
      </div>

      <div class="p-4">
        <!-- PARAMS -->
        @if (tab() === 'params') {
          <h3 class="text-xs uppercase tracking-wide text-slate-500 mb-2">Path params</h3>
          <app-kv-table [(rows)]="cfg.pathParams" (rowsChange)="sync()" keyPlaceholder="nom (sans :)" />
          <h3 class="text-xs uppercase tracking-wide text-slate-500 mt-5 mb-2">Query params</h3>
          <app-kv-table [(rows)]="cfg.queryParams" (rowsChange)="sync()" />
        }

        <!-- HEADERS -->
        @if (tab() === 'headers') {
          <app-kv-table [(rows)]="cfg.headers" (rowsChange)="sync()" keyPlaceholder="Header-Name" />
        }

        <!-- BODY -->
        @if (tab() === 'body') {
          <div class="flex gap-2 flex-wrap mb-4 text-sm">
            @for (b of bodyTypes; track b) {
              <label class="flex items-center gap-1 cursor-pointer px-2 py-1 rounded border border-slate-700"
                     [class.bg-slate-700]="cfg.bodyType === b">
                <input type="radio" name="bodyType" [value]="b" [(ngModel)]="cfg.bodyType"
                       (ngModelChange)="sync()" class="accent-blue-500" />
                {{ b }}
              </label>
            }
          </div>

          @switch (cfg.bodyType) {
            @case ('json') {
              <textarea
                [(ngModel)]="cfg.bodyJson"
                (ngModelChange)="onJsonChange()"
                rows="12"
                class="w-full bg-slate-950 border border-slate-700 rounded p-3 font-mono text-sm focus:border-blue-500 outline-none"
                spellcheck="false"
              ></textarea>
              @if (jsonError()) {
                <p class="text-red-400 text-xs mt-1">JSON invalide : {{ jsonError() }}</p>
              } @else {
                <p class="text-emerald-500 text-xs mt-1">JSON valide</p>
              }
            }
            @case ('form-data') {
              <p class="text-xs text-amber-400/90 mb-2">
                Envoyé en <span class="font-mono">multipart/form-data</span> (le navigateur fixe le boundary).
                Mettez une ligne en « Fichier » pour joindre un document.
                Ces lignes sont partagées avec l'onglet x-www-form-urlencoded.
              </p>
              <app-kv-table [(rows)]="cfg.bodyFormFields" (rowsChange)="sync()" [allowFiles]="true" />
            }
            @case ('x-www-form-urlencoded') {
              <p class="text-xs text-amber-400/90 mb-2">
                Envoyé en <span class="font-mono">application/x-www-form-urlencoded</span> (paires clé=valeur).
                ⚠ Les lignes de type « Fichier » définies en form-data ne sont
                <strong>pas envoyées</strong> ici. Pour joindre un fichier, choisissez form-data.
              </p>
              @if (hasFileRow()) {
                <p class="text-xs text-red-400 mb-2">
                  ⚠ {{ fileRowCount() }} ligne(s) « Fichier » seront ignorée(s) dans ce mode.
                </p>
              }
              <app-kv-table [(rows)]="cfg.bodyFormFields" (rowsChange)="sync()" />
            }
            @case ('raw') {
              <input
                type="text"
                [(ngModel)]="cfg.bodyRawContentType"
                (ngModelChange)="sync()"
                placeholder="Content-Type (ex: application/xml)"
                class="mb-2 w-72 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
              />
              <textarea
                [(ngModel)]="cfg.bodyRaw"
                (ngModelChange)="sync()"
                rows="10"
                class="w-full bg-slate-950 border border-slate-700 rounded p-3 font-mono text-sm focus:border-blue-500 outline-none"
                spellcheck="false"
              ></textarea>
            }
            @case ('binary') {
              <input
                type="file"
                (change)="onBinaryFile($event)"
                class="text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white"
              />
              @if (cfg.bodyBinaryFile) {
                <p class="text-slate-400 text-sm mt-2">
                  {{ cfg.bodyBinaryFile.name }} — {{ cfg.bodyBinaryFile.size }} octets
                </p>
              }
            }
            @default {
              <p class="text-slate-500 text-sm">Cette requête n'a pas de body.</p>
            }
          }
        }

        <!-- AUTH -->
        @if (tab() === 'auth') {
          <div class="flex gap-4 mb-4 text-sm">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="authType" value="none" [(ngModel)]="cfg.auth.type"
                     (ngModelChange)="sync()" class="accent-blue-500" />
              Aucune
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="authType" value="oauth2-password" [(ngModel)]="cfg.auth.type"
                     (ngModelChange)="sync()" class="accent-blue-500" />
              OAuth 2.0 — Password Flow (Keycloak)
            </label>
          </div>

          @if (cfg.auth.type === 'oauth2-password') {
            <div class="grid grid-cols-2 gap-3 max-w-3xl">
              <label class="col-span-2 text-sm">
                <span class="text-slate-400">Token URL</span>
                <input type="text" [(ngModel)]="cfg.auth.tokenUrl" (ngModelChange)="sync()"
                  placeholder="https://kc/realms/realm/protocol/openid-connect/token"
                  class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono text-xs" />
              </label>
              <label class="text-sm">
                <span class="text-slate-400">Client ID</span>
                <input type="text" [(ngModel)]="cfg.auth.clientId" (ngModelChange)="sync()"
                  class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              </label>
              <label class="text-sm">
                <span class="text-slate-400">Client Secret</span>
                <input [type]="showSecret() ? 'text' : 'password'" [(ngModel)]="cfg.auth.clientSecret"
                  (ngModelChange)="sync()"
                  class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              </label>
              <label class="text-sm">
                <span class="text-slate-400">Username</span>
                <input type="text" [(ngModel)]="cfg.auth.username" (ngModelChange)="sync()"
                  class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              </label>
              <label class="text-sm">
                <span class="text-slate-400">Password</span>
                <input [type]="showSecret() ? 'text' : 'password'" [(ngModel)]="cfg.auth.password"
                  (ngModelChange)="sync()"
                  class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              </label>
              <label class="text-sm">
                <span class="text-slate-400">Scope (optionnel)</span>
                <input type="text" [(ngModel)]="cfg.auth.scope" (ngModelChange)="sync()"
                  placeholder="openid"
                  class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              </label>
              <div class="col-span-2 flex items-center gap-3">
                <label class="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" [(ngModel)]="showSecret" class="accent-blue-500" /> Afficher les secrets
                </label>
                <button type="button" (click)="testAuth()" [disabled]="authTesting()"
                  class="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-40">
                  {{ authTesting() ? 'Test…' : "Tester l'authentification" }}
                </button>
                @if (authResult()) {
                  <span [class]="authOk() ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'">
                    {{ authResult() }}
                  </span>
                }
              </div>
            </div>
            <p class="text-xs text-amber-400/80 mt-3">
              ⚠ Un nouveau token est demandé à Keycloak avant CHAQUE appel (pas de cache),
              afin de reproduire une charge réaliste. La latence Keycloak n'est pas comptée
              dans le temps de réponse mesuré.
            </p>
          }
        }
      </div>
    </section>

    <!-- Single test result -->
    @if (singleResult(); as r) {
      <section class="mt-3 bg-slate-900 rounded-lg border border-slate-600 border-l-4 border-l-blue-500/50 shadow-md p-4 text-sm space-y-3">

        <!-- Statut + métriques -->
        <div class="flex items-center gap-4">
          <span class="font-semibold">Résultat du test unique</span>
          <span [class]="r.isError ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'">
            {{ r.statusCode || 'ERR' }}
          </span>
          <span class="text-slate-400">{{ r.durationMs }} ms</span>
          <span class="text-slate-400">{{ r.responseBodySize }} o</span>
        </div>

        <!-- Requête envoyée (collapsible) -->
        @if (r.requestUrl) {
          <details class="group">
            <summary class="cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none list-none flex items-center gap-1">
              <span class="group-open:rotate-90 transition-transform inline-block">▶</span>
              Requête envoyée
            </summary>
            <div class="mt-2 space-y-1">
              <div class="flex gap-2 text-xs">
                <span class="text-amber-400 font-bold">{{ r.requestMethod }}</span>
                <span class="text-slate-300 break-all">{{ r.requestUrl }}</span>
              </div>
              @if (r.requestHeadersSent && objectKeys(r.requestHeadersSent).length) {
                <pre class="bg-slate-950 rounded p-2 text-slate-400 text-xs overflow-auto max-h-32">{{ r.requestHeadersSent | json }}</pre>
              }
              @if (r.requestBodyPreview) {
                <pre class="bg-slate-950 rounded p-2 text-slate-300 text-xs overflow-auto max-h-32">{{ r.requestBodyPreview }}</pre>
              }
            </div>
          </details>
        }

        <!-- Corps de réponse / erreur -->
        @if (r.errorDetail && r.statusCode === 0) {
          <pre class="bg-slate-950 rounded p-2 text-red-300 text-xs overflow-auto max-h-40">{{ r.errorDetail }}</pre>
        }
        @if (r.responseBodyPreview) {
          <div>
            <p class="text-xs text-slate-500 mb-1">Corps de réponse</p>
            <pre class="bg-slate-950 rounded p-2 text-slate-300 text-xs overflow-auto max-h-60">{{ r.responseBodyPreview }}</pre>
          </div>
        } @else if (r.isError && r.statusCode !== 0) {
          <pre class="bg-slate-950 rounded p-2 text-red-300 text-xs overflow-auto max-h-40">{{ r.errorDetail }}</pre>
        }

        <!-- Headers de réponse (collapsible) -->
        @if (r.responseHeaders && objectKeys(r.responseHeaders).length) {
          <details class="group">
            <summary class="cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none list-none flex items-center gap-1">
              <span class="group-open:rotate-90 transition-transform inline-block">▶</span>
              Headers de réponse ({{ objectKeys(r.responseHeaders).length }})
            </summary>
            <pre class="mt-2 bg-slate-950 rounded p-2 text-slate-400 text-xs overflow-auto max-h-48">{{ r.responseHeaders | json }}</pre>
          </details>
        }

        @if (r.statusCode === 0 && !r.errorDetail) {
          <p class="text-amber-400 text-xs">
            Erreur réseau possible (CORS). Utilisez le proxy Vite (/k8s-proxy/&lt;port&gt;/…).
          </p>
        }
      </section>
    }
  `,
})
export class RequestConfigComponent {
  private readonly store = inject(ConfigStoreService);
  private readonly runner = inject(HttpRunnerService);
  private readonly keycloak = inject(KeycloakAuthService);

  readonly verbs = HTTP_VERBS;
  readonly bodyTypes: BodyType[] = [
    'none',
    'json',
    'form-data',
    'x-www-form-urlencoded',
    'raw',
    'binary',
  ];

  // working copy bound to the form
  cfg: RequestConfig = this.store.request();

  readonly tab = signal<Tab>('params');
  readonly testing = signal(false);
  readonly authTesting = signal(false);
  readonly showSecret = signal(false);
  readonly jsonError = signal<string | null>(null);
  readonly singleResult = signal<SingleCallDetail | null>(null);
  readonly authResult = signal<string | null>(null);
  readonly authOk = signal(false);

  readonly objectKeys = Object.keys;

  /** Nombre de lignes marquées « Fichier » — ignorées en x-www-form-urlencoded. */
  fileRowCount(): number {
    return this.cfg.bodyFormFields.filter((f) => f.isFile).length;
  }

  hasFileRow(): boolean {
    return this.fileRowCount() > 0;
  }

  get tabs() {
    return [
      { id: 'params' as Tab, label: 'Params', count: this.cfg.queryParams.length + this.cfg.pathParams.length },
      { id: 'headers' as Tab, label: 'Headers', count: this.cfg.headers.length },
      { id: 'body' as Tab, label: 'Body', count: this.cfg.bodyType === 'none' ? 0 : 1 },
      { id: 'auth' as Tab, label: 'Auth', count: this.cfg.auth.type === 'none' ? 0 : 1 },
    ];
  }

  verbClass(): string {
    return VERB_CLASS[this.cfg.verb];
  }

  sync(): void {
    this.store.request.set({ ...this.cfg });
  }

  onJsonChange(): void {
    try {
      if (this.cfg.bodyJson.trim()) JSON.parse(this.cfg.bodyJson);
      this.jsonError.set(null);
    } catch (e) {
      this.jsonError.set((e as Error).message);
    }
    this.sync();
  }

  onBinaryFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.cfg.bodyBinaryFile = input.files?.[0] ?? null;
    this.sync();
  }

  async runSingle(): Promise<void> {
    this.testing.set(true);
    this.singleResult.set(null);
    try {
      const r = await lastValueFrom(this.runner.executeOne(this.cfg, -1, -1));
      this.singleResult.set(r);
    } finally {
      this.testing.set(false);
    }
  }

  async testAuth(): Promise<void> {
    this.authTesting.set(true);
    this.authResult.set(null);
    try {
      const token = await lastValueFrom(this.keycloak.fetchToken(this.cfg.auth));
      this.authOk.set(true);
      this.authResult.set(`OK — token: ${token.slice(0, 24)}…`);
    } catch (e) {
      this.authOk.set(false);
      this.authResult.set((e as Error).message);
    } finally {
      this.authTesting.set(false);
    }
  }
}
