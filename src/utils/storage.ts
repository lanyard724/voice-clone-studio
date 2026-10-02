import { AppSettings, VoiceItem, GenerationRecord } from '../api/types';
import { base64ToBlob } from './audioConverter';

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  proxyUrl: 'http://127.0.0.1:7900',
  autoPlay: true,
  defaultModel: 'gemini-3.8-flash-tts'
};

const PRESET_VOICES: VoiceItem[] = [
  {
    id: 'kore',
    name: 'voices/kore',
    displayName: 'Kore（沉稳端庄）',
    type: 'preset',
    tags: ['官方预设', '女声', '专业', '沉稳'],
    description: '坚定、稳重、专业的新闻与纪录片音色'
  },
  {
    id: 'zephyr',
    name: 'voices/zephyr',
    displayName: 'Zephyr（明亮欢快）',
    type: 'preset',
    tags: ['官方预设', '女声', '活力', '亲和'],
    description: '明亮轻快、充满朝气的主播与助理音色'
  },
  {
    id: 'puck',
    name: 'voices/puck',
    displayName: 'Puck（幽默随和）',
    type: 'preset',
    tags: ['官方预设', '男声', '风趣', '自然'],
    description: '随和、略带幽默感的年轻男性对谈音色'
  },
  {
    id: 'fenrir',
    name: 'voices/fenrir',
    displayName: 'Fenrir（激昂有力）',
    type: 'preset',
    tags: ['官方预设', '男声', '激昂', '力量'],
    description: '富有磁性与爆发力的男性叙事音色'
  },
  {
    id: 'charon',
    name: 'voices/charon',
    displayName: 'Charon（深邃博学）',
    type: 'preset',
    tags: ['官方预设', '男声', '低沉', '博学'],
    description: '低沉内敛、极具说服力的学者与旁白音色'
  },
  {
    id: 'leda',
    name: 'voices/leda',
    displayName: 'Leda（青春温婉）',
    type: 'preset',
    tags: ['官方预设', '女声', '温柔', '治愈'],
    description: '温婉柔和、富有亲切感的年轻女性音色'
  }
];

export const storage = {
  async getSettings(): Promise<AppSettings> {
    if (window.electronAPI?.getSettings) {
      try {
        const stored = await window.electronAPI.getSettings();
        return { ...DEFAULT_SETTINGS, ...stored };
      } catch (err) {
        console.warn('IPC getSettings failed, fallback to local', err);
      }
    }
    const raw = localStorage.getItem('voice_studio_settings');
    if (!raw) return DEFAULT_SETTINGS;
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
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
  },

  async getVoices(): Promise<VoiceItem[]> {
    let customVoices: VoiceItem[] = [];
    if (window.electronAPI?.getVoices) {
      try {
        customVoices = (await window.electronAPI.getVoices()) || [];
      } catch (err) {
        console.warn('IPC getVoices failed', err);
      }
    }
    if (customVoices.length === 0) {
      const raw = localStorage.getItem('voice_studio_voices');
      if (raw) {
        try {
          customVoices = JSON.parse(raw);
        } catch {
          customVoices = [];
        }
      }
    }
    // Combine presets with custom voices
    return [...PRESET_VOICES, ...customVoices];
  },

  async saveCustomVoices(voices: VoiceItem[]): Promise<void> {
    // Only save replicated / custom voices
    const onlyCustom = voices.filter(v => v.type === 'replicated' || v.type === 'prompted');
    if (window.electronAPI?.saveVoices) {
      try {
        await window.electronAPI.saveVoices(onlyCustom);
      } catch (err) {
        console.warn('IPC saveVoices failed', err);
      }
    }
    localStorage.setItem('voice_studio_voices', JSON.stringify(onlyCustom));
  },

  async getHistory(): Promise<GenerationRecord[]> {
    if (window.electronAPI?.getHistory) {
      try {
        return (await window.electronAPI.getHistory()) || [];
      } catch (err) {
        console.warn('IPC getHistory failed', err);
      }
    }
    const raw = localStorage.getItem('voice_studio_history');
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async saveHistory(records: GenerationRecord[]): Promise<void> {
    if (window.electronAPI?.saveHistory) {
      try {
        await window.electronAPI.saveHistory(records);
      } catch (err) {
        console.warn('IPC saveHistory failed', err);
      }
    }
    // Retain up to 100 recent items in localStorage
    localStorage.setItem('voice_studio_history', JSON.stringify(records.slice(0, 100)));
  },

  async exportAudioFile(base64: string, defaultName: string): Promise<boolean> {
    if (window.electronAPI?.exportAudio) {
      return await window.electronAPI.exportAudio(base64, defaultName);
    }
    // Browser fallback download
    const blob = base64ToBlob(base64, 'audio/wav');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName.endsWith('.wav') ? defaultName : `${defaultName}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }
};
