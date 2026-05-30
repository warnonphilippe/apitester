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

  exportToFile(): void {
    const data = {
      request: this.stripFiles(this.request()),
      load: this.load(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    this.download(blob, 'config.apitester.json');
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
