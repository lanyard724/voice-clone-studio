export interface VoiceItem {
  id: string; // voice_id or unique identifier
  name: string; // voices/voice_id or identifier
  displayName: string; // Local nickname or remote display_name
  type: 'replicated' | 'preset' | 'prompted';
  originalName?: string;
  createTime?: string;
  sampleAudioUrl?: string; // Data URL or local path for playback preview
  tags?: string[];
  isFavorite?: boolean;
  description?: string;
}

export interface CloneVoicePayload {
  displayName: string;
  sourceAudioBase64: string; // 24kHz mono 16-bit PCM WAV base64
  consentAudioBase64: string; // 24kHz mono 16-bit PCM WAV base64
  store?: boolean;
  tags?: string[];
}

export interface DirectorResult {
  enhancedText: string;
  targetLanguage: string;
  speechStyle: string;
  directorNotes: string;
}

export type LlmDirectorModel = 'gemini-4-argon' | 'gemini-3.8-flash';
export type TtsSynthesisModel = 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';

export interface SynthesizePayload {
  text: string;
  voiceId: string;
  stylePrompt?: string;
  model?: TtsSynthesisModel;
}

export interface GenerationRecord {
  id: string;
  timestamp: number;
  text: string;
  voiceId: string;
  voiceName: string;
  stylePrompt: string;
  audioBase64: string;
  audioUrl?: string;
  audioDuration: number;
  model: string;
}

export interface AppSettings {
  apiKey: string;
  proxyUrl: string;
  autoPlay: boolean;
  defaultModel: TtsSynthesisModel;
  llmModel: LlmDirectorModel;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  proxyUrl: 'http://127.0.0.1:7900',
  autoPlay: true,
  defaultModel: 'gemini-3.8-flash-tts',
  llmModel: 'gemini-4-argon'
};

export const PRESET_VOICES: VoiceItem[] = [
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
