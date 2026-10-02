/// <reference types="vite/client" />

interface ElectronAPI {
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  getVoices: () => Promise<any[]>;
  saveVoices: (voices: any[]) => Promise<void>;
  getHistory: () => Promise<any[]>;
  saveHistory: (records: any[]) => Promise<void>;
  exportAudio: (base64: string, defaultName: string) => Promise<boolean>;
  request?: (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
