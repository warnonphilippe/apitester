import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // withFetch() => uses the native fetch API, enabling response streaming
    // and accurate Content-Length / body size measurement.
    provideHttpClient(withFetch()),
  ],
};
