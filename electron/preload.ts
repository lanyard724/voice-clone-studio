import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  getVoices: () => ipcRenderer.invoke('get-voices'),
  saveVoices: (voices: any[]) => ipcRenderer.invoke('save-voices', voices),
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveHistory: (records: any[]) => ipcRenderer.invoke('save-history', records),
  exportAudio: (base64: string, defaultName: string) => ipcRenderer.invoke('export-audio', base64, defaultName),
  request: (options: { url: string; method?: string; headers?: Record<string, string>; body?: string }) =>
    ipcRenderer.invoke('api-request', options)
});
