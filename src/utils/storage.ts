import {
  AppSettings,
  VoiceItem,
  GenerationRecord,
  DEFAULT_SETTINGS,
  PRESET_VOICES
} from '../api/types';
import { base64ToBlob } from './audioConverter';

const MIGRATION_KEY = 'voice_studio_migrated_v2';

function readLocalSettings(): Partial<AppSettings> {
  const raw = localStorage.getItem('voice_studio_settings');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readLocalCustomVoices(): VoiceItem[] {
  const raw = localStorage.getItem('voice_studio_voices');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readLocalHistory(): GenerationRecord[] {
  const raw = localStorage.getItem('voice_studio_history');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalHistorySlim(records: GenerationRecord[]): void {
  try {
    const slim = records.slice(0, 100).map(r => ({
      ...r,
      audioBase64: '',
      audioUrl: r.audioUrl || `/api/audio?id=${encodeURIComponent(r.id)}`
    }));
    localStorage.setItem('voice_studio_history', JSON.stringify(slim));
  } catch (err) {
    console.warn('localStorage history write skipped', err);
  }
}

function mergeWithPresets(customVoices: VoiceItem[]): VoiceItem[] {
  const customMap = new Map<string, VoiceItem>();
  customVoices.forEach(v => {
    if (v && v.id && v.type !== 'preset' && !/^voice_\d{10,}$/.test(v.id)) {
      customMap.set(v.id, v);
    }
  });
  return [...PRESET_VOICES, ...Array.from(customMap.values())];
}

export const storage = {
  /**
   * Single unified state loader that avoids 3x duplicate /api/state requests
   * and uses /api/state as authoritative Single Source of Truth.
   */
  async loadAllState(): Promise<{
    settings: AppSettings;
    voices: VoiceItem[];
    history: GenerationRecord[];
  }> {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        const serverSettings: AppSettings = { ...DEFAULT_SETTINGS, ...(data?.settings || {}) };
        let serverVoices: VoiceItem[] = Array.isArray(data?.voices) ? data.voices : [];
        let serverHistory: GenerationRecord[] = Array.isArray(data?.history) ? data.history : [];

        // One-time migration from browser localStorage to backend DB on very first run
        const alreadyMigrated = localStorage.getItem(MIGRATION_KEY) === '1';
        if (!alreadyMigrated) {
          const localSettings = readLocalSettings();
          const localVoices = readLocalCustomVoices();
          const localHist = readLocalHistory();
          let needsPush = false;

          if (!serverSettings.apiKey && localSettings.apiKey) {
            serverSettings.apiKey = localSettings.apiKey;
            needsPush = true;
          }
          if (serverVoices.length === 0 && localVoices.length > 0) {
            serverVoices = localVoices;
            needsPush = true;
          }
          if (serverHistory.length === 0 && localHist.length > 0) {
            serverHistory = localHist;
            needsPush = true;
          }
          localStorage.setItem(MIGRATION_KEY, '1');

          if (needsPush) {
            await fetch('/api/state', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                settings: serverSettings,
                voices: serverVoices,
                history: serverHistory,
                broadcast: false
              })
            }).catch(() => {});
          }
        }

        // Authoritative sync down to localStorage (even if arrays are legitimately empty)
        localStorage.setItem('voice_studio_settings', JSON.stringify(serverSettings));
        localStorage.setItem('voice_studio_voices', JSON.stringify(serverVoices));
        writeLocalHistorySlim(serverHistory);

        return {
          settings: serverSettings,
          voices: mergeWithPresets(serverVoices),
          history: serverHistory
        };
      }
    } catch {}

    // Fallback when running in standalone Electron or offline without Vite bridge
    const [settings, voices, history] = await Promise.all([
      this.getSettings(),
      this.getVoices(),
      this.getHistory()
    ]);
    return { settings, voices, history };
  },

  async getSettings(): Promise<AppSettings> {
    if (window.electronAPI?.getSettings) {
      try {
        const stored = await window.electronAPI.getSettings();
        return { ...DEFAULT_SETTINGS, ...stored };
      } catch (err) {
        console.warn('IPC getSettings failed, fallback to local', err);
      }
    }
    return { ...DEFAULT_SETTINGS, ...readLocalSettings() };
  },

  async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    if (window.electronAPI?.saveSettings) {
      try {
        await window.electronAPI.saveSettings(updated);
      } catch (err) {
        console.warn('IPC saveSettings failed', err);
      }
    }
    localStorage.setItem('voice_studio_settings', JSON.stringify(updated));
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: updated, broadcast: false })
    }).catch(() => {});
  },

  async getVoices(): Promise<VoiceItem[]> {
    if (window.electronAPI?.getVoices) {
      try {
        const ipcVoices = (await window.electronAPI.getVoices()) || [];
        return mergeWithPresets(ipcVoices);
      } catch (err) {
        console.warn('IPC getVoices failed', err);
      }
    }
    return mergeWithPresets(readLocalCustomVoices());
  },

  async saveCustomVoices(voices: VoiceItem[]): Promise<void> {
    const onlyCustom = voices.filter(v => v.type === 'replicated' || v.type === 'prompted');
    if (window.electronAPI?.saveVoices) {
      try {
        await window.electronAPI.saveVoices(onlyCustom);
      } catch (err) {
        console.warn('IPC saveVoices failed', err);
      }
    }
    localStorage.setItem('voice_studio_voices', JSON.stringify(onlyCustom));
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voices: onlyCustom, broadcast: false })
    }).catch(() => {});
  },

  async getHistory(): Promise<GenerationRecord[]> {
    if (window.electronAPI?.getHistory) {
      try {
        return (await window.electronAPI.getHistory()) || [];
      } catch (err) {
        console.warn('IPC getHistory failed', err);
      }
    }
    return readLocalHistory();
  },

  async saveHistory(records: GenerationRecord[]): Promise<void> {
    const sliced = records.slice(0, 100);
    if (window.electronAPI?.saveHistory) {
      try {
        await window.electronAPI.saveHistory(sliced);
      } catch (err) {
        console.warn('IPC saveHistory failed', err);
      }
    }
    writeLocalHistorySlim(sliced);
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: sliced, broadcast: false })
    }).catch(() => {});
  },

  async exportAudioFile(base64OrUrl: string, defaultName: string): Promise<boolean> {
    const downloadName = defaultName.endsWith('.wav') ? defaultName : `${defaultName}.wav`;

    if (base64OrUrl.startsWith('/api/audio') || base64OrUrl.startsWith('http')) {
      const res = await fetch(base64OrUrl);
      if (!res.ok) return false;
      const blob = await res.blob();
      if (window.electronAPI?.exportAudio) {
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i += 8192) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
        }
        return await window.electronAPI.exportAudio(btoa(binary), downloadName);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    }

    if (window.electronAPI?.exportAudio) {
      return await window.electronAPI.exportAudio(base64OrUrl, downloadName);
    }
    const blob = base64ToBlob(base64OrUrl, 'audio/wav');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }
};
