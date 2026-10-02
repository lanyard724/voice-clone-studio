import { app, BrowserWindow, ipcMain, dialog, session, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Initialize storage defensively
let store: any = null;
try {
  const Store = require('electron-store');
  const StoreClass = Store.default || Store;
  store = new StoreClass({
    defaults: {
      settings: {
        apiKey: '',
        proxyUrl: 'http://127.0.0.1:7900',
        autoPlay: true,
        defaultModel: 'gemini-3.8-flash-tts'
      },
      voices: [],
      history: []
    }
  });
} catch (err) {
  console.warn('electron-store init failed, using filesystem json fallback', err);
}

// Filesystem fallback path
function getFallbackDbPath(): string {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'voice_studio_db.json');
}

function readFallbackDb(): any {
  try {
    const file = getFallbackDbPath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading fallback db', e);
  }
  return {
    settings: {
      apiKey: '',
      proxyUrl: 'http://127.0.0.1:7900',
      autoPlay: true,
      defaultModel: 'gemini-3.8-flash-tts'
    },
    voices: [],
    history: []
  };
}

function writeFallbackDb(data: any): void {
  try {
    const file = getFallbackDbPath();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing fallback db', e);
  }
}

let mainWindow: BrowserWindow | null = null;

function applyProxy(proxyUrl?: string) {
  const target = proxyUrl && proxyUrl.trim() ? proxyUrl.trim() : 'http://127.0.0.1:7900';
  process.env.HTTP_PROXY = target;
  process.env.HTTPS_PROXY = target;
  process.env.http_proxy = target;
  process.env.https_proxy = target;
  session.defaultSession.setProxy({
    proxyRules: target
  }).then(() => {
    console.log(`[Proxy] Applied proxy rules: ${target}`);
  }).catch((err) => {
    console.warn('[Proxy] Failed to apply proxy:', err);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 840,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#020617',
    title: 'Voice Clone Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Allow local audio buffer playback & fetch
    }
  });

  // Apply initial proxy from settings
  const initialSettings = store ? store.get('settings') : readFallbackDb().settings;
  if (initialSettings?.proxyUrl) {
    applyProxy(initialSettings.proxyUrl);
  } else {
    applyProxy('http://127.0.0.1:7900');
  }

  // Check dev server vs dist build
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const devUrl = 'http://localhost:5174';

  if (isDev) {
    mainWindow.loadURL(devUrl).catch(() => {
      // If dev server not running on 5174, try loading dist
      const indexPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(indexPath)) {
        mainWindow?.loadFile(indexPath);
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // IPC Handlers
  ipcMain.handle('get-settings', () => {
    if (store) return store.get('settings');
    return readFallbackDb().settings;
  });

  ipcMain.handle('save-settings', (_event, settings: any) => {
    if (store) {
      store.set('settings', settings);
    } else {
      const db = readFallbackDb();
      db.settings = settings;
      writeFallbackDb(db);
    }
    if (settings.proxyUrl) {
      applyProxy(settings.proxyUrl);
    }
    return true;
  });

  ipcMain.handle('get-voices', () => {
    if (store) return store.get('voices') || [];
    return readFallbackDb().voices || [];
  });

  ipcMain.handle('save-voices', (_event, voices: any[]) => {
    if (store) {
      store.set('voices', voices);
    } else {
      const db = readFallbackDb();
      db.voices = voices;
      writeFallbackDb(db);
    }
    return true;
  });

  ipcMain.handle('get-history', () => {
    if (store) return store.get('history') || [];
    return readFallbackDb().history || [];
  });

  ipcMain.handle('save-history', (_event, history: any[]) => {
    if (store) {
      store.set('history', history);
    } else {
      const db = readFallbackDb();
      db.history = history;
      writeFallbackDb(db);
    }
    return true;
  });

  ipcMain.handle('export-audio', async (_event, base64: string, defaultName: string) => {
    if (!mainWindow) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出 WAV 音频',
      defaultPath: defaultName.endsWith('.wav') ? defaultName : `${defaultName}.wav`,
      filters: [{ name: 'WAV 音频文件', extensions: ['wav'] }]
    });

    if (canceled || !filePath) return false;

    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);
    return true;
  });

  // Proxy-aware API fetcher in main process using Chromium net.fetch
  ipcMain.handle('api-request', async (_event, { url, method = 'GET', headers = {}, body }: any) => {
    const res = await net.fetch(url, {
      method,
      headers,
      body: body || undefined
    });
    const text = await res.text();
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    return {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
      body: text
    };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
