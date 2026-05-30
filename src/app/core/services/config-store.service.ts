import { Injectable, effect, signal } from '@angular/core';
import {
  LoadConfig,
  RequestConfig,
  defaultLoadConfig,
  defaultRequestConfig,
} from '../models/test-config.model';

const STORAGE_KEY = 'apitester.config.v1';

/** Single source of truth for request + load config, persisted to localStorage. */
@Injectable({ providedIn: 'root' })
export class ConfigStoreService {
  readonly request = signal<RequestConfig>(defaultRequestConfig());
  readonly load = signal<LoadConfig>(defaultLoadConfig());

  constructor() {
    this.restore();
    // Auto-save (debounced) on any change. Files are not serializable.
    let handle: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      const req = this.request();
      const load = this.load();
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => this.persist(req, load), 1000);
    });
  }

  patchRequest(patch: Partial<RequestConfig>): void {
    this.request.update((r) => ({ ...r, ...patch }));
  }

  patchLoad(patch: Partial<LoadConfig>): void {
    this.load.update((l) => ({ ...l, ...patch }));
  }

  /**
   * Saves the current config. When the browser supports the File System Access
   * API, a native "Save As" dialog lets the user pick the name AND location.
   * Otherwise we prompt for a file name and fall back to a regular download
   * (the location is then the browser's default download folder).
   */
  async exportToFile(): Promise<void> {
    const data = {
      request: this.stripFiles(this.request()),
      load: this.load(),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const defaultName = 'config.apitester.json';

    const picker = (
      window as unknown as {
        showSaveFilePicker?: (opts: unknown) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }
    ).showSaveFilePicker;

    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: defaultName,
          types: [
            {
              description: 'Configuration API Load Tester',
              accept: { 'application/json': ['.json', '.apitester.json'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        // User cancelled the dialog -> abort silently; other errors -> fallback.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }

    // Fallback: ask for a name, then download to the default folder.
    const name = window.prompt('Nom du fichier de configuration :', defaultName);
    if (name === null) return; // cancelled
    const filename = name.trim() || defaultName;
    this.download(blob, filename.endsWith('.json') ? filename : `${filename}.json`);
  }

  /** Returns true if the loaded config dropped non-serializable file fields. */
  importFromObject(obj: { request?: RequestConfig; load?: LoadConfig }): boolean {
    let droppedFiles = false;
    if (obj.request) {
      const req = { ...defaultRequestConfig(), ...obj.request };
      if (req.bodyBinaryFile) {
        droppedFiles = true;
        req.bodyBinaryFile = null;
      }
      req.bodyFormFields = (req.bodyFormFields ?? []).map((f) => {
        if (f.isFile) {
          droppedFiles = true;
          return { ...f, file: null };
        }
        return f;
      });
      this.request.set(req);
    }
    if (obj.load) {
      this.load.set({ ...defaultLoadConfig(), ...obj.load });
    }
    return droppedFiles;
  }

  private stripFiles(req: RequestConfig): RequestConfig {
    return {
      ...req,
      bodyBinaryFile: null,
      bodyFormFields: req.bodyFormFields.map((f) =>
        f.isFile ? { ...f, file: null } : f,
      ),
    };
  }

  private persist(request: RequestConfig, load: LoadConfig): void {
    try {
      const data = { request: this.stripFiles(request), load };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // storage full / unavailable -> ignore
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as { request?: RequestConfig; load?: LoadConfig };
      this.importFromObject(obj);
    } catch {
      // corrupt -> ignore
    }
  }

  private download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
