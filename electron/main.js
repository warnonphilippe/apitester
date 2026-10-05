// Application de bureau de l'apitester.
//
// La fenêtre charge le build Vite (dist/) via le schéma app://apitester/ et
// n'applique pas CORS : l'app appelle n'importe quel serveur en direct, sans
// proxy ni configuration. En contrepartie, la fenêtre est durcie (pas de Node,
// sandbox, aucun contenu distant, navigation bloquée hors de l'app).
import { app, BrowserWindow, net, protocol, session } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEME = 'app';
const APP_URL = `${SCHEME}://apitester/`;
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// standard + secure : origine stable (localStorage persistant), chemins absolus
// /assets/… résolus comme sur un serveur web. corsEnabled : le schéma reste
// soumis à CORS pour toute autre origine.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** Sert dist/ ; toute route inconnue retombe sur index.html (SPA). */
function serveApp(request) {
  const { pathname } = new URL(request.url);
  const file = normalize(join(DIST, decodeURIComponent(pathname)));
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  const target = existsSync(file) && statSync(file).isFile() ? file : join(DIST, 'index.html');
  return net.fetch(pathToFileURL(target).toString());
}

/**
 * Retire Origin et Referer des appels sortants : sans cela la cible reçoit
 * « Origin: app://apitester » et un backend doté d'une config CORS (Spring…)
 * répond 403 « Invalid CORS request ». Même traitement que le relais web.
 */
function stripBrowserHeaders(details, callback) {
  const requestHeaders = { ...details.requestHeaders };
  for (const name of Object.keys(requestHeaders)) {
    if (/^(origin|referer)$/i.test(name)) delete requestHeaders[name];
  }
  callback({ requestHeaders });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'API Load Tester',
    backgroundColor: '#0f172a',
    webPreferences: {
      // CORS désactivé (preflight compris) : appel direct de n'importe quelle URL.
      webSecurity: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) event.preventDefault();
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, serveApp);
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    stripBrowserHeaders,
  );
  createWindow();
});

app.on('window-all-closed', () => app.quit());
